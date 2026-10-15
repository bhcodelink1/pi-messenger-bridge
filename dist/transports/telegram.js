import TelegramBot from "node-telegram-bot-api";
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
    async connect() {
        if (this._isConnected)
            return;
        this.bot = new TelegramBot(this.token, {
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
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        });
        await this.bot.startPolling();
        this._isConnected = true;
    }
    async disconnect() {
        if (!this._isConnected || !this.bot)
            return;
        await this.bot.stopPolling();
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