import { withDeadline } from "../async-util.js";
/** How long to wait for the first getUpdates before treating connect as done. */
const FIRST_POLL_TIMEOUT_MS = 2000;
/**
 * Telegram transport provider using node-telegram-bot-api
 */
export class TelegramProvider {
    token;
    auth;
    type = "telegram";
    bot;
    _isConnected = false;
    messageHandler;
    errorHandler;
    lastProcessedMessageId = 0;
    constructor(token, auth) {
        this.token = token;
        this.auth = auth;
    }
    get isConnected() {
        return this._isConnected;
    }
    /**
     * Convert standard markdown to Telegram MarkdownV1 format.
     *
     * Telegram MarkdownV1 syntax: *bold*, _italic_, `code`, ```pre```, [text](url).
     * Per docs, only `_ * [ \`` need backslash-escaping when literal — otherwise
     * a stray `_` (e.g. in a snake_case tool name like `hud_canvas`) is parsed
     * as an opening italic marker with no close, returning HTTP 400.
     *
     * Strategy: lift valid markdown patterns into NUL-sentinel placeholders,
     * escape the remaining specials, then restore the placeholders.
     */
    formatForTelegram(text) {
        const lifted = [];
        const lift = (s) => `\x00${lifted.push(s) - 1}\x00`;
        // Lift valid markdown patterns in priority order — they bypass the escape step below.
        text = text.replace(/```[\s\S]*?```/g, lift); // code blocks
        text = text.replace(/`[^`]+`/g, lift); // inline code
        text = text.replace(/\*\*([^*]+?)\*\*/g, (_, c) => lift(`*${c}*`)); // **bold** → *bold*
        text = text.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, (_, c) => lift(`_${c}_`)); // *italic* → _italic_
        text = text.replace(/\[[^\]]+\]\([^)]+\)/g, lift); // [text](url)
        // Escape literal markdown specials so Telegram treats them as text.
        text = text.replace(/[_*[`]/g, "\\$&");
        return text.replace(/\x00(\d+)\x00/g, (_, i) => lifted[parseInt(i, 10)]);
    }
    /**
     * node-telegram-bot-api pulls in `request` and friends, which cost about
     * 100ms of module evaluation. Loading it here keeps that off the extension
     * startup path whenever Telegram is not the configured transport.
     */
    async loadTelegramBot() {
        const mod = await import("node-telegram-bot-api");
        return mod.default;
    }
    /**
     * A 409 from getUpdates means Telegram still has the previous long-poll
     * registered for this bot. That happens in the window right after a
     * reconnect. node-telegram-bot-api retries on its own, so it is not an error
     * worth surfacing.
     */
    static isPollOwnershipConflict(err) {
        const message = err instanceof Error ? err.message : String(err);
        return message.toLowerCase().includes("terminated by other getupdates");
    }
    async connect() {
        if (this._isConnected)
            return;
        const TelegramBotCtor = await this.loadTelegramBot();
        this.bot = new TelegramBotCtor(this.token, {
            polling: {
                interval: 300,
                autoStart: false,
            },
        });
        // Handle incoming messages
        this.bot.on("message", async (msg) => {
            try {
                await this.handleMessage(msg);
            }
            catch (err) {
                if (this.errorHandler) {
                    this.errorHandler(err);
                }
            }
        });
        // Handle polling errors
        this.bot.on("polling_error", (err) => {
            if (TelegramProvider.isPollOwnershipConflict(err))
                return;
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        });
        // startPolling() resolves when the *first* getUpdates comes back. With the
        // default 10s long-poll that is 10 seconds of dead time before the caller
        // learns the bot is up, so cap the wait and let the poll continue in the
        // background. Polling failures arrive through polling_error either way.
        const firstPoll = this.bot.startPolling().catch(() => undefined);
        await withDeadline(firstPoll, FIRST_POLL_TIMEOUT_MS);
        this._isConnected = true;
    }
    async disconnect() {
        if (!this._isConnected || !this.bot)
            return;
        // `stopPolling()` with no options waits for the in-flight getUpdates
        // long-poll to return from Telegram, up to `polling.params.timeout`
        // (10 seconds by default). Pi awaits `session_shutdown` handlers before it
        // builds the next session, so that wait froze the UI for 5-10s on every
        // /new, /resume, fork, /reload and quit. `cancel: true` aborts the pending
        // request instead and returns in about a millisecond.
        await this.bot.stopPolling({ cancel: true });
        this._isConnected = false;
        this.bot = undefined;
    }
    async sendMessage(chatId, text) {
        if (!this.bot) {
            throw new Error("Telegram bot not connected");
        }
        if (!text?.trim())
            return;
        const formattedText = this.formatForTelegram(text);
        await this.bot.sendMessage(chatId, formattedText, { parse_mode: "Markdown" });
    }
    async sendTyping(chatId) {
        if (!this.bot)
            return;
        await this.bot.sendChatAction(chatId, "typing");
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    onError(handler) {
        this.errorHandler = handler;
    }
    async handleMessage(msg) {
        // Filter out old messages (prevent stale message processing on reconnect)
        if (msg.message_id <= this.lastProcessedMessageId) {
            return;
        }
        this.lastProcessedMessageId = msg.message_id;
        // Only process text messages
        if (!msg.text || !msg.from) {
            return;
        }
        const chatId = msg.chat.id.toString();
        const userId = msg.from.id.toString();
        const username = msg.from.username || msg.from.first_name || "unknown";
        const isGroupChat = msg.chat.type !== "private";
        // Check if bot was mentioned in group chat
        let wasMentioned = false;
        if (isGroupChat && this.bot) {
            const botInfo = await this.bot.getMe();
            const botUsername = botInfo.username;
            wasMentioned =
                msg.text.includes(`@${botUsername}`) ||
                    (msg.entities?.some((entity) => entity.type === "mention" &&
                        msg.text.substring(entity.offset, entity.offset + entity.length) ===
                            `@${botUsername}`) ?? false);
        }
        // Check authorization (with sendMessage callback for challenge notifications)
        const sendMessageToUser = async (cId, text) => {
            if (this.bot) {
                await this.bot.sendMessage(cId, text, { parse_mode: "Markdown" });
            }
        };
        const isAuthorized = await this.auth.checkAuthorization(userId, chatId, username, isGroupChat, wasMentioned, sendMessageToUser, this.type);
        // Handle admin commands and challenge codes in DM (before auth check!)
        if (!isGroupChat && (msg.text.startsWith("/") || msg.text.match(/^\d{6}$/))) {
            const handled = await this.auth.handleAdminCommand(msg.text, chatId, userId, async (text) => await this.sendMessage(chatId, text), this.type);
            if (handled) {
                return;
            }
        }
        if (!isAuthorized) {
            return; // Auth handler already sent challenge/error messages
        }
        // Strip bot mention from message if present
        let content = msg.text;
        if (wasMentioned && this.bot) {
            const botInfo = await this.bot.getMe();
            const botUsername = botInfo.username;
            content = content.replace(new RegExp(`@${botUsername}\\s*`, "g"), "").trim();
        }
        // Forward to message handler
        if (this.messageHandler && content) {
            const externalMessage = {
                chatId,
                transport: this.type,
                content,
                username,
                userId,
                timestamp: new Date((msg.date || 0) * 1000),
                messageId: msg.message_id.toString(),
                isGroupChat,
                wasMentioned,
            };
            this.messageHandler(externalMessage);
        }
    }
}
//# sourceMappingURL=telegram.js.map