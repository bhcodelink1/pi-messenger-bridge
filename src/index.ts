import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChallengeAuth } from "./auth/challenge-auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { splitMessage } from "./formatting.js";
import { acquireLock, releaseLock } from "./lock.js";
import { planTurnReply } from "./reply-routing.js";
import { DiscordProvider } from "./transports/discord.js";
import { TransportManager } from "./transports/manager.js";
import { MatrixProvider } from "./transports/matrix.js";
import { SlackProvider } from "./transports/slack.js";
import { TelegramProvider } from "./transports/telegram.js";
import { WhatsAppProvider } from "./transports/whatsapp.js";
import type { PendingRemoteChat, TransportStatus } from "./types.js";
import { clampTypingRefreshMs, TypingHeartbeat } from "./typing.js";
import { openMainMenu } from "./ui/main-menu.js";
import { createStatusWidget } from "./ui/status-widget.js";

/**
 * pi-remote-pilot extension
 * Bridges messenger apps (Telegram, WhatsApp, Slack, Discord) into pi
 */
export default function (pi: ExtensionAPI): void {
  const transportManager = new TransportManager();
  let pendingRemoteChat: PendingRemoteChat | null = null;
  /**
   * The last chat a message arrived from. `pendingRemoteChat` is cleared as soon
   * as a turn finishes answering it, which drops any later turn that produces
   * the real result. This one is never cleared, so those turns still have a
   * destination. See `planTurnReply`.
   */
  let stickyRemoteChat: PendingRemoteChat | null = null;
  let auth: ChallengeAuth;
  let ctx: ExtensionContext;

  const typingHeartbeat = new TypingHeartbeat(transportManager, () => {
    const config = loadConfig();
    if (config.typingIndicator === false) return 0;
    return config.typingRefreshMs;
  });

  /**
   * The chat to keep a typing indicator alive for, or null when indicators are
   * disabled or no remote request is in flight.
   */
  function typingTarget(): PendingRemoteChat | null {
    if (!pendingRemoteChat) return null;
    if (loadConfig().typingIndicator === false) return null;
    return pendingRemoteChat;
  }

  /**
   * Update status widget
   */
  function updateWidget(): void {
    const config = loadConfig();

    if (config.showWidget === false) {
      ctx.ui.setWidget("msg-bridge-status", undefined);
      return;
    }

    const stats = auth.getStats();
    const transports: TransportStatus[] = transportManager
      .getStatus()
      .map((s) => ({
        type: s.type,
        connected: s.connected,
      }));

    const widget = createStatusWidget(transports, stats.usersByTransport);
    if (widget) {
      ctx.ui.setWidget("msg-bridge-status", [widget]);
    } else {
      ctx.ui.setWidget("msg-bridge-status", undefined);
    }
  }

  /**
   * Save auth state to config
   */
  function saveAuthState(): void {
    const config = loadConfig();
    config.auth = auth.exportConfig();
    saveConfig(config);
  }

  /**
   * Initialize extension
   */
  pi.on("session_start", async (_event, context) => {
    ctx = context;

    const config = loadConfig();

    auth = new ChallengeAuth(
      (code, username) => {
        ctx.ui.notify(
          `🔐 Challenge code for @${username}: ${code}`,
          "info"
        );
      },
      (message, level) => {
        ctx.ui.notify(message, level);
      },
      async (_chatId, _message) => {
        // Challenge notifications are sent via the transport's sendMessage
      },
      saveAuthState
    );

    if (config.auth) {
      auth.loadFromConfig(config.auth);
    }

    // Initialize transports in the background (non-blocking)
    (async () => {
      const transportPromises: Promise<void>[] = [];

      if (config.telegram?.token) {
        transportPromises.push(
          Promise.resolve().then(() => {
            const telegramProvider = new TelegramProvider(config.telegram!.token, auth);
            transportManager.addTransport(telegramProvider);
          })
        );
      }

      if (config.whatsapp) {
        const whatsappAuthPath = config.whatsapp.authPath || path.join(
          os.homedir(),
          ".pi",
          "msg-bridge-whatsapp-auth"
        );

        const credsPath = path.join(whatsappAuthPath, "creds.json");
        if (fs.existsSync(credsPath)) {
          transportPromises.push(
            Promise.resolve().then(() => {
              const whatsappConfig = { ...config.whatsapp!, debug: config.debug };
              const whatsappProvider = new WhatsAppProvider(whatsappConfig, auth);
              transportManager.addTransport(whatsappProvider);
            })
          );
        } else {
          delete config.whatsapp;
          saveConfig(config);
        }
      }

      if (config.slack?.botToken && config.slack?.appToken) {
        transportPromises.push(
          Promise.resolve().then(() => {
            const slackProvider = new SlackProvider(config.slack!, auth);
            transportManager.addTransport(slackProvider);
          })
        );
      }

      if (config.discord?.token) {
        transportPromises.push(
          Promise.resolve().then(() => {
            const discordProvider = new DiscordProvider(config.discord!, auth);
            transportManager.addTransport(discordProvider);
          })
        );
      }

      if (config.matrix?.homeserverUrl && config.matrix?.accessToken) {
        transportPromises.push(
          Promise.resolve().then(() => {
            const matrixProvider = new MatrixProvider(config.matrix!, auth);
            transportManager.addTransport(matrixProvider);
          })
        );
      }

      await Promise.all(transportPromises);

      // Auto-connect if configured
      const transports = transportManager.getAllTransports();
      if (transports.length > 0 && config.autoConnect !== false) {
        if (!acquireLock()) {
          ctx.ui.notify("ℹ️ msg-bridge: another instance is already connected — skipping auto-connect", "info");
        } else {
          try {
            await transportManager.connectAll();
            updateWidget();
          } catch (err) {
            releaseLock();
            ctx.ui.notify(`⚠️ Some transports failed to connect: ${(err as Error).message}`, "warning");
          }
        }
      }
    })().catch(err => {
      console.error("Transport initialization error:", err);
      ctx.ui.notify(`❌ Transport initialization failed: ${err.message}`, "error");
    });

    transportManager.onMessage((msg) => {
      pendingRemoteChat = {
        chatId: msg.chatId,
        transport: msg.transport,
        username: msg.username,
        messageId: msg.messageId,
      };
      stickyRemoteChat = pendingRemoteChat;

      const taggedMessage = `[📱 @${msg.username} via ${msg.transport}]: ${msg.content}`;
      pi.sendUserMessage(taggedMessage, { deliverAs: "followUp" });
    });

    transportManager.onError((err, transport) => {
      ctx.ui.notify(`❌ ${transport} error: ${err.message}`, "error");
    });

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
      message: event.message as AssistantMessage,
      pendingRemoteChat,
      stickyRemoteChat,
      config,
    });

    if (!plan.target || plan.text === "") return;
    const target = plan.target;

    try {
      // Split long messages for Telegram's 4096 char limit
      const chunks = splitMessage(plan.text, 4000);
      for (const chunk of chunks) {
        await transportManager.sendMessage(target.chatId, target.transport, chunk);
      }

      if (plan.clearPending) {
        pendingRemoteChat = null;
        typingHeartbeat.stop();
      }
    } catch (err) {
      ctx.ui.notify(
        `Failed to send response to ${target.transport}: ${(err as Error).message}`,
        "error"
      );
      pendingRemoteChat = null;
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
   * Cleanup on session exit — release lock and disconnect transports
   */
  pi.on("session_shutdown", async (_event, _context) => {
    typingHeartbeat.stop();
    await transportManager.disconnectAll();
    releaseLock();
  });

  /**
   * /msg-bridge command - show status or manage connections
   */
  pi.registerCommand("msg-bridge", {
    description:
      "Manage remote messenger connections (help|status|connect|disconnect|configure|widget|typing|sticky)",
    handler: async (args: string, context) => {
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
        } catch (err) {
          releaseLock();
          context.ui.notify(
            `❌ Connection failed: ${(err as Error).message}`,
            "error"
          );
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
              } catch (_err) {
                releaseLock();
                context.ui.notify("✅ Telegram configured (run /msg-bridge connect to activate)", "info");
              }
            } else {
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
              } catch (err) {
                releaseLock();
                context.ui.notify(`⚠️ WhatsApp setup error: ${(err as Error).message}`, "error");
              }
            } else {
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
              } catch (err) {
                releaseLock();
                context.ui.notify(`⚠️ Slack setup error: ${(err as Error).message}`, "error");
              }
            } else {
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
              } catch (err) {
                releaseLock();
                context.ui.notify(`⚠️ Discord setup error: ${(err as Error).message}`, "error");
              }
            } else {
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
              } catch (err) {
                releaseLock();
                context.ui.notify(`⚠️ Matrix setup error: ${(err as Error).message}`, "error");
              }
            } else {
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
          ...status.map(
            (s) => `  ${s.connected ? "●" : "○"} ${s.type}`
          ),
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
        lines.push(
          `Sticky replies: ${stickyOn ? "on" : "off"}${
            stickyRemoteChat
              ? ` -> ${stickyRemoteChat.transport}:${stickyRemoteChat.chatId}`
              : " (no messenger chat seen yet this session)"
          }`
        );
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
        } else if (arg === "on" || arg === "true") {
          cfg5.stickyReplies = true;
        } else if (arg === "off" || arg === "false") {
          cfg5.stickyReplies = false;
        } else {
          context.ui.notify("Usage: /msg-bridge sticky [on|off]", "error");
          return;
        }

        saveConfig(cfg5);
        const stickyState = cfg5.stickyReplies === false ? "off" : "on";
        const where = stickyRemoteChat
          ? ` -> ${stickyRemoteChat.transport}:${stickyRemoteChat.chatId}`
          : " (no messenger chat seen yet this session)";
        context.ui.notify(
          `📌 Sticky replies ${stickyState}${cfg5.stickyReplies === false ? "" : where}`,
          "info"
        );
        break;
      }

      case "typing": {
        const cfg4 = loadConfig();
        const arg = parts[1];

        if (arg === undefined) {
          cfg4.typingIndicator = cfg4.typingIndicator === false;
          saveConfig(cfg4);
          if (cfg4.typingIndicator === false) typingHeartbeat.stop();
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
        context.ui.notify(
          `⌨️  Typing indicator on, refreshed every ${ms / 1000}s`,
          "info"
        );
        break;
      }

      default:
        context.ui.notify(`Unknown subcommand: ${subcommand}. Run /msg-bridge help`, "warning");
        break;
    }
    },
  });
}
