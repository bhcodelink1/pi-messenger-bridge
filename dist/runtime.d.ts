/**
 * runtime.ts — process-wide bridge state.
 *
 * Pi builds a fresh ExtensionRunner, and so calls the extension factory again,
 * on every session replacement: /new, /clear, /resume, fork and /reload.
 * Messenger connections cannot follow that lifecycle. The lock in lock.ts
 * already limits the bridge to one live connection per machine, so rebuilding
 * transports per session meant tearing Telegram down and dialing it back up on
 * every session change. Two things went wrong there: Pi awaits
 * `session_shutdown` handlers before it creates the next session, and Telegram
 * answers the new getUpdates long-poll with
 * `409 terminated by other getUpdates request` while the previous socket is
 * still registered server-side.
 *
 * Transports, auth state and the sticky reply target therefore live on
 * globalThis and survive session replacement. Per-session state, meaning the ui
 * context and the `pi.sendUserMessage` of the session that is currently alive,
 * is rebound on `session_start` and cleared on `session_shutdown`.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ChallengeAuth } from "./auth/challenge-auth.js";
import { TransportManager } from "./transports/manager.js";
import type { ExternalMessage, PendingRemoteChat } from "./types.js";
export interface BridgeRuntime {
    transportManager: TransportManager;
    auth: ChallengeAuth;
    /** Notify/widget target of the session that currently owns the bridge. */
    ctx: ExtensionContext | null;
    /**
     * Forwards inbound messenger messages into the live pi session, or null while
     * no session owns the bridge. Rebound on every `session_start` so a message
     * that arrives after a /new reaches the new session instead of the dead one.
     */
    inboundSink: ((message: ExternalMessage) => void) | null;
    /** Last chat a message arrived from. Survives session replacement. */
    stickyRemoteChat: PendingRemoteChat | null;
    /** Transports are built once per process, not once per session. */
    transportsBuilt: boolean;
}
declare global {
    var __msgBridgeRuntime: BridgeRuntime | undefined;
}
/**
 * Persist trusted users, admin and channel rules into msg-bridge.json.
 */
export declare function saveAuthState(auth: ChallengeAuth): void;
/**
 * Return the bridge state for this process, creating it on first call.
 */
export declare function getRuntime(): BridgeRuntime;
/**
 * Forget the process-wide state. Tests call this between cases to simulate a
 * fresh process. Production code never does.
 */
export declare function resetRuntime(): void;
//# sourceMappingURL=runtime.d.ts.map