/**
 * Full-screen loading screen: logo, progress bar and what is loading.
 * Used while signing in, while the first data loads, and while the page is being prepared.
 */
export function BootScreen({
  progress,
  label = "Loading…",
  leaving = false,
  error,
  onRetry,
}: {
  /** 0 to 1. Leave out for an endless sliding bar. */
  progress?: number | undefined;
  label?: string | undefined;
  leaving?: boolean | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-[100] grid place-items-center bg-ink px-6 transition-opacity duration-300 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <img src="/logo.png" alt="" className="boot-pulse size-24 rounded-3xl shadow-lg" draggable={false} />
        <div className="mt-5 font-display text-lg font-semibold tracking-tight text-fg">Vantera TMS</div>
        {error ? (
          <>
            <p className="mt-4 text-sm text-problem">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="mt-4 h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-ink">
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <div className="mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-panel2">
              {progress === undefined ? (
                <div className="boot-slide h-full w-1/3 rounded-full bg-accent" />
              ) : (
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(6, Math.min(100, Math.round(progress * 100)))}%` }} />
              )}
            </div>
            <p className="mt-3 h-5 text-xs text-mut">{label}</p>
          </>
        )}
      </div>
    </div>
  );
}
