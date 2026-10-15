import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Telegram transport provider using node-telegram-bot-api
 */
export declare class TelegramProvider implements ITransportProvider {
    private token;
    private auth;
    readonly type = "telegram";
    private bot?;
    private _isConnected;
    private messageHandler?;
    private errorHandler?;
    private lastProcessedMessageId;
    constructor(token: string, auth: ChallengeAuth);
    get isConnected(): boolean;
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
    private formatForTelegram;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    private handleMessage;
}
//# sourceMappingURL=telegram.d.ts.map