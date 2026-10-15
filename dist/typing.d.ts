import type { PendingRemoteChat } from "./types.js";
/**
 * Typing indicator heartbeat.
 *
 * A single `sendTyping()` call is a one-shot signal. Telegram shows "typing..."
 * for about 5 seconds, WhatsApp for 3 seconds, Matrix for 10 seconds, and
 * Discord for about 10 seconds. A long tool run therefore goes silent a few
 * seconds after the turn starts, which makes the chat look dead.
 *
 * This class keeps the indicator alive for the whole run by re-sending it on a
 * timer, and it pings immediately whenever a tool starts (`tool_execution_start`)
 * so the indicator reappears at the beginning of every tool call.
 */
/** Refresh interval used when the config does not set `typingRefreshMs`. */
export declare const DEFAULT_TYPING_REFRESH_MS = 4000;
/** Shortest allowed refresh interval. */
export declare const MIN_TYPING_REFRESH_MS = 1000;
/** Longest allowed refresh interval. */
export declare const MAX_TYPING_REFRESH_MS = 20000;
/** Stop the heartbeat after this many consecutive send failures. */
export declare const MAX_TYPING_FAILURES = 3;
/** Subset of TransportManager used here, so the heartbeat stays testable. */
export interface TypingSender {
    sendTyping(chatId: string, transportType: string): Promise<void>;
}
/**
 * Normalize a configured refresh interval.
 *
 * Returns `DEFAULT_TYPING_REFRESH_MS` for undefined or non-finite input, `0` for
 * any value that is zero or negative (one-shot mode: ping on turn and tool
 * start, no timer), and clamps positive values into the allowed range.
 */
export declare function clampTypingRefreshMs(value: number | undefined): number;
/**
 * Keeps a typing indicator visible while pi works on a remote request.
 */
export declare class TypingHeartbeat {
    private sender;
    private getRefreshMs;
    private timer;
    private target;
    private consecutiveFailures;
    private sent;
    constructor(sender: TypingSender, getRefreshMs: () => number | undefined);
    /** Is a refresh timer currently armed? */
    get active(): boolean;
    /** Number of typing indicators sent since the last `stop()`. */
    get sentCount(): number;
    /**
     * Start a heartbeat for a chat. Sends one indicator right away and arms the
     * refresh timer unless one-shot mode is configured.
     */
    start(target: PendingRemoteChat): void;
    /**
     * Ping now and reschedule the timer. Starts a heartbeat when none is running
     * or the chat changed. Call this from `tool_execution_start`.
     */
    touch(target: PendingRemoteChat): void;
    /** Stop the timer. Idempotent, so call it from every terminal event. */
    stop(): void;
    private armTimer;
    private clearTimer;
    private ping;
}
//# sourceMappingURL=typing.d.ts.map