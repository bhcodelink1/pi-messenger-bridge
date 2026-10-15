/**
 * async-util.ts — tiny promise helpers with no runtime dependencies.
 */
/**
 * Await `promise`, but stop waiting once `ms` has elapsed.
 *
 * The underlying work is not cancelled, it just stops gating the caller. Use it
 * where a caller must not be held hostage by a network round trip, for example
 * an extension event handler that Pi awaits before it continues.
 */
export declare function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined>;
//# sourceMappingURL=async-util.d.ts.map