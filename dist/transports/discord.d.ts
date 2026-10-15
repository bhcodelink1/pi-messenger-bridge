import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Discord transport provider using discord.js
 */
export declare class DiscordProvider implements ITransportProvider {
    private config;
    private auth;
    readonly type = "discord";
    private client;
    private _isConnected;
    private botUserId;
    private messageHandler?;
    private errorHandler?;
    private lastProcessedMessageId;
    constructor(config: {
        token: string;
    }, auth: ChallengeAuth);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    /**
     * Split a message into chunks that fit Discord's 2000 char limit.
     * Tries to split at newlines or spaces when possible.
     */
    private splitMessage;
}
//# sourceMappingURL=discord.d.ts.map