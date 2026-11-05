import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage, MediaSettings, OutgoingMedia } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Matrix transport provider using matrix-bot-sdk
 * Works with any Matrix homeserver — Element X, Element Web, FluffyChat, etc.
 */
export declare class MatrixProvider implements ITransportProvider {
    private config;
    private auth;
    private mediaSettings?;
    readonly type = "matrix";
    private client?;
    private _isConnected;
    private messageHandler?;
    private errorHandler?;
    private botUserId?;
    private joinedRooms;
    private roomMemberCount;
    private connectedAt;
    constructor(config: {
        homeserverUrl: string;
        accessToken: string;
        encryption?: boolean;
    }, auth: ChallengeAuth, mediaSettings?: MediaSettings | undefined);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    /**
     * Send a file to a room.
     *
     * Matrix stores bytes in a media repository and references them by `mxc://`
     * URI, so an upload always precedes the event. In an encrypted room the file
     * itself is encrypted too, separately from the event: `encryptMedia` produces
     * the ciphertext plus the key/hash descriptor that goes in `content.file`, and
     * the ciphertext is what gets uploaded. Sending the plaintext bytes to an
     * encrypted room would leak the image to the homeserver.
     */
    sendMedia(chatId: string, media: OutgoingMedia): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    /**
     * Fetch one media reference and return it as base64.
     *
     * An encrypted descriptor has to go through `crypto.decryptMedia`, which
     * downloads and decrypts in one step. A plain reference downloads straight
     * from the media repository.
     */
    private downloadAttachment;
    private handleMessage;
}
//# sourceMappingURL=matrix.d.ts.map