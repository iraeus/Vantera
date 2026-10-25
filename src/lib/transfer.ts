/** Transferring board logic (pure functions). */
export type Tone = "neutral" | "info" | "warn" | "good" | "bad";

export type TStep = { id: string; key: string | null; label: string; sort_order: number; is_active: boolean };
export type TOption = {
  id: string;
  step_id: string;
  label: string;
  tone: Tone;
  is_done: boolean;
  is_default: boolean;
  asks_details: boolean;
  sort_order: number;
};
export type TRow = {
  id: string;
  driver_id: string | null;
  driver_name: string;
  truck_label: string | null;
  driver_phone?: string | null;
  driver_email?: string | null;
  notes: string | null;
  due_date: string | null;
  is_archived: boolean;
  created_at: string;
  sticker_shop_id: string | null;
  sticker_shop_name: string | null;
  sticker_email: string | null;
  sticker_location: string | null;
  sticker_phone: string | null;
  sticker_ordered_on: string | null;
  sticker_note: string | null;
  sticker_ordered_by: string | null;
};
export type TProgress = { row_id: string; step_id: string; option_id: string; updated_by: string | null; updated_at: string };
export type TShop = { id: string; name: string; email: string | null; location: string | null; phone: string | null };

export const TONES: { value: Tone; text: string }[] = [
  { value: "neutral", text: "Gray" },
  { value: "info", text: "Blue" },
  { value: "warn", text: "Yellow" },
  { value: "good", text: "Green" },
  { value: "bad", text: "Red" },
];

export const activeSteps = (steps: TStep[]) => steps.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);
export const optionsOf = (options: TOption[], stepId: string) => options.filter((o) => o.step_id === stepId).sort((a, b) => a.sort_order - b.sort_order);

export function defaultOption(options: TOption[], stepId: string): TOption | undefined {
  const list = optionsOf(options, stepId);
  return list.find((o) => o.is_default) ?? list[0];
}

/** "rowId:stepId" -> optionId */
export function progressIndex(progress: TProgress[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of progress) m.set(`${p.row_id}:${p.step_id}`, p.option_id);
  return m;
}

/** The choice for a driver and step. If nobody chose yet it is the step's default choice. */
export function chosen(rowId: string, stepId: string, options: TOption[], idx: Map<string, string>): TOption | undefined {
  const id = idx.get(`${rowId}:${stepId}`);
  return (id ? options.find((o) => o.id === id && o.step_id === stepId) : undefined) ?? defaultOption(options, stepId);
}

/** Finished = every active step has a choice that counts as done. */
export function isFinished(rowId: string, steps: TStep[], options: TOption[], idx: Map<string, string>): boolean {
  const act = activeSteps(steps);
  if (act.length === 0) return false;
  return act.every((s) => chosen(rowId, s.id, options, idx)?.is_done === true);
}

export function isOverdue(row: TRow, finished: boolean, today: string): boolean {
  return !finished && !!row.due_date && row.due_date < today;
}

export type StepSummary = { step: TStep; total: number; done: number; byOption: { option: TOption; count: number }[] };
export type Summary = { total: number; finished: number; open: number; overdue: number; steps: StepSummary[] };

export function summarize(rows: TRow[], steps: TStep[], options: TOption[], idx: Map<string, string>, today: string): Summary {
  const act = activeSteps(steps);
  let finished = 0;
  let overdue = 0;
  for (const r of rows) {
    const f = isFinished(r.id, steps, options, idx);
    if (f) finished++;
    if (isOverdue(r, f, today)) overdue++;
  }
  return {
    total: rows.length,
    finished,
    open: rows.length - finished,
    overdue,
    steps: act.map((step) => {
      const list = optionsOf(options, step.id);
      const byOption = list.map((option) => ({ option, count: rows.filter((r) => chosen(r.id, step.id, options, idx)?.id === option.id).length }));
      return { step, total: rows.length, done: byOption.filter((b) => b.option.is_done).reduce((s, b) => s + b.count, 0), byOption };
    }),
  };
}

export type Filters = { q: string; status: "all" | "finished" | "open" | "overdue"; steps: Record<string, string> };

export function applyFilters(rows: TRow[], f: Filters, steps: TStep[], options: TOption[], idx: Map<string, string>, today: string): TRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.driver_name} ${r.truck_label ?? ""} ${r.notes ?? ""} ${r.sticker_shop_name ?? ""}`.toLowerCase().includes(q)) return false;
    const fin = isFinished(r.id, steps, options, idx);
    if (f.status === "finished" && !fin) return false;
    if (f.status === "open" && fin) return false;
    if (f.status === "overdue" && !isOverdue(r, fin, today)) return false;
    for (const [stepId, optId] of Object.entries(f.steps)) {
      if (optId && chosen(r.id, stepId, options, idx)?.id !== optId) return false;
    }
    return true;
  });
}

/* ---------- adding drivers by name ---------- */
export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** One name per line (commas and semicolons also work). Empty lines and repeated names are dropped. */
export function parseNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n;,]+/)) {
    const name = raw.trim().replace(/\s+/g, " ").replace(/^[-*•\d.)\s]+(?=[A-Za-z\u0400-\u04FF])/, "");
    const key = normName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Splits names into the ones that can be added and the ones already on the board. */
export function splitNew(names: string[], existing: { driver_name: string }[]): { fresh: string[]; already: string[] } {
  const have = new Set(existing.map((r) => normName(r.driver_name)));
  const fresh: string[] = [];
  const already: string[] = [];
  for (const n of names) (have.has(normName(n)) ? already : fresh).push(n);
  return { fresh, already };
}

/* ---------- message templates ---------- */
export const PLACEHOLDERS: { key: string; text: string }[] = [
  { key: "driver_name", text: "Driver name" },
  { key: "truck", text: "Truck" },
  { key: "shop_name", text: "Print shop name" },
  { key: "shop_email", text: "Print shop email" },
  { key: "shop_phone", text: "Print shop phone" },
  { key: "shop_address", text: "Print shop location" },
  { key: "order_date", text: "Sticker order date" },
  { key: "due_date", text: "Due date" },
];

export function templateVars(row: TRow): Record<string, string> {
  return {
    driver_name: row.driver_name,
    truck: row.truck_label ?? "",
    shop_name: row.sticker_shop_name ?? "",
    shop_email: row.sticker_email ?? "",
    shop_phone: row.sticker_phone ?? "",
    shop_address: row.sticker_location ?? "",
    order_date: row.sticker_ordered_on ?? "",
    due_date: row.due_date ?? "",
  };
}

/** Replaces {name} with the value. Missing values stay as {name} so you can see what is still empty. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{([a-z_]+)\}/g, (m, k: string) => (vars[k] ? (vars[k] as string) : m));
}

export function missingPlaceholders(body: string, vars: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{([a-z_]+)\}/g)) if (!vars[m[1] as string]) out.add(m[1] as string);
  return [...out];
}

/* ---------- links ---------- */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const smsUrl = (phone: string, body: string) => `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
export const mailtoUrl = (to: string, subject: string, body: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const mapsUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

/** Cleans a file name for storage paths. */
export const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(-120) || "file";

export const formatBytes = (n: number | null | undefined) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
