import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Matrix transport provider using matrix-bot-sdk
 * Works with any Matrix homeserver — Element X, Element Web, FluffyChat, etc.
 */
export declare class MatrixProvider implements ITransportProvider {
    private config;
    private auth;
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
    }, auth: ChallengeAuth);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    private handleMessage;
}
//# sourceMappingURL=matrix.d.ts.map