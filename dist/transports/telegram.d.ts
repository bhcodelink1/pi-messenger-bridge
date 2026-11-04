import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage, MediaSettings, OutgoingMedia } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Telegram transport provider using node-telegram-bot-api
 */
export declare class TelegramProvider implements ITransportProvider {
    private token;
    private auth;
    private mediaSettings?;
    readonly type = "telegram";
    private bot?;
    private _isConnected;
    private messageHandler?;
    private errorHandler?;
    private lastProcessedMessageId;
    constructor(token: string, auth: ChallengeAuth, mediaSettings?: MediaSettings | undefined);
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
    /**
     * Send a file. Images Telegram can render go out through `sendPhoto` and show
     * as an inline preview; everything else, including SVG and PDF, goes through
     * `sendDocument`, which is also the only route above 5 MB.
     *
     * The caption is sent as plain text. MarkdownV1 in a caption hits the same
     * parse errors the body text did before `formatForTelegram` existed, and a
     * caption is not worth that failure mode.
     */
    sendMedia(chatId: string, media: OutgoingMedia): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    private handleMessage;
    /**
     * Download whatever images the message carries.
     *
     * Telegram sends a photo as an array of pre-cropped sizes, so the largest
     * entry is the one worth fetching. An image sent as a file lands in
     * `msg.document` instead, with a real mime type and file name.
     *
     * A download that fails is skipped rather than raised. Losing one attachment
     * should not cost the user the caption they typed with it.
     */
    private collectAttachments;
    /**
     * Fetch one Telegram file and return it as base64.
     *
     * `downloadFile` writes into a directory it does not create, so each file gets
     * its own temp directory, removed afterwards. Telegram expires the file about
     * an hour after the message arrives, which is why the bytes have to be read
     * now rather than handed to a later turn as an id.
     */
    private downloadAttachment;
}
//# sourceMappingURL=telegram.d.ts.map