/**
 * TransportManager.disconnectAll must not be able to hold up whoever awaits it.
 * Pi awaits `session_shutdown` handlers before it creates the next session, and
 * a transport whose teardown waits on the network (Telegram's getUpdates
 * long-poll, a Matrix sync loop) can block for seconds.
 */
import { describe, expect, it } from 'vitest';
import { TransportManager } from '../src/transports/manager';
import type { ITransportProvider } from '../src/transports/interface';

function provider(
  type: string,
  disconnect: () => Promise<void>
): ITransportProvider {
  return {
    type,
    isConnected: true,
    connect: async () => {},
    disconnect,
    sendMessage: async () => {},
    sendTyping: async () => {},
    onMessage: () => {},
    onError: () => {},
  } as unknown as ITransportProvider;
}

const never = () => new Promise<void>(() => {});

describe('TransportManager.disconnectAll', () => {
  it('gives up on a transport that never finishes disconnecting', async () => {
    const manager = new TransportManager();
    manager.addTransport(provider('telegram', never));

    const started = Date.now();
    await manager.disconnectAll(50);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('waits for a transport that disconnects inside the deadline', async () => {
    let finished = false;
    const manager = new TransportManager();
    manager.addTransport(
      provider('telegram', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        finished = true;
      })
    );

    await manager.disconnectAll(2000);

    expect(finished).toBe(true);
  });

  it('swallows a disconnect error instead of failing the caller', async () => {
    const manager = new TransportManager();
    manager.addTransport(
      provider('matrix', async () => {
        throw new Error('homeserver unreachable');
      })
    );

    await expect(manager.disconnectAll(100)).resolves.toBeUndefined();
  });

  it('returns immediately when nothing is registered', async () => {
    const manager = new TransportManager();

    await expect(manager.disconnectAll(50)).resolves.toBeUndefined();
  });
});
