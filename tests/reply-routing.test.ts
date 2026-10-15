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
}) {
  return planTurnReply({
    message: message(options.content ?? []),
    pendingRemoteChat: options.pendingRemoteChat ?? null,
    stickyRemoteChat: options.stickyRemoteChat ?? null,
    config: options.config ?? {},
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
