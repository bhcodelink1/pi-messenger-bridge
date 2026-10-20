import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadConfig, saveConfig } from "./config.js";
import { splitMessage } from "./formatting.js";
import { acquireLock, releaseLock } from "./lock.js";
import { planTurnReply } from "./reply-routing.js";
import { getRuntime } from "./runtime.js";
import { DiscordProvider } from "./transports/discord.js";
import { MatrixProvider } from "./transports/matrix.js";
import { SlackProvider } from "./transports/slack.js";
import { TelegramProvider } from "./transports/telegram.js";
import { WhatsAppProvider } from "./transports/whatsapp.js";
import { clampTypingRefreshMs, TypingHeartbeat } from "./typing.js";
import { openMainMenu } from "./ui/main-menu.js";
import { createStatusWidget } from "./ui/status-widget.js";
/**
 * pi-remote-pilot extension
 * Bridges messenger apps (Telegram, WhatsApp, Slack, Discord) into pi
 */
export default function (pi) {
    // Process-wide state. Pi re-runs this factory on every session replacement,
    // so anything holding a network connection lives here and not in a local.
    const runtime = getRuntime();
    const transportManager = runtime.transportManager;
    const auth = runtime.auth;
    /**
     * The request currently in flight, which is per-session. The chat to keep
     * replying to once it is answered is `runtime.stickyRemoteChat`, which
     * survives session replacement. See `planTurnReply`.
     */
    let pendingRemoteChat = null;
    /**
     * Whether interim prose has already gone out for the request in flight, which
     * is what `interimMessages: "first"` counts against. Reset whenever a new
     * request arrives or the current one is answered, so every question gets its
     * one acknowledgement and nothing more.
     */
    let interimSent = false;
    /**
     * Notify the terminal of the session that currently owns the bridge. Silent
     * when no session owns it, which is the case between a shutdown and the
     * `session_start` that follows it.
     */
    function notify(message, level = "info") {
        runtime.ctx?.ui.notify(message, level);
    }
    const typingHeartbeat = new TypingHeartbeat(transportManager, () => {
        const config = loadConfig();
        if (config.typingIndicator === false)
            return 0;
        return config.typingRefreshMs;
    });
    /**
     * The chat to keep a typing indicator alive for, or null when indicators are
     * disabled or no remote request is in flight.
     */
    function typingTarget() {
        if (!pendingRemoteChat)
            return null;
        if (loadConfig().typingIndicator === false)
            return null;
        return pendingRemoteChat;
    }
    /**
     * Update status widget
     */
    function updateWidget() {
        const context = runtime.ctx;
        if (!context)
            return;
        const config = loadConfig();
        if (config.showWidget === false) {
            context.ui.setWidget("msg-bridge-status", undefined);
            return;
        }
        const stats = auth.getStats();
        const transports = transportManager
            .getStatus()
            .map((s) => ({
            type: s.type,
            connected: s.connected,
        }));
        const widget = createStatusWidget(transports, stats.usersByTransport);
        if (widget) {
            context.ui.setWidget("msg-bridge-status", [widget]);
        }
        else {
            context.ui.setWidget("msg-bridge-status", undefined);
        }
    }
    /**
     * Register the transports named by the config and connect them, in the
     * background so a slow homeserver never delays session start.
     */
    async function initTransports(config) {
        transportManager.onMessage((msg) => {
            if (!runtime.inboundSink) {
                console.warn(`[msg-bridge] no live pi session, dropped inbound ${msg.transport} message`);
                return;
            }
            runtime.inboundSink(msg);
        });
        transportManager.onError((err, transport) => {
            notify(`❌ ${transport} error: ${err.message}`, "error");
        });
        const transportPromises = [];
        if (config.telegram?.token) {
            transportPromises.push(Promise.resolve().then(() => {
                const telegramProvider = new TelegramProvider(config.telegram.token, auth);
                transportManager.addTransport(telegramProvider);
            }));
        }
        if (config.whatsapp) {
            const whatsappAuthPath = config.whatsapp.authPath || path.join(os.homedir(), ".pi", "msg-bridge-whatsapp-auth");
            const credsPath = path.join(whatsappAuthPath, "creds.json");
            if (fs.existsSync(credsPath)) {
                transportPromises.push(Promise.resolve().then(() => {
                    const whatsappConfig = { ...config.whatsapp, debug: config.debug };
                    const whatsappProvider = new WhatsAppProvider(whatsappConfig, auth);
                    transportManager.addTransport(whatsappProvider);
                }));
            }
            else {
                delete config.whatsapp;
                saveConfig(config);
            }
        }
        if (config.slack?.botToken && config.slack?.appToken) {
            transportPromises.push(Promise.resolve().then(() => {
                const slackProvider = new SlackProvider(config.slack, auth);
                transportManager.addTransport(slackProvider);
            }));
        }
        if (config.discord?.token) {
            transportPromises.push(Promise.resolve().then(() => {
                const discordProvider = new DiscordProvider(config.discord, auth);
                transportManager.addTransport(discordProvider);
            }));
        }
        if (config.matrix?.homeserverUrl && config.matrix?.accessToken) {
            transportPromises.push(Promise.resolve().then(() => {
                const matrixProvider = new MatrixProvider(config.matrix, auth);
                transportManager.addTransport(matrixProvider);
            }));
        }
        await Promise.all(transportPromises);
        await connectAll(config);
    }
    /**
     * Connect every registered transport, honouring the single-instance lock.
     */
    async function connectAll(config) {
        const transports = transportManager.getAllTransports();
        if (transports.length === 0 || config.autoConnect === false)
            return;
        if (!acquireLock()) {
            notify("ℹ️ msg-bridge: another instance is already connected — skipping auto-connect");
            return;
        }
        try {
            await transportManager.connectAll();
            updateWidget();
        }
        catch (err) {
            releaseLock();
            notify(`⚠️ Some transports failed to connect: ${err.message}`, "warning");
        }
    }
    /**
     * Re-dial after the transports were already built. Covers the case where this
     * process lost the lock to another pi at startup and that pi has since quit,
     * and the case where the first attempt failed outright.
     */
    function redialIdleTransports(config) {
        if (config.autoConnect === false)
            return;
        if (transportManager.getAllTransports().length === 0)
            return;
        if (transportManager.getStatus().some((s) => s.connected))
            return;
        void connectAll(config).catch((err) => {
            console.error("Transport re-dial error:", err);
        });
    }
    /**
     * Initialize extension.
     *
     * Pi fires this on every session replacement, not only at process start, so
     * the transports are built once and reused. See runtime.ts.
     */
    pi.on("session_start", async (_event, context) => {
        runtime.ctx = context;
        const config = loadConfig();
        if (config.auth) {
            auth.loadFromConfig(config.auth);
        }
        // Inbound messages have to reach the `sendUserMessage` of the session that
        // is alive right now. Rebinding the sink here is what makes a message that
        // arrives after a /new land in the new session.
        runtime.inboundSink = (msg) => {
            pendingRemoteChat = {
                chatId: msg.chatId,
                transport: msg.transport,
                username: msg.username,
                messageId: msg.messageId,
            };
            runtime.stickyRemoteChat = pendingRemoteChat;
            interimSent = false;
            const taggedMessage = `[📱 @${msg.username} via ${msg.transport}]: ${msg.content}`;
            pi.sendUserMessage(taggedMessage, { deliverAs: "followUp" });
        };
        if (runtime.transportsBuilt) {
            redialIdleTransports(config);
        }
        else {
            runtime.transportsBuilt = true;
            // Initialize transports in the background (non-blocking)
            void initTransports(config).catch((err) => {
                console.error("Transport initialization error:", err);
                notify(`❌ Transport initialization failed: ${err.message}`, "error");
            });
        }
        updateWidget();
    });
    /**
     * Handle turn start - start the typing indicator heartbeat
     */
    pi.on("turn_start", async (_event, _context) => {
        const target = typingTarget();
        if (target) {
            typingHeartbeat.start(target);
        }
    });
    /**
     * Handle tool start - ping the indicator again and reschedule the refresh.
     * pi runs tools inside the turn, after `turn_start`, so without this the
     * indicator from turn start has usually already expired by the time a tool
     * begins.
     */
    pi.on("tool_execution_start", async (_event, _context) => {
        const target = typingTarget();
        if (target) {
            typingHeartbeat.touch(target);
        }
    });
    /**
     * Handle turn end - send response back to messenger
     *
     * Two targets are possible: the request currently in flight, and the sticky
     * last-seen chat for turns that arrive after that request was answered. See
     * `planTurnReply` in reply-routing.ts for the rules.
     */
    pi.on("turn_end", async (event, _context) => {
        const config = loadConfig();
        const plan = planTurnReply({
            message: event.message,
            pendingRemoteChat,
            stickyRemoteChat: runtime.stickyRemoteChat,
            config,
            interimSent,
        });
        if (!plan.target || plan.text === "")
            return;
        const target = plan.target;
        try {
            // Split long messages for Telegram's 4096 char limit
            const chunks = splitMessage(plan.text, 4000);
            for (const chunk of chunks) {
                await transportManager.sendMessage(target.chatId, target.transport, chunk);
            }
            // Counted only once the send worked, so a transport failure does not
            // spend the request's one acknowledgement on a message nobody received.
            if (plan.interim)
                interimSent = true;
            if (plan.clearPending) {
                pendingRemoteChat = null;
                interimSent = false;
                typingHeartbeat.stop();
            }
        }
        catch (err) {
            notify(`Failed to send response to ${target.transport}: ${err.message}`, "error");
            pendingRemoteChat = null;
            interimSent = false;
            typingHeartbeat.stop();
        }
    });
    /**
     * Stop the heartbeat when the run finishes or is aborted. The final answer
     * already stopped it in `turn_end`; this is the backstop for aborts, errors,
     * and turns that end without a sendable message.
     */
    pi.on("agent_end", async (_event, _context) => {
        typingHeartbeat.stop();
    });
    /**
     * Cleanup on session exit.
     *
     * Only a real quit tears the connections down. Session replacement (new,
     * resume, fork, reload) is followed by another `session_start` in the same
     * process, which rebinds the sink, so disconnecting there meant a full
     * messenger outage plus a Telegram 409 conflict on the redial for every
     * /new, /resume, fork and /reload.
     */
    pi.on("session_shutdown", async (event, _context) => {
        typingHeartbeat.stop();
        runtime.inboundSink = null;
        pendingRemoteChat = null;
        interimSent = false;
        if (event.reason !== "quit")
            return;
        runtime.ctx = null;
        await transportManager.disconnectAll();
        releaseLock();
    });
    /**
     * /msg-bridge command - show status or manage connections
     */
    pi.registerCommand("msg-bridge", {
        description: "Manage remote messenger connections (help|status|connect|disconnect|configure|widget|typing|sticky)",
        handler: async (args, context) => {
            const parts = args.trim().split(/\s+/).filter(p => p.length > 0);
            const subcommand = parts[0] || "";
            // No subcommand → open interactive menu
            if (!subcommand || subcommand === "menu") {
                await openMainMenu({
                    ui: context.ui,
                    transportManager,
                    auth,
                    updateWidget,
                });
                return;
            }
            switch (subcommand) {
                case "help": {
                    const helpText = [
                        "━━━ Message Bridge Commands ━━━",
                        "",
                        "/msg-bridge                   Open interactive menu",
                        "/msg-bridge help              Show this help",
                        "/msg-bridge status            Show connection and user status",
                        "/msg-bridge connect           Connect to all transports",
                        "/msg-bridge disconnect        Disconnect from all transports",
                        "/msg-bridge configure telegram <token>",
                        "                              Configure Telegram bot",
                        "/msg-bridge configure whatsapp",
                        "                              Configure WhatsApp (scan QR)",
                        "/msg-bridge configure matrix <homeserver-url> <access-token>",
                        "                              Configure Matrix (Element X, etc)",
                        "/msg-bridge widget            Toggle status widget on/off",
                        "/msg-bridge toggletools       Toggle tool call visibility",
                        "/msg-bridge typing            Toggle typing indicator on/off",
                        "/msg-bridge typing <seconds>  Typing refresh interval (1-20, 0 = off)",
                        "/msg-bridge sticky            Toggle sticky replies on/off",
                        "/msg-bridge sticky on|off     Deliver late turns to the last messenger chat",
                        "",
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                    ];
                    context.ui.notify(helpText.join("\n"), "info");
                    break;
                }
                case "connect":
                    if (!acquireLock()) {
                        context.ui.notify("⚠️ Another msg-bridge instance is already connected. Run /msg-bridge disconnect there first.", "warning");
                        break;
                    }
                    try {
                        await transportManager.connectAll();
                        const cfg = loadConfig();
                        cfg.autoConnect = true;
                        saveConfig(cfg);
                        context.ui.notify("✅ Connected to all configured transports", "info");
                        updateWidget();
                    }
                    catch (err) {
                        releaseLock();
                        context.ui.notify(`❌ Connection failed: ${err.message}`, "error");
                    }
                    break;
                case "disconnect": {
                    await transportManager.disconnectAll();
                    releaseLock();
                    const cfg = loadConfig();
                    cfg.autoConnect = false;
                    saveConfig(cfg);
                    context.ui.notify("🔌 Disconnected from all transports", "info");
                    updateWidget();
                    break;
                }
                case "configure": {
                    const platform = parts[1];
                    const token = parts.slice(2).join(" ");
                    if (!platform) {
                        context.ui.notify("Usage: /msg-bridge configure <platform> [token/path]", "error");
                        return;
                    }
                    const config = loadConfig();
                    switch (platform.toLowerCase()) {
                        case "telegram": {
                            if (!token) {
                                context.ui.notify("Usage: /msg-bridge configure telegram <bot-token>", "error");
                                return;
                            }
                            config.telegram = { token };
                            saveConfig(config);
                            const telegramProvider = new TelegramProvider(token, auth);
                            transportManager.addTransport(telegramProvider);
                            if (acquireLock()) {
                                try {
                                    await telegramProvider.connect();
                                    context.ui.notify("✅ Telegram configured and connected", "info");
                                }
                                catch (_err) {
                                    releaseLock();
                                    context.ui.notify("✅ Telegram configured (run /msg-bridge connect to activate)", "info");
                                }
                            }
                            else {
                                context.ui.notify("✅ Telegram configured (another instance is connected — run /msg-bridge connect later)", "info");
                            }
                            updateWidget();
                            break;
                        }
                        case "whatsapp": {
                            config.whatsapp = token ? { authPath: token } : {};
                            saveConfig(config);
                            const whatsappConfig = { ...config.whatsapp, debug: config.debug };
                            const whatsappProvider = new WhatsAppProvider(whatsappConfig, auth);
                            transportManager.addTransport(whatsappProvider);
                            if (acquireLock()) {
                                try {
                                    await whatsappProvider.connect(true);
                                    context.ui.notify("✅ WhatsApp configured and connecting (scan QR code in terminal)...", "info");
                                }
                                catch (err) {
                                    releaseLock();
                                    context.ui.notify(`⚠️ WhatsApp setup error: ${err.message}`, "error");
                                }
                            }
                            else {
                                context.ui.notify("✅ WhatsApp configured (another instance is connected — run /msg-bridge connect later)", "info");
                            }
                            updateWidget();
                            break;
                        }
                        case "slack": {
                            const parts2 = token.split(/\s+/);
                            const botToken = parts2[0];
                            const appToken = parts2[1];
                            if (!botToken || !appToken) {
                                context.ui.notify("Usage: /msg-bridge configure slack <bot-token> <app-token>", "error");
                                return;
                            }
                            config.slack = { botToken, appToken };
                            saveConfig(config);
                            const slackProvider = new SlackProvider(config.slack, auth);
                            transportManager.addTransport(slackProvider);
                            if (acquireLock()) {
                                try {
                                    await slackProvider.connect();
                                    context.ui.notify("✅ Slack configured and connected", "info");
                                }
                                catch (err) {
                                    releaseLock();
                                    context.ui.notify(`⚠️ Slack setup error: ${err.message}`, "error");
                                }
                            }
                            else {
                                context.ui.notify("✅ Slack configured (another instance is connected — run /msg-bridge connect later)", "info");
                            }
                            updateWidget();
                            break;
                        }
                        case "discord": {
                            if (!token) {
                                context.ui.notify("Usage: /msg-bridge configure discord <bot-token>", "error");
                                return;
                            }
                            config.discord = { token };
                            saveConfig(config);
                            const discordProvider = new DiscordProvider(config.discord, auth);
                            transportManager.addTransport(discordProvider);
                            if (acquireLock()) {
                                try {
                                    await discordProvider.connect();
                                    context.ui.notify("✅ Discord configured and connected", "info");
                                }
                                catch (err) {
                                    releaseLock();
                                    context.ui.notify(`⚠️ Discord setup error: ${err.message}`, "error");
                                }
                            }
                            else {
                                context.ui.notify("✅ Discord configured (another instance is connected — run /msg-bridge connect later)", "info");
                            }
                            updateWidget();
                            break;
                        }
                        case "matrix": {
                            const matrixParts = token.split(/\s+/);
                            const homeserverUrl = matrixParts[0];
                            const matrixAccessToken = matrixParts.slice(1).join(" ");
                            if (!homeserverUrl || !matrixAccessToken) {
                                context.ui.notify("Usage: /msg-bridge configure matrix <homeserver-url> <access-token>", "error");
                                return;
                            }
                            config.matrix = { homeserverUrl, accessToken: matrixAccessToken };
                            saveConfig(config);
                            const matrixProvider = new MatrixProvider(config.matrix, auth);
                            transportManager.addTransport(matrixProvider);
                            if (acquireLock()) {
                                try {
                                    await matrixProvider.connect();
                                    context.ui.notify("✅ Matrix configured and connected", "info");
                                }
                                catch (err) {
                                    releaseLock();
                                    context.ui.notify(`⚠️ Matrix setup error: ${err.message}`, "error");
                                }
                            }
                            else {
                                context.ui.notify("✅ Matrix configured (another instance is connected — run /msg-bridge connect later)", "info");
                            }
                            updateWidget();
                            break;
                        }
                        default:
                            context.ui.notify(`❌ Unknown platform: ${platform}`, "error");
                    }
                    break;
                }
                case "widget": {
                    const cfg2 = loadConfig();
                    cfg2.showWidget = cfg2.showWidget === false;
                    saveConfig(cfg2);
                    const widgetState = cfg2.showWidget !== false ? "shown" : "hidden";
                    context.ui.notify(`📊 Status widget ${widgetState}`, "info");
                    updateWidget();
                    break;
                }
                case "status": {
                    const stats = auth.getStats();
                    const status = transportManager.getStatus();
                    const lines = [
                        "━━━ Message Bridge Status ━━━",
                        "",
                        "Transports:",
                        ...status.map((s) => `  ${s.connected ? "●" : "○"} ${s.type}`),
                        "",
                        `Trusted Users: ${stats.trustedUsers}`,
                    ];
                    if (stats.trustedUsers > 0) {
                        for (const [transport, userIds] of Object.entries(stats.usersByTransport)) {
                            if (userIds.length > 0) {
                                lines.push(`  └─ ${transport}: ${userIds.join(", ")}`);
                            }
                        }
                    }
                    lines.push("");
                    lines.push(`Channels: ${stats.channels}`);
                    const stickyOn = loadConfig().stickyReplies !== false;
                    const stickyChat = runtime.stickyRemoteChat;
                    lines.push(`Sticky replies: ${stickyOn ? "on" : "off"}${stickyChat
                        ? ` -> ${stickyChat.transport}:${stickyChat.chatId}`
                        : " (no messenger chat seen yet)"}`);
                    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    context.ui.notify(lines.join("\n"), "info");
                    break;
                }
                case "toggletools": {
                    const cfg3 = loadConfig();
                    cfg3.hideToolCalls = !cfg3.hideToolCalls;
                    saveConfig(cfg3);
                    const toolState = cfg3.hideToolCalls ? "hidden" : "shown";
                    context.ui.notify(`🔧 Tool calls ${toolState} in remote messages`, "info");
                    break;
                }
                case "sticky": {
                    const cfg5 = loadConfig();
                    const arg = parts[1];
                    if (arg === undefined) {
                        cfg5.stickyReplies = cfg5.stickyReplies === false;
                    }
                    else if (arg === "on" || arg === "true") {
                        cfg5.stickyReplies = true;
                    }
                    else if (arg === "off" || arg === "false") {
                        cfg5.stickyReplies = false;
                    }
                    else {
                        context.ui.notify("Usage: /msg-bridge sticky [on|off]", "error");
                        return;
                    }
                    saveConfig(cfg5);
                    const stickyState = cfg5.stickyReplies === false ? "off" : "on";
                    const stickyChat = runtime.stickyRemoteChat;
                    const where = stickyChat
                        ? ` -> ${stickyChat.transport}:${stickyChat.chatId}`
                        : " (no messenger chat seen yet)";
                    context.ui.notify(`📌 Sticky replies ${stickyState}${cfg5.stickyReplies === false ? "" : where}`, "info");
                    break;
                }
                case "typing": {
                    const cfg4 = loadConfig();
                    const arg = parts[1];
                    if (arg === undefined) {
                        cfg4.typingIndicator = cfg4.typingIndicator === false;
                        saveConfig(cfg4);
                        if (cfg4.typingIndicator === false)
                            typingHeartbeat.stop();
                        const state = cfg4.typingIndicator === false ? "off" : "on";
                        context.ui.notify(`⌨️  Typing indicator ${state}`, "info");
                        break;
                    }
                    const seconds = Number.parseFloat(arg);
                    if (!Number.isFinite(seconds)) {
                        context.ui.notify("Usage: /msg-bridge typing [seconds] — 0 turns the indicator off", "error");
                        return;
                    }
                    if (seconds <= 0) {
                        cfg4.typingIndicator = false;
                        delete cfg4.typingRefreshMs;
                        saveConfig(cfg4);
                        typingHeartbeat.stop();
                        context.ui.notify("⌨️  Typing indicator off", "info");
                        break;
                    }
                    const ms = clampTypingRefreshMs(seconds * 1000);
                    cfg4.typingIndicator = true;
                    cfg4.typingRefreshMs = ms;
                    saveConfig(cfg4);
                    context.ui.notify(`⌨️  Typing indicator on, refreshed every ${ms / 1000}s`, "info");
                    break;
                }
                default:
                    context.ui.notify(`Unknown subcommand: ${subcommand}. Run /msg-bridge help`, "warning");
                    break;
            }
        },
    });
}
//# sourceMappingURL=index.js.map