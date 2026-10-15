/**
 * Extension-level regression test for the sticky reply fix.
 *
 * Drives the real `turn_end` handler in src/index.ts with a stub
 * TransportManager, so the whole path is covered: an inbound messenger message
 * arms the target, the turn that answers it clears the in-flight request, and a
 * later turn (a subagent report arriving minutes afterwards) must still reach
 * the same chat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { resetRuntime } from '../src/runtime';

type Send = { chatId: string; transport: string; text: string };

const sent: Send[] = [];
const userMessages: string[] = [];
let inboundHandler: ((msg: any) => void) | null = null;
let disconnectAllCalls = 0;
let config: Record<string, unknown> = {};

vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>();
  return {
    ...actual,
    loadConfig: () => ({ ...config }),
    saveConfig: (next: Record<string, unknown>) => {
      config = { ...next };
    },
  };
});

vi.mock('../src/lock', () => ({
  acquireLock: () => true,
  releaseLock: () => {},
}));

vi.mock('../src/transports/manager', () => ({
  TransportManager: class {
    addTransport(): void {}
    getStatus(): Array<{ type: string; connected: boolean }> {
      return [];
    }
    getAllTransports(): never[] {
      return [];
    }
    async connectAll(): Promise<void> {}
    async disconnectAll(): Promise<void> {
      disconnectAllCalls++;
    }
    onMessage(cb: (msg: any) => void): void {
      inboundHandler = cb;
    }
    onError(): void {}
    async sendMessage(chatId: string, transport: string, text: string): Promise<void> {
      sent.push({ chatId, transport, text });
    }
    async sendTyping(): Promise<void> {}
  },
}));

vi.mock('../src/transports/telegram', () => ({
  TelegramProvider: class {
    async connect(): Promise<void> {}
  },
}));
vi.mock('../src/transports/whatsapp', () => ({
  WhatsAppProvider: class {
    async connect(): Promise<void> {}
  },
}));
vi.mock('../src/transports/slack', () => ({
  SlackProvider: class {
    async connect(): Promise<void> {}
  },
}));
vi.mock('../src/transports/discord', () => ({
  DiscordProvider: class {
    async connect(): Promise<void> {}
  },
}));
vi.mock('../src/transports/matrix', () => ({
  MatrixProvider: class {
    async connect(): Promise<void> {}
  },
}));

type Handler = (event: any, context: any) => Promise<void>;

async function loadExtension() {
  const handlers = new Map<string, Handler>();
  const ui = {
    notify: () => {},
    setWidget: () => {},
    select: async () => undefined,
    input: async () => undefined,
  };
  const context = { ui, sessionManager: { getSessionDir: () => '/tmp' } };

  const pi = {
    on: (type: string, handler: Handler) => {
      handlers.set(type, handler);
    },
    registerCommand: () => {},
    sendUserMessage: (text: string) => {
      userMessages.push(text);
    },
    appendEntry: () => {},
  };

  const mod = await import('../src/index');
  mod.default(pi as never);
  await handlers.get('session_start')?.({}, context);

  return {
    turnStart: (message: unknown) => handlers.get('turn_end')?.({ message }, context),
    shutdown: (reason: string) =>
      handlers.get('session_shutdown')?.({ reason }, context),
    start: (reason = 'new') => handlers.get('session_start')?.({ reason }, context),
    ui,
  };
}

const textBlock = (text: string) => ({ type: 'text', text });
const toolBlock = (name: string) => ({ type: 'toolCall', name, arguments: { tasks: [] } });

function assistant(content: unknown[]): AssistantMessage {
  return { role: 'assistant', content } as unknown as AssistantMessage;
}

function inbound(content: string) {
  inboundHandler?.({
    chatId: '8341035574',
    transport: 'telegram',
    username: 'Bala',
    messageId: '42',
    content,
    userId: '8341035574',
    timestamp: new Date(),
    isGroupChat: false,
  });
}

beforeEach(async () => {
  sent.length = 0;
  userMessages.length = 0;
  inboundHandler = null;
  disconnectAllCalls = 0;
  config = { telegram: { token: 'test' }, hideToolCalls: true };
  // Transports and the sticky target live on globalThis for the lifetime of
  // the process, so each case has to clear them to start from a cold boot.
  resetRuntime();
  vi.resetModules();
});

describe('turn_end delivery through the extension', () => {
  it('delivers a turn that finishes after the request was already answered', async () => {
    const { turnStart } = await loadExtension();

    inbound('what are futures saying today');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toContain('via telegram');

    // Turn 1: the orchestrator hands the work to a background subagent.
    await turnStart(assistant([toolBlock('spawn')]));
    expect(sent).toHaveLength(0); // hideToolCalls is on, nothing to send yet

    // Turn 2: "the subagent is running" answers the request and clears it.
    await turnStart(assistant([textBlock('Subagent 17c970ce is pulling futures data.')]));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: '8341035574', transport: 'telegram' });

    // Turn 3: the report arrives 11 minutes later with no messenger message.
    await turnStart(assistant([textBlock('ES -0.30%, NQ -1.25%. Put/call 0.88.')]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain('Put/call 0.88');
    expect(sent[1]).toMatchObject({ chatId: '8341035574', transport: 'telegram' });
  });

  it('stops delivering late turns when stickyReplies is off', async () => {
    config.stickyReplies = false;
    const { turnStart } = await loadExtension();

    inbound('what are futures saying today');
    await turnStart(assistant([textBlock('Subagent is running.')]));
    await turnStart(assistant([textBlock('ES -0.30%.')]));

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Subagent is running');
  });

  it('sends nothing before any messenger message has arrived', async () => {
    const { turnStart } = await loadExtension();

    await turnStart(assistant([textBlock('work done at the terminal')]));

    expect(sent).toHaveLength(0);
  });

  it('keeps the request open across tool-only turns and still answers it', async () => {
    config.hideToolCalls = false;
    const { turnStart } = await loadExtension();

    inbound('check the build');
    await turnStart(assistant([toolBlock('bash')]));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('bash');

    await turnStart(assistant([textBlock('build passed')]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe('build passed');

    // The request is finished now; a later turn goes out as a sticky reply.
    await turnStart(assistant([textBlock('and tests pass too')]));
    expect(sent).toHaveLength(3);
  });

  it('routes a late turn to the chat that last wrote to the bot', async () => {
    const { turnStart } = await loadExtension();

    inbound('first question');
    await turnStart(assistant([textBlock('first answer')]));

    inboundHandler?.({
      chatId: 'room:matrix',
      transport: 'matrix',
      username: 'Bala',
      messageId: '7',
      content: 'second question',
      userId: 'bala',
      timestamp: new Date(),
      isGroupChat: false,
    });
    await turnStart(assistant([textBlock('second answer')]));

    await turnStart(assistant([textBlock('late report')]));

    expect(sent.map((s) => s.transport)).toEqual(['telegram', 'matrix', 'matrix']);
  });
});

/**
 * Pi re-runs the extension factory on every session replacement (/new, /clear,
 * /resume, fork, /reload) and awaits `session_shutdown` handlers before it
 * builds the next session. Disconnecting there froze the terminal for 5-10s per
 * session change and made Telegram answer the fresh long-poll with a 409.
 */
