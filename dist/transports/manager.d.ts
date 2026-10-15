import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";
/**
 * Manages multiple transport providers and routes messages
 */
export declare class TransportManager {
    private transports;
    private messageHandler?;
    private errorHandler?;
    /**
     * Register a transport provider
     */
    addTransport(transport: ITransportProvider): void;
    /**
     * Get a specific transport by type
     */
    getTransport(type: string): ITransportProvider | undefined;
    /**
     * Get all registered transports
     */
    getAllTransports(): ITransportProvider[];
    /**
     * Connect all registered transports
     */
    connectAll(): Promise<void>;
    /**
     * Disconnect all transports
     */
    disconnectAll(): Promise<void>;
    /**
     * Send a message to a specific chat via a specific transport
     */
    sendMessage(chatId: string, transportType: string, text: string): Promise<void>;
    /**
     * Send typing indicator to a chat via a specific transport
     */
    sendTyping(chatId: string, transportType: string): Promise<void>;
    /**
     * Register handler for incoming messages from all transports
     */
    onMessage(handler: (message: ExternalMessage) => void): void;
    /**
     * Register handler for errors from all transports
     */
    onError(handler: (error: Error, transport: string) => void): void;
    /**
     * Get connection status for all transports
     */
    getStatus(): Array<{
        type: string;
        connected: boolean;
    }>;
}
//# sourceMappingURL=manager.d.ts.map