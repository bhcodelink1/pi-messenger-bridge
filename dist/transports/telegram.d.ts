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
    /**
     * node-telegram-bot-api pulls in `request` and friends, which cost about
     * 100ms of module evaluation. Loading it here keeps that off the extension
     * startup path whenever Telegram is not the configured transport.
     */
    private loadTelegramBot;
    /**
     * A 409 from getUpdates means Telegram still has the previous long-poll
     * registered for this bot. That happens in the window right after a
     * reconnect. node-telegram-bot-api retries on its own, so it is not an error
     * worth surfacing.
     */
    private static isPollOwnershipConflict;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    private handleMessage;
}
//# sourceMappingURL=telegram.d.ts.map