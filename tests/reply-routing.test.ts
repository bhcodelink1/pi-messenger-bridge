import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { planTurnReply } from '../src/reply-routing';
import type { MsgBridgeConfig, PendingRemoteChat } from '../src/types';

const requester: PendingRemoteChat = {
  chatId: '123456',
  transport: 'telegram',
  username: 'tester',
  messageId: '1',
};

/** Build the minimal assistant message shape the router reads. */
function message(content: unknown[]): AssistantMessage {
  return { role: 'assistant', content } as unknown as AssistantMessage;
}

const textBlock = (text: string) => ({ type: 'text', text });
const toolBlock = (name = 'spawn') => ({ type: 'toolCall', name, arguments: { tasks: [] } });

function plan(options: {
  content?: unknown[];
  pendingRemoteChat?: PendingRemoteChat | null;
  stickyRemoteChat?: PendingRemoteChat | null;
  config?: MsgBridgeConfig;
  interimSent?: boolean;
}) {
  return planTurnReply({
    message: message(options.content ?? []),
    pendingRemoteChat: options.pendingRemoteChat ?? null,
    stickyRemoteChat: options.stickyRemoteChat ?? null,
    config: options.config ?? {},
    interimSent: options.interimSent,
  });
}

describe('planTurnReply with a request in flight', () => {
  it('sends text to the requesting chat and clears it when the turn is finished', () => {
    const result = plan({
      content: [textBlock('done')],
      pendingRemoteChat: requester,
      stickyRemoteChat: requester,
    });

    expect(result.target).toBe(requester);
    expect(result.text).toBe('done');
    expect(result.sticky).toBe(false);
    expect(result.clearPending).toBe(true);
  });

  it('keeps the request open while the turn still has tool calls', () => {
    const result = plan({
      content: [textBlock('working'), toolBlock()],
      pendingRemoteChat: requester,
    });

    expect(result.text).toContain('working');
    expect(result.text).toContain('spawn');
    expect(result.clearPending).toBe(false);
  });

  it('sends the tool call summary alone when the turn produced no text', () => {
    const result = plan({ content: [toolBlock('bash')], pendingRemoteChat: requester });

    expect(result.target).toBe(requester);
    expect(result.text).toBe('🔧 `bash` (tasks=[])');
    expect(result.clearPending).toBe(false);
  });

  it('omits the tool call summary when hideToolCalls is set', () => {
    const result = plan({
      content: [textBlock('done'), toolBlock()],
      pendingRemoteChat: requester,
      config: { hideToolCalls: true },
    });

    expect(result.text).toBe('done');
  });

  it('sends nothing and leaves the request open for an empty turn', () => {
    const result = plan({ content: [], pendingRemoteChat: requester, stickyRemoteChat: requester });

    expect(result.target).toBeNull();
    expect(result.text).toBe('');
    expect(result.clearPending).toBe(false);
  });

  it('ignores whitespace-only text', () => {
    const result = plan({
      content: [textBlock('   \n  ')],
      pendingRemoteChat: requester,
      stickyRemoteChat: requester,
    });

    expect(result.target).toBeNull();
  });
});

describe('planTurnReply with no request in flight', () => {
  it('delivers a late turn to the sticky chat', () => {
    const result = plan({
      content: [textBlock('subagent report')],
      pendingRemoteChat: null,
      stickyRemoteChat: requester,
    });

    expect(result.target).toBe(requester);
    expect(result.text).toBe('subagent report');
    expect(result.sticky).toBe(true);
    expect(result.clearPending).toBe(false);
  });

  it('drops tool call summaries from sticky replies', () => {
    const result = plan({
      content: [textBlock('still working'), toolBlock()],
      pendingRemoteChat: null,
      stickyRemoteChat: requester,
    });

    expect(result.text).toBe('still working');
    expect(result.text).not.toContain('toolCall');
  });

  it('sends nothing when the sticky reply option is off', () => {
    const result = plan({
      content: [textBlock('subagent report')],
      stickyRemoteChat: requester,
      config: { stickyReplies: false },
    });

    expect(result.target).toBeNull();
  });

  it('sends nothing when no messenger chat has been seen', () => {
    const result = plan({ content: [textBlock('subagent report')] });

    expect(result.target).toBeNull();
  });

  it('sends nothing for a tool-call-only late turn', () => {
    const result = plan({
      content: [toolBlock()],
      stickyRemoteChat: requester,
    });

    expect(result.target).toBeNull();
  });
});

