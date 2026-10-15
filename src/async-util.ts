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
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    // Never keep the process alive just for this timer.
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