describe('session replacement', () => {
  it('keeps messenger connections open when pi replaces the session', async () => {
    const { shutdown } = await loadExtension();

    await shutdown('new');
    await shutdown('resume');
    await shutdown('fork');
    await shutdown('reload');

    expect(disconnectAllCalls).toBe(0);
  });

  it('disconnects transports when pi quits', async () => {
    const { shutdown } = await loadExtension();

    await shutdown('quit');

    expect(disconnectAllCalls).toBe(1);
  });

  it('rebuilds transports once, not once per session', async () => {
    await loadExtension();
    expect(inboundHandler).not.toBeNull();

    // The mock records whatever handler onMessage last received. Clearing it and
    // starting a second session proves the second session does not register a
    // second set of transports for the same process.
    inboundHandler = null;
    const second = await loadExtension();
    await second.start('new');

    expect(inboundHandler).toBeNull();
  });

  it('routes inbound messages to the session that is alive now', async () => {
    await loadExtension();
    userMessages.length = 0;

    const second = await loadExtension();
    await second.start('new');

    inbound('still reachable after /new');

    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toContain('via telegram');
  });

  it('drops inbound messages while no session owns the bridge', async () => {
    const { shutdown } = await loadExtension();
    await shutdown('new');

    inbound('arrives in the gap between sessions');

    expect(userMessages).toHaveLength(0);
  });

  it('keeps the sticky reply target across a session replacement', async () => {
    const first = await loadExtension();

    inbound('start a background job');
    await first.turnStart(assistant([textBlock('started it')]));
    expect(sent).toHaveLength(1);

    await first.shutdown('new');
    const second = await loadExtension();
    await second.start('new');

    await second.turnStart(assistant([textBlock('the job finished')]));

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ chatId: '8341035574', transport: 'telegram' });
  });
});
