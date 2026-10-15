import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * WhatsApp transport provider using @whiskeysockets/baileys
 */
export declare class WhatsAppProvider implements ITransportProvider {
    private auth;
    readonly type = "whatsapp";
    private socket;
    private _isConnected;
    private authPath;
    private messageHandler?;
    private errorHandler?;
    private lastProcessedMessageId;
    private debug;
    private isManualConnect;
    constructor(config: {
        authPath?: string;
        debug?: boolean;
    }, auth: ChallengeAuth);
    get isConnected(): boolean;
    connect(manual?: boolean): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendTyping(chatId: string): Promise<void>;
    onMessage(handler: (message: ExternalMessage) => void): void;
    onError(handler: (error: Error) => void): void;
    private handleMessage;
}
//# sourceMappingURL=whatsapp.d.ts.map