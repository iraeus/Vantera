/** How long after a status change the next check call / update is due (hours). Editable in Settings. */
export const DEFAULT_UPDATE_HOURS: Record<string, number> = {
  assigned: 8,
  dispatched: 6,
  at_pickup: 1,
  loading: 1,
  picked_up: 3,
  in_transit: 4,
  at_delivery: 1,
  unloading: 1,
};

export const INTERVAL_STATUSES = Object.keys(DEFAULT_UPDATE_HOURS);

/** Settings are stored as JSON text; anything missing or invalid falls back to the defaults. */
export function parseIntervals(json: string | null | undefined): Record<string, number> {
  const out = { ...DEFAULT_UPDATE_HOURS };
  if (!json) return out;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (k in out && Number.isFinite(n) && n > 0 && n <= 72) out[k] = n;
    }
  } catch {
    /* keep defaults */
  }
  return out;
}

/** ISO time the next update is due, or null when this status needs no more updates. */
export function nextUpdateAt(status: string, hours: Record<string, number>, now: Date = new Date()): string | null {
  const h = hours[status];
  if (!h) return null;
  return new Date(now.getTime() + h * 3600_000).toISOString();
}

/** Minutes the update is late compared with the time it was due (0 = on time). Null when nothing was due. */
export function minutesLate(due: string | null | undefined, now: Date = new Date()): number | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

/** An update more than this many minutes after it was due counts as late. */
export const LATE_GRACE_MIN = 15;
