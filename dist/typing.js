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
export const DEFAULT_TYPING_REFRESH_MS = 4000;
/** Shortest allowed refresh interval. */
export const MIN_TYPING_REFRESH_MS = 1000;
/** Longest allowed refresh interval. */
export const MAX_TYPING_REFRESH_MS = 20000;
/** Stop the heartbeat after this many consecutive send failures. */
export const MAX_TYPING_FAILURES = 3;
/**
 * Normalize a configured refresh interval.
 *
 * Returns `DEFAULT_TYPING_REFRESH_MS` for undefined or non-finite input, `0` for
 * any value that is zero or negative (one-shot mode: ping on turn and tool
 * start, no timer), and clamps positive values into the allowed range.
 */
export function clampTypingRefreshMs(value) {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_TYPING_REFRESH_MS;
    }
    const ms = Math.round(value);
    if (ms <= 0) {
        return 0;
    }
    return Math.min(Math.max(ms, MIN_TYPING_REFRESH_MS), MAX_TYPING_REFRESH_MS);
}
/**
 * Keeps a typing indicator visible while pi works on a remote request.
 */
export class TypingHeartbeat {
    sender;
    getRefreshMs;
    timer = null;
    target = null;
    consecutiveFailures = 0;
    sent = 0;
    constructor(sender, getRefreshMs) {
        this.sender = sender;
        this.getRefreshMs = getRefreshMs;
    }
    /** Is a refresh timer currently armed? */
    get active() {
        return this.timer !== null;
    }
    /** Number of typing indicators sent since the last `stop()`. */
    get sentCount() {
        return this.sent;
    }
    /**
     * Start a heartbeat for a chat. Sends one indicator right away and arms the
     * refresh timer unless one-shot mode is configured.
     */
    start(target) {
        this.clearTimer();
        this.target = target;
        this.consecutiveFailures = 0;
        this.ping(target);
        this.armTimer(target);
    }
    /**
     * Ping now and reschedule the timer. Starts a heartbeat when none is running
     * or the chat changed. Call this from `tool_execution_start`.
     */
    touch(target) {
        const sameTarget = this.target !== null &&
            this.target.chatId === target.chatId &&
            this.target.transport === target.transport;
        if (!this.active || !sameTarget) {
            this.start(target);
            return;
        }
        this.ping(target);
        this.armTimer(target);
    }
    /** Stop the timer. Idempotent, so call it from every terminal event. */
    stop() {
        this.clearTimer();
        this.target = null;
        this.consecutiveFailures = 0;
    }
    armTimer(target) {
        // Always drop the previous timer first, otherwise `touch()` would stack a
        // second interval and double the send rate.
        this.clearTimer();
        const ms = clampTypingRefreshMs(this.getRefreshMs());
        if (ms <= 0) {
            return;
        }
        this.timer = setInterval(() => {
            // Re-read the setting every tick so `/msg-bridge typing` changes apply
            // mid-run instead of at the next turn.
            const nextMs = clampTypingRefreshMs(this.getRefreshMs());
            if (nextMs <= 0) {
                this.stop();
                return;
            }
            this.ping(target);
            if (nextMs !== ms) {
                this.clearTimer();
                this.armTimer(target);
            }
        }, ms);
        // Never keep the process alive for an indicator.
        const timer = this.timer;
        if (typeof timer.unref === "function") {
            timer.unref();
        }
    }
    clearTimer() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async ping(target) {
        try {
            await this.sender.sendTyping(target.chatId, target.transport);
            this.consecutiveFailures = 0;
            this.sent++;
        }
        catch (_err) {
            // A dead transport must not break the agent loop. Give up after a few
            // failures so a disconnected transport is not hammered every interval.
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= MAX_TYPING_FAILURES) {
                this.stop();
            }
        }
    }
}
//# sourceMappingURL=typing.js.map