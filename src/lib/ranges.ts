/** Date-range presets for reports. All dates are "YYYY-MM-DD". */
export type Preset = "7d" | "30d" | "mtd" | "lastmonth" | "qtd" | "ytd" | "custom";

export const PRESETS: { value: Preset; text: string }[] = [
  { value: "7d", text: "Last 7 days" },
  { value: "30d", text: "Last 30 days" },
  { value: "mtd", text: "This month" },
  { value: "lastmonth", text: "Last month" },
  { value: "qtd", text: "This quarter" },
  { value: "ytd", text: "Year to date" },
  { value: "custom", text: "Custom dates" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function rangeFor(preset: Preset, today: string): { from: string; to: string } {
  const [y = 1970, m = 1, d = 1] = today.split("-").map(Number);
  const t = utc(y, m - 1, d);
  switch (preset) {
    case "7d":
      return { from: fmt(utc(y, m - 1, d - 6)), to: today };
    case "30d":
      return { from: fmt(utc(y, m - 1, d - 29)), to: today };
    case "mtd":
      return { from: fmt(utc(y, m - 1, 1)), to: today };
    case "lastmonth":
      return { from: fmt(utc(y, m - 2, 1)), to: fmt(utc(y, m - 1, 0)) };
    case "qtd":
      return { from: fmt(utc(y, Math.floor((m - 1) / 3) * 3, 1)), to: today };
    case "ytd":
      return { from: fmt(utc(y, 0, 1)), to: today };
    default:
      return { from: fmt(t), to: today };
  }
}

/** Monday to Sunday of last week, for the weekly summary. */
export function lastFullWeek(today: string): { from: string; to: string } {
  const [y = 1970, m = 1, d = 1] = today.split("-").map(Number);
  const dow = utc(y, m - 1, d).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return { from: fmt(utc(y, m - 1, d - sinceMonday - 7)), to: fmt(utc(y, m - 1, d - sinceMonday - 1)) };
}
