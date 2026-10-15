import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TYPING_REFRESH_MS,
  MAX_TYPING_REFRESH_MS,
  MIN_TYPING_REFRESH_MS,
  TypingHeartbeat,
  clampTypingRefreshMs,
} from '../src/typing';
import type { PendingRemoteChat } from '../src/types';

const target: PendingRemoteChat = {
  chatId: '123456',
  transport: 'telegram',
  username: 'tester',
  messageId: '1',
};

const otherTarget: PendingRemoteChat = { ...target, chatId: '999', transport: 'matrix' };

function createSender(shouldFail = false) {
  return {
    calls: [] as Array<{ chatId: string; transport: string }>,
    async sendTyping(chatId: string, transport: string): Promise<void> {
      if (shouldFail) throw new Error('transport not connected');
      this.calls.push({ chatId, transport });
    },
  };
}

describe('clampTypingRefreshMs', () => {
  it('falls back to the default for undefined and non-finite values', () => {
    expect(clampTypingRefreshMs(undefined)).toBe(DEFAULT_TYPING_REFRESH_MS);
    expect(clampTypingRefreshMs(Number.NaN)).toBe(DEFAULT_TYPING_REFRESH_MS);
    expect(clampTypingRefreshMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TYPING_REFRESH_MS);
  });

  it('treats zero and negative values as one-shot mode', () => {
    expect(clampTypingRefreshMs(0)).toBe(0);
    expect(clampTypingRefreshMs(-1000)).toBe(0);
  });

  it('clamps positive values into the allowed range', () => {
    expect(clampTypingRefreshMs(1)).toBe(MIN_TYPING_REFRESH_MS);
    expect(clampTypingRefreshMs(500)).toBe(MIN_TYPING_REFRESH_MS);
    expect(clampTypingRefreshMs(60_000)).toBe(MAX_TYPING_REFRESH_MS);
    expect(clampTypingRefreshMs(7500)).toBe(7500);
  });

  it('rounds fractional milliseconds', () => {
    expect(clampTypingRefreshMs(4500.4)).toBe(4500);
    expect(clampTypingRefreshMs(4500.6)).toBe(4501);
  });
});

describe('TypingHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one indicator immediately and keeps refreshing on the interval', async () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(8000);
    expect(sender.calls).toHaveLength(4);

    beat.stop();
    expect(beat.active).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sender.calls).toHaveLength(4);
  });

  it('stays in one-shot mode when the refresh interval is zero', async () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 0);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.calls).toHaveLength(1);
    expect(beat.active).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sender.calls).toHaveLength(1);
  });

  it('touch pings again and reschedules without arming a second timer', async () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(0);

    // A tool starts 2 seconds in: immediate ping, and the next refresh lands
    // 4 seconds after that ping rather than 2 seconds after it.
    beat.touch(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sender.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sender.calls).toHaveLength(3);

    beat.stop();
  });

  it('touch starts a heartbeat when none is running', async () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.touch(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toEqual({ chatId: '123456', transport: 'telegram' });
    expect(beat.active).toBe(true);

    beat.stop();
  });

  it('restarts when the target chat or transport changes', async () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(0);
    beat.touch(otherTarget);
    await vi.advanceTimersByTimeAsync(0);

    expect(sender.calls.map((c) => c.chatId)).toEqual(['123456', '999']);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls[2]).toEqual({ chatId: '999', transport: 'matrix' });

    beat.stop();
  });

  it('stops when the setting is turned off mid-run', async () => {
    const sender = createSender();
    let enabled = true;
    const beat = new TypingHeartbeat(sender, () => (enabled ? 4000 : 0));

    beat.start(target);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls).toHaveLength(2);

    enabled = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls).toHaveLength(2);
    expect(beat.active).toBe(false);
  });

  it('re-arms with a new interval when the setting changes mid-run', async () => {
    const sender = createSender();
    let intervalMs = 4000;
    const beat = new TypingHeartbeat(sender, () => intervalMs);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(0);

    intervalMs = 10_000;
    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(6000);
    expect(sender.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sender.calls).toHaveLength(3);

    beat.stop();
  });

  it('gives up after three consecutive send failures', async () => {
    const sender = createSender(true);
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.start(target);
    await vi.advanceTimersByTimeAsync(4000);
    expect(beat.active).toBe(true);

    await vi.advanceTimersByTimeAsync(4000);
    expect(beat.active).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(beat.sentCount).toBe(0);
  });

  it('resets the failure counter after a successful send', async () => {
    let failNext = true;
    const sender = {
      calls: [] as string[],
      async sendTyping(): Promise<void> {
        if (failNext) {
          failNext = false;
          throw new Error('transient');
        }
        failNext = true;
        this.calls.push('ok');
      },
    };
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.start(target);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(4000);
    }

    expect(beat.active).toBe(true);
    beat.stop();
  });

  it('stop is idempotent', () => {
    const sender = createSender();
    const beat = new TypingHeartbeat(sender, () => 4000);

    beat.stop();
    beat.stop();
    beat.start(target);
    beat.stop();
    beat.stop();
    expect(beat.active).toBe(false);
  });
});
