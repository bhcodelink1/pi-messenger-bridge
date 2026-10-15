/**
 * Manages multiple transport providers and routes messages
 */
export class TransportManager {
    transports = new Map();
    messageHandler;
    errorHandler;
    /**
     * Register a transport provider
     */
    addTransport(transport) {
        this.transports.set(transport.type, transport);
        // Forward messages from this transport
        transport.onMessage((msg) => {
            if (this.messageHandler) {
                this.messageHandler(msg);
            }
        });
        // Forward errors from this transport
        transport.onError((err) => {
            if (this.errorHandler) {
                this.errorHandler(err, transport.type);
            }
        });
    }
    /**
     * Get a specific transport by type
     */
    getTransport(type) {
        return this.transports.get(type);
    }
    /**
     * Get all registered transports
     */
    getAllTransports() {
        return Array.from(this.transports.values());
    }
    /**
     * Connect all registered transports
     */
    async connectAll() {
        const connections = Array.from(this.transports.values()).map((t) => t.connect().catch((err) => {
            throw new Error(`${t.type} connection failed: ${err.message}`);
        }));
        await Promise.all(connections);
    }
    /**
     * Disconnect all transports
     */
    async disconnectAll() {
        const disconnections = Array.from(this.transports.values()).map((t) => t.disconnect());
        await Promise.allSettled(disconnections);
    }
    /**
     * Send a message to a specific chat via a specific transport
     */
    async sendMessage(chatId, transportType, text) {
        const transport = this.transports.get(transportType);
        if (!transport) {
            throw new Error(`Transport ${transportType} not found`);
        }
        if (!transport.isConnected) {
            throw new Error(`Transport ${transportType} not connected`);
        }
        await transport.sendMessage(chatId, text);
    }
    /**
     * Send typing indicator to a chat via a specific transport
     */
    async sendTyping(chatId, transportType) {
        const transport = this.transports.get(transportType);
        if (transport?.isConnected) {
            await transport.sendTyping(chatId);
        }
    }
    /**
     * Register handler for incoming messages from all transports
     */
    onMessage(handler) {
        this.messageHandler = handler;
    }
    /**
     * Register handler for errors from all transports
     */
    onError(handler) {
        this.errorHandler = handler;
    }
    /**
     * Get connection status for all transports
     */
    getStatus() {
        return Array.from(this.transports.values()).map((t) => ({
            type: t.type,
            connected: t.isConnected,
        }));
    }
}
//# sourceMappingURL=manager.js.map