describe('planTurnReply target precedence', () => {
  it('prefers the requesting chat over a different sticky chat', () => {
    const sticky: PendingRemoteChat = { ...requester, chatId: '999', transport: 'matrix' };

    const result = plan({
      content: [textBlock('answer')],
      pendingRemoteChat: requester,
      stickyRemoteChat: sticky,
    });

    expect(result.target).toBe(requester);
    expect(result.sticky).toBe(false);
  });
});

describe('planTurnReply interimMessages', () => {
  it('defaults to sending prose on every turn, including tool-calling ones', () => {
    const result = plan({
      content: [textBlock('still digging'), toolBlock()],
      pendingRemoteChat: requester,
      interimSent: true,
    });

    expect(result.text).toContain('still digging');
    expect(result.interim).toBe(true);
  });

  it('"first" lets the acknowledgement on a tool-calling turn through', () => {
    const result = plan({
      content: [textBlock('Checking the review scores for you.'), toolBlock('spawn')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'first', hideToolCalls: true },
      interimSent: false,
    });

    expect(result.text).toBe('Checking the review scores for you.');
    expect(result.interim).toBe(true);
    expect(result.clearPending).toBe(false);
  });

  it('"first" silences the narration on every later tool-calling turn', () => {
    const result = plan({
      content: [textBlock('Zillow blocked me, trying Movoto next.'), toolBlock('bash')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'first' },
      interimSent: true,
    });

    expect(result.target).toBeNull();
    expect(result.text).toBe('');
  });

  it('"first" still delivers the final answer, which is the turn with no tool calls', () => {
    const result = plan({
      content: [textBlock('Dark Matter holds 6.6 on Rotten Tomatoes.')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'first' },
      interimSent: true,
    });

    expect(result.text).toContain('Rotten Tomatoes');
    expect(result.clearPending).toBe(true);
    expect(result.interim).toBe(false);
  });

  it('"first" silences the tool call summary on a suppressed turn too', () => {
    const result = plan({
      content: [toolBlock('bash')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'first' },
      interimSent: true,
    });

    expect(result.target).toBeNull();
  });

  it('"off" sends nothing at all until the work finishes', () => {
    const ack = plan({
      content: [textBlock('Looking into it.'), toolBlock('spawn')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'off' },
    });
    const done = plan({
      content: [textBlock('Here is the answer.')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'off' },
    });

    expect(ack.target).toBeNull();
    expect(done.text).toContain('Here is the answer.');
  });

  it('a suppressed turn leaves the in-flight request alone for the answer to land on', () => {
    const suppressed = plan({
      content: [textBlock('half a thought'), toolBlock('bash')],
      pendingRemoteChat: requester,
      config: { interimMessages: 'first' },
      interimSent: true,
    });

    // clearPending false is what keeps the request alive; the caller must not
    // clear it on a turn that sent nothing, and NO_REPLY carries false.
    expect(suppressed.clearPending).toBe(false);
  });

  it('"first" drops a tool-calling sticky turn, which is terminal work narrating at a phone', () => {
    const result = plan({
      content: [textBlock('running the second query'), toolBlock('bash')],
      stickyRemoteChat: requester,
      config: { interimMessages: 'first' },
    });

    expect(result.target).toBeNull();
  });

  it('"first" keeps a late subagent report, which arrives on a turn with no tool calls', () => {
    const result = plan({
      content: [textBlock('ES -0.30%, NQ -1.25%.')],
      stickyRemoteChat: requester,
      config: { interimMessages: 'first' },
    });

    expect(result.text).toContain('ES -0.30%');
    expect(result.sticky).toBe(true);
  });

  it('"all" keeps sending tool-calling sticky turns, which is the old behaviour', () => {
    const result = plan({
      content: [textBlock('running the second query'), toolBlock('bash')],
      stickyRemoteChat: requester,
    });

    expect(result.text).toContain('running the second query');
  });
});
