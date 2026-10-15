import { withDeadline } from "../async-util.js";
import type { ExternalMessage } from "../types.js";
import type { ITransportProvider } from "./interface.js";

/**
 * Ceiling on the whole teardown. Pi awaits `session_shutdown` handlers before
 * it creates the next session, so an unreachable transport must not be able to
 * freeze session replacement.
 */
const DISCONNECT_DEADLINE_MS = 1000;

/**
 * Manages multiple transport providers and routes messages
 */
export class TransportManager {
  private transports = new Map<string, ITransportProvider>();
  private messageHandler?: (message: ExternalMessage) => void;
  private errorHandler?: (error: Error, transport: string) => void;

  /**
   * Register a transport provider
   */
  addTransport(transport: ITransportProvider): void {
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
  getTransport(type: string): ITransportProvider | undefined {
    return this.transports.get(type);
  }

  /**
   * Get all registered transports
   */
  getAllTransports(): ITransportProvider[] {
    return Array.from(this.transports.values());
  }

  /**
   * Connect all registered transports
   */
  async connectAll(): Promise<void> {
    const connections = Array.from(this.transports.values()).map((t) =>
      t.connect().catch((err) => {
        throw new Error(`${t.type} connection failed: ${(err as Error).message}`);
      })
    );
    await Promise.all(connections);
  }

  /**
   * Disconnect all transports, giving up after `deadlineMs`.
   *
   * Transports are disconnected concurrently and a transport that cannot finish
   * in time is left to complete in the background.
   */
  async disconnectAll(deadlineMs: number = DISCONNECT_DEADLINE_MS): Promise<void> {
    const disconnections = Array.from(this.transports.values()).map((t) =>
      t.disconnect().catch((err) => {
        console.warn(
          `[msg-bridge] ${t.type} disconnect failed: ${(err as Error).message}`
        );
      })
    );
    if (disconnections.length === 0) return;
    await withDeadline(Promise.allSettled(disconnections), deadlineMs);
  }

  /**
   * Send a message to a specific chat via a specific transport
   */
  async sendMessage(
    chatId: string,
    transportType: string,
    text: string
  ): Promise<void> {
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
  async sendTyping(chatId: string, transportType: string): Promise<void> {
    const transport = this.transports.get(transportType);
    if (transport?.isConnected) {
      await transport.sendTyping(chatId);
    }
  }

  /**
   * Register handler for incoming messages from all transports
   */
  onMessage(handler: (message: ExternalMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Register handler for errors from all transports
   */
  onError(handler: (error: Error, transport: string) => void): void {
    this.errorHandler = handler;
  }

  /**
   * Get connection status for all transports
   */
  getStatus(): Array<{ type: string; connected: boolean }> {
    return Array.from(this.transports.values()).map((t) => ({
      type: t.type,
      connected: t.isConnected,
    }));
  }
}
