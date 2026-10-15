import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Slack transport provider using @slack/bolt
 */
export declare class SlackProvider implements ITransportProvider {
    private config;
    private auth;
    readonly type = "slack";
    private app;
    private _isConnected;
    private botUserId;
    private messageHandler?;
    private errorHandler?;
    private lastProcessedMessageId;
    private userCache;
    private channelCache;
    constructor(config: {
        botToken: string;
        appToken: string;
    }, auth: ChallengeAuth);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(_chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
}
//# sourceMappingURL=slack.d.ts.map