/**
 * Server-only: finds new alerts, sends them to Telegram / email, and remembers what was sent.
 * Runs when the scheduler calls /api/public/alerts-run (every 15 minutes) or when an admin presses "Send a test alert".
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { collectExpiries } from "./alerts";
import { buildPlanRows } from "./maintenance";
import { billingBuckets } from "./billing";
import { buildAttention, type AttentionCat, type AttentionItem } from "./attention";
import { buildWeekly, weeklyText } from "./weekly";
import { lastFullWeek } from "./ranges";
import { clockIn, validTz, browserTz } from "./shifts";
import type { ALoad } from "./analytics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;

export function channelStatus() {
  const env = process.env;
  return {
    telegram: !!(env["TELEGRAM_BOT_TOKEN"] && env["TELEGRAM_CHAT_ID"]),
    email: !!(env["RESEND_API_KEY"] && env["ALERT_EMAIL_FROM"] && env["ALERT_EMAIL_TO"]),
    schedule: !!env["ALERTS_SECRET"],
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { ok: res.ok, text: res.ok ? "" : `${res.status} ${(await res.text()).slice(0, 200)}` };
}

/** Sends the same text to every configured channel. Returns which channels worked. */
export async function sendMessage(subject: string, text: string): Promise<{ sent: string[]; errors: string[] }> {
  const sent: string[] = [];
  const errors: string[] = [];
  const env = process.env;
  const st = channelStatus();

  if (st.telegram) {
    // Telegram messages are limited to 4096 characters, so long digests are split.
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > 3500) {
      const cut = rest.lastIndexOf("\n", 3500);
      const at = cut > 500 ? cut : 3500;
      chunks.push(rest.slice(0, at));
      rest = rest.slice(at).replace(/^\n/, "");
    }
    chunks.push(rest);
    let ok = true;
    for (const c of chunks) {
      const r = await postJson(`https://api.telegram.org/bot${env["TELEGRAM_BOT_TOKEN"]}/sendMessage`, {
        chat_id: env["TELEGRAM_CHAT_ID"],
        text: c,
        disable_web_page_preview: true,
      });
      if (!r.ok) {
        ok = false;
        errors.push(`Telegram: ${r.text}`);
        break;
      }
    }
    if (ok) sent.push("Telegram");
  }

  if (st.email) {
    const to = String(env["ALERT_EMAIL_TO"]).split(",").map((s) => s.trim()).filter(Boolean);
    const r = await postJson(
      "https://api.resend.com/emails",
      { from: env["ALERT_EMAIL_FROM"], to, subject, text },
      { Authorization: `Bearer ${env["RESEND_API_KEY"]}` },
    );
    if (r.ok) sent.push("Email");
    else errors.push(`Email: ${r.text}`);
  }
  return { sent, errors };
}

async function fetchAll<T>(table: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = admin.from(table).select("*");
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

const CAT_TITLE: Record<AttentionCat, string> = { loads: "Loads", safety: "Safety", fleet: "Fleet", billing: "Billing" };

function digestText(items: AttentionItem[]): string {
  const base = process.env["APP_URL"];
  const lines: string[] = [`Vantera TMS: ${items.length} new alert${items.length === 1 ? "" : "s"}`];
  for (const cat of ["loads", "safety", "fleet", "billing"] as AttentionCat[]) {
    const mine = items.filter((i) => i.cat === cat);
    if (!mine.length) continue;
    lines.push("", CAT_TITLE[cat]);
    for (const i of mine.slice(0, 15)) lines.push(`- ${i.tag}: ${i.text}`);
    if (mine.length > 15) lines.push(`  ...and ${mine.length - 15} more`);
  }
  if (base) lines.push("", base);
  return lines.join("\n");
}

/** Finds attention items, drops the ones already sent recently, and sends the rest as one digest. */
export async function runAlerts(now: Date = new Date()) {
  const [loads, trucks, trailers, drivers, docs, plans, records, fuel, brokers, tasks, people] = await Promise.all([
    fetchAll<ALoad & { next_update_at: string | null; problem_note: string | null; deleted_at: string | null }>("loads"),
    fetchAll<{ id: string; truck_number: string; status: string; notes: string | null; mileage: number | null; insurance_expiration: string | null; registration_expiration: string | null; inspection_due: string | null }>("trucks"),
    fetchAll<{ id: string; trailer_number: string; status: string; mileage: number | null; insurance_expiration: string | null; registration_expiration: string | null }>("trailers"),
    fetchAll<{ id: string; full_name: string; status: string; cdl_expiration: string | null; medical_card_expiration: string | null }>("drivers"),
    fetchAll<{ id: string; entity_type: string; entity_id: string; doc_type: string; file_name: string; expires_on: string | null }>("entity_documents"),
    fetchAll<import("./maintenance").MaintenancePlan>("maintenance_plans"),
    fetchAll<{ asset_type: string; asset_id: string; odometer: number | null }>("maintenance_records"),
    fetchAll<{ truck_id: string; odometer: number | null }>("fuel_records"),
    fetchAll<{ id: string; name: string; payment_terms_days: number | null }>("brokers"),
    // The tasks table only exists after the fourth SQL file; skip quietly until then.
    fetchAll<import("./tasks").Task>("dispatch_tasks", (q) => q.neq("status", "done")).catch(() => [] as import("./tasks").Task[]),
    fetchAll<{ id: string; full_name: string | null }>("profiles").catch(() => [] as { id: string; full_name: string | null }[]),
  ]);

  const live = loads.filter((l) => !l.deleted_at);
  const expiries = collectExpiries({ drivers, trucks, trailers, docs }, now);
  const planRows = buildPlanRows({ plans, trucks, trailers, records, fuel }, now);
  const items = buildAttention(
    {
      loads: live,
      trucks,
      plans: planRows,
      expiries,
      billing: billingBuckets(live, brokers, now),
      tasks: tasks.map((t) => ({ ...t, assignee: people.find((p) => p.id === t.assigned_to)?.full_name ?? undefined })),
    },
    now,
  );

  // Skip alerts that were already sent within their cool-down window.
  const keys = items.map((i) => i.key);
  const recent = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await admin.from("alerts_sent").select("key,sent_at").in("key", keys.slice(i, i + 200));
    for (const r of (data ?? []) as { key: string; sent_at: string }[]) recent.set(r.key, new Date(r.sent_at).getTime());
  }
  const fresh = items.filter((i) => {
    const at = recent.get(i.key);
    return !at || now.getTime() - at > i.windowHours * 3600_000;
  });

  if (fresh.length === 0) return { found: items.length, sent: 0, channels: [] as string[], errors: [] as string[] };
  const result = await sendMessage(`Vantera TMS: ${fresh.length} new alerts`, digestText(fresh));
  if (result.sent.length > 0) {
    const rows = fresh.map((i) => ({ key: i.key, sent_at: now.toISOString() }));
    for (let i = 0; i < rows.length; i += 200) await admin.from("alerts_sent").upsert(rows.slice(i, i + 200), { onConflict: "key" });
  }
  return { found: items.length, sent: result.sent.length > 0 ? fresh.length : 0, channels: result.sent, errors: result.errors };
}

