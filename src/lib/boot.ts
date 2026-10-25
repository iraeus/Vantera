/** Decides what the loading screen shows (pure, so it can be tested). */
export type BootCheck = { label: string; status: string };

export type BootState = { done: number; total: number; progress: number; label: string; ready: boolean; accountError: boolean };

/**
 * checks[0] must be the account check.
 * - A failed check does not block the app (that page shows its own message), except the account.
 * - After `timedOut` the app is shown even if something is still loading, unless the account failed.
 * - `minDone` stops the screen from flashing for a split second.
 */
export function bootState(checks: BootCheck[], minDone: boolean, timedOut: boolean): BootState {
  const total = checks.length;
  const done = checks.filter((c) => c.status !== "pending").length;
  const accountError = checks[0]?.status === "error";
  const allDone = done === total;
  return {
    done,
    total,
    progress: total === 0 || allDone ? 1 : done / total,
    label: checks.find((c) => c.status === "pending")?.label ?? "Almost ready…",
    ready: minDone && !accountError && (allDone || timedOut),
    accountError,
  };
}
