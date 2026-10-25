/**
 * Shift scheduling logic (pure functions, no database access).
 *
 * All shift times are "wall-clock" times in the COMPANY timezone. To compare them we convert
 * "now" into the company's wall-clock and work in minutes ("stamps") on a pseudo-UTC axis.
 * A shift whose end time is the same as or earlier than its start time runs past midnight.
 * A shift belongs to the date it STARTS on (Saturday 8 PM - Sunday 8 AM is a Saturday shift).
 */

export type Shift = { id: string; name: string; sort_order: number; is_active: boolean };
export type ShiftTime = { shift_id: string; dow: number; start_time: string; end_time: string; is_off: boolean };
export type ShiftOverride = {
  id: string;
  shift_id: string;
  on_date: string;
  start_time: string | null;
  end_time: string | null;
  is_off: boolean;
  note: string | null;
};
export type ShiftMember = { user_id: string; shift_id: string };
export type ShiftCover = { id: string; shift_id: string; user_id: string; on_date: string; note: string | null };

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Monday first, the way the schedule grid is shown. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:30:00" or "08:30" -> minutes since midnight. */
export function toMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** "08:30:00" -> "08:30" (what <input type="time"> expects). */
export const hhmm = (t: string) => t.slice(0, 5);

/** "16:00" -> "4:00 PM" */
export function fmt12(t: string): string {
  const m = toMin(t);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mm)} ${h >= 12 ? "PM" : "AM"}`;
}

export function fmtRange(start: string, end: string): string {
  return `${fmt12(start)} – ${fmt12(end)}`;
}

export function fmtDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

export function validTz(tz?: string | null): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export type Clock = { date: string; dow: number; stamp: number };

export const dayStamp = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 60000;
};

export const dowOf = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export function addDays(date: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Current wall-clock date/time in the given timezone. */
export function clockIn(tz: string, now: Date = new Date()): Clock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = get("hour") % 24;
  const mi = get("minute");
  return { date: `${y}-${pad(mo)}-${pad(d)}`, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), stamp: Date.UTC(y, mo - 1, d, h, mi) / 60000 };
}

export type Occurrence = {
  shiftId: string;
  /** The date the shift STARTS on. */
  date: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  startStamp: number;
  endStamp: number;
  overridden: boolean;
  note: string | null;
};

/** The shift as it actually runs on `date` (a one-off change wins over the weekly pattern). Null = no shift that day. */
export function occurrenceOn(
  shiftId: string,
  date: string,
  times: ShiftTime[],
  overrides: ShiftOverride[],
): Occurrence | null {
  const base = times.find((t) => t.shift_id === shiftId && t.dow === dowOf(date));
  const ov = overrides.find((o) => o.shift_id === shiftId && o.on_date === date);
  let start: string | null;
  let end: string | null;
  let off: boolean;
  let note: string | null = null;
  if (ov) {
    off = ov.is_off;
    start = ov.start_time ?? base?.start_time ?? null;
    end = ov.end_time ?? base?.end_time ?? null;
    note = ov.note;
  } else {
    if (!base) return null;
    off = base.is_off;
    start = base.start_time;
    end = base.end_time;
  }
  if (off || !start || !end) return null;
  const s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 1440;
  const day = dayStamp(date);
  return { shiftId, date, start: hhmm(start), end: hhmm(end), startStamp: day + s, endStamp: day + e, overridden: !!ov, note };
}

/** Shifts running right now (normally one; more than one if the supervisor makes them overlap). */
export function currentOccurrences(shifts: Shift[], times: ShiftTime[], overrides: ShiftOverride[], clock: Clock): Occurrence[] {
  const out: Occurrence[] = [];
  for (const s of shifts) {
    if (!s.is_active) continue;
    for (const date of [addDays(clock.date, -1), clock.date]) {
      const o = occurrenceOn(s.id, date, times, overrides);
      if (o && o.startStamp <= clock.stamp && clock.stamp < o.endStamp) out.push(o);
    }
  }
  return out.sort((a, b) => b.startStamp - a.startStamp);
}

/** The next shift that has not started yet. */
export function nextOccurrence(shifts: Shift[], times: ShiftTime[], overrides: ShiftOverride[], clock: Clock, days = 8): Occurrence | null {
  let best: Occurrence | null = null;
  for (const s of shifts) {
    if (!s.is_active) continue;
    for (let i = 0; i <= days; i++) {
      const o = occurrenceOn(s.id, addDays(clock.date, i), times, overrides);
      if (o && o.startStamp > clock.stamp && (!best || o.startStamp < best.startStamp)) best = o;
    }
  }
  return best;
}

/** People on duty for a shift on a given date: folder members (unless covering elsewhere) plus people covering this shift. */
export function onDutyUserIds(shiftId: string, date: string, members: ShiftMember[], covers: ShiftCover[]): string[] {
  const own = members
    .filter((m) => m.shift_id === shiftId)
    .map((m) => m.user_id)
    .filter((uid) => !covers.some((c) => c.user_id === uid && c.on_date === date && c.shift_id !== shiftId));
  const cov = covers.filter((c) => c.shift_id === shiftId && c.on_date === date).map((c) => c.user_id);
  return Array.from(new Set([...own, ...cov]));
}

/** "end time + delta" for the Extend-shift button. */
export function addMinutesToTime(t: string, delta: number): string {
  const m = (((toMin(t) + delta) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -((dowOf(date) + 6) % 7));
}