/** Weekly management summary for last Monday-Sunday (company timezone). Sent once per week. */
export async function runWeekly(now: Date = new Date()) {
  const { data: tzRow } = await admin.from("app_settings").select("value").eq("key", "company_timezone").maybeSingle();
  const tz = validTz(tzRow?.value) ?? process.env["COMPANY_TIMEZONE"] ?? browserTz();
  const localDate = (iso: string) => clockIn(validTz(tz) ?? "UTC", new Date(iso)).date;
  const today = localDate(now.toISOString());
  const range = lastFullWeek(today);
  const key = `weekly:${range.from}`;
  const { data: already } = await admin.from("alerts_sent").select("key").eq("key", key).maybeSingle();
  if (already) return { skipped: "already sent", range };

  const since = new Date(now.getTime() - 14 * 86400000).toISOString();
  const [loads, brokers, trucks, fuel, maint, shifts, plans, records, trailers, drivers, docs, eventsRes] = await Promise.all([
    fetchAll<ALoad>("loads"),
    fetchAll<{ id: string; name: string; payment_terms_days: number | null }>("brokers"),
    fetchAll<{ id: string; truck_number: string; status: string; mileage: number | null; insurance_expiration: string | null; registration_expiration: string | null; inspection_due: string | null }>("trucks"),
    fetchAll<{ truck_id: string; fuel_date: string; cost: number; odometer: number | null }>("fuel_records"),
    fetchAll<{ asset_type: string; asset_id: string; service_date: string; cost: number; odometer: number | null }>("maintenance_records"),
    fetchAll<{ id: string; name: string; sort_order: number }>("shifts"),
    fetchAll<import("./maintenance").MaintenancePlan>("maintenance_plans"),
    fetchAll<{ asset_type: string; asset_id: string; odometer: number | null }>("maintenance_records"),
    fetchAll<{ id: string; trailer_number: string; status: string; mileage: number | null; insurance_expiration: string | null; registration_expiration: string | null }>("trailers"),
    fetchAll<{ id: string; full_name: string; status: string; cdl_expiration: string | null; medical_card_expiration: string | null }>("drivers"),
    fetchAll<{ id: string; entity_type: string; entity_id: string; doc_type: string; file_name: string; expires_on: string | null }>("entity_documents"),
    admin.from("load_events").select("shift_id,late_minutes,created_at").not("late_minutes", "is", null).gte("created_at", since).limit(5000),
  ]);
  const events = (eventsRes.data ?? []) as { shift_id: string | null; late_minutes: number | null; created_at: string }[];
  const expiries = collectExpiries({ drivers, trucks, trailers, docs }, now);
  const planRows = buildPlanRows({ plans, trucks, trailers, records, fuel }, now);

  const summary = buildWeekly({
    loads: loads.filter((l) => !l.deleted_at), brokers, trucks, fuel, maint, events, shifts,
    expiryDays: expiries.map((e) => e.days), serviceOverdue: planRows.filter((p) => p.status.state === "overdue").length,
    from: range.from, to: range.to, localDate, today: now,
  });
  const result = await sendMessage(`Vantera TMS weekly summary (${range.from} to ${range.to})`, weeklyText(summary));
  if (result.sent.length > 0) await admin.from("alerts_sent").upsert({ key, sent_at: now.toISOString() }, { onConflict: "key" });
  return { range, channels: result.sent, errors: result.errors };
}

export async function sendTest() {
  const st = channelStatus();
  if (!st.telegram && !st.email) return { sent: [] as string[], error: "No channel is configured yet. Add the Telegram or email settings first." };
  const r = await sendMessage("Vantera TMS test alert", "Vantera TMS: this is a test alert. If you can read this, alerts are working.");
  return { sent: r.sent, error: r.errors.join(" | ") || null };
}
