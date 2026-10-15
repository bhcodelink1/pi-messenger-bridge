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
import { ChallengeAuth } from "./auth/challenge-auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { TransportManager } from "./transports/manager.js";
/**
 * Persist trusted users, admin and channel rules into msg-bridge.json.
 */
export function saveAuthState(auth) {
    const config = loadConfig();
    config.auth = auth.exportConfig();
    saveConfig(config);
}
/**
 * Return the bridge state for this process, creating it on first call.
 */
export function getRuntime() {
    const existing = globalThis.__msgBridgeRuntime;
    if (existing)
        return existing;
    const runtime = {
        transportManager: new TransportManager(),
        auth: null,
        ctx: null,
        inboundSink: null,
        stickyRemoteChat: null,
        transportsBuilt: false,
    };
    // The auth callbacks outlive the session that created them, so they resolve
    // the ui context through `runtime` on every call rather than capturing it.
    const auth = new ChallengeAuth((code, username) => {
        runtime.ctx?.ui.notify(`🔐 Challenge code for @${username}: ${code}`, "info");
    }, (message, level) => {
        runtime.ctx?.ui.notify(message, level);
    }, async (_chatId, _message) => {
        // Challenge notifications are sent via the transport's sendMessage
    }, () => saveAuthState(auth));
    runtime.auth = auth;
    globalThis.__msgBridgeRuntime = runtime;
    return runtime;
}
/**
 * Forget the process-wide state. Tests call this between cases to simulate a
 * fresh process. Production code never does.
 */
export function resetRuntime() {
    globalThis.__msgBridgeRuntime = undefined;
}
//# sourceMappingURL=runtime.js.map