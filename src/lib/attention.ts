/** Everything that needs a person's attention right now (pure; used by the Command Center, the bell and the alert engine). */
import type { ExpiryItem } from "./alerts";
import type { BillingBuckets } from "./billing";
import { ACTIVE_STATUSES } from "./tms";
import { isOverdue, isUnreceived, type Task } from "./tasks";

export type AttentionTo = "/updates" | "/dispatch" | "/safety" | "/maintenance" | "/trucks" | "/trailers" | "/loads" | "/billing";
export type AttentionCat = "loads" | "safety" | "fleet" | "billing";
export type AttentionItem = {
  key: string;
  cat: AttentionCat;
  tone: "problem" | "transit";
  tag: string;
  text: string;
  to: AttentionTo;
  /** Do not send the same alert again within this many hours. */
  windowHours: number;
};

type L = {
  id: string;
  load_number: string;
  status: string;
  is_problem?: boolean | null;
  problem_note?: string | null;
  driver_id: string | null;
  pickup_date: string | null;
  pickup_location: string | null;
  next_update_at: string | null;
  deleted_at?: string | null;
};
type T = { id: string; truck_number: string; status: string; notes?: string | null };
type P = { plan: { id: string; name: string }; label: string; status: { state: string; text: string } };
export type TaskLite = Pick<Task, "id" | "title" | "status" | "priority" | "due_at" | "created_at"> & { assignee?: string | undefined };

const NO_DRIVER_DONE = ["delivered", "paid", "cancelled", "tonu", "pod_received", "billing"];
const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fmtAgo(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export function buildAttention(
  d: { loads: L[]; trucks: T[]; plans: P[]; expiries: ExpiryItem[]; billing: BillingBuckets; tasks?: TaskLite[] },
  now: Date = new Date(),
): AttentionItem[] {
  const out: AttentionItem[] = [];
  const today = dateStr(now);
  const tomorrow = dateStr(new Date(now.getTime() + 86400000));
  const loads = d.loads.filter((l) => !l.deleted_at);
  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status));

  for (const l of loads.filter((x) => x.is_problem)) {
    out.push({ key: `problem:${l.id}`, cat: "loads", tone: "problem", tag: "PROBLEM", text: `${l.load_number}: ${l.problem_note ?? "problem reported"}`, to: "/updates", windowHours: 8 });
  }
  for (const l of active) {
    if (l.is_problem || !l.next_update_at) continue;
    const late = (now.getTime() - new Date(l.next_update_at).getTime()) / 60000;
    if (late > 0) out.push({ key: `late:${l.id}`, cat: "loads", tone: "transit", tag: "UPDATE LATE", text: `${l.load_number}: update overdue by ${fmtAgo(late)}`, to: "/updates", windowHours: 3 });
  }
  for (const l of loads) {
    if (l.driver_id || NO_DRIVER_DONE.includes(l.status) || !l.pickup_date || l.pickup_date > tomorrow) continue;
    const when = l.pickup_date < today ? "pickup date passed" : l.pickup_date === today ? "picks up today" : "picks up tomorrow";
    out.push({ key: `nodriver:${l.id}`, cat: "loads", tone: "problem", tag: "NO DRIVER", text: `${l.load_number} (${l.pickup_location ?? "—"}) ${when} and has no driver`, to: "/dispatch", windowHours: 6 });
  }
  for (const i of d.expiries) {
    if (i.days > 14) continue;
    const to: AttentionTo = i.kind === "driver" ? "/safety" : i.kind === "truck" ? "/trucks" : "/trailers";
    const cat: AttentionCat = i.kind === "driver" ? "safety" : "fleet";
    if (i.days < 0) out.push({ key: `expired:${i.key}`, cat, tone: "problem", tag: "EXPIRED", text: `${i.owner}: ${i.what} expired ${-i.days} days ago`, to, windowHours: 24 });
    else out.push({ key: `expiring:${i.key}`, cat, tone: "transit", tag: "EXPIRING", text: `${i.owner}: ${i.what} expires in ${i.days} days`, to, windowHours: 24 });
  }
  for (const p of d.plans) {
    if (p.status.state === "overdue") out.push({ key: `service:${p.plan.id}`, cat: "fleet", tone: "problem", tag: "SERVICE OVERDUE", text: `${p.label}: ${p.plan.name} (${p.status.text})`, to: "/maintenance", windowHours: 24 });
    else if (p.status.state === "due_soon") out.push({ key: `servicesoon:${p.plan.id}`, cat: "fleet", tone: "transit", tag: "SERVICE DUE SOON", text: `${p.label}: ${p.plan.name} (${p.status.text})`, to: "/maintenance", windowHours: 24 });
  }
  for (const t of d.trucks.filter((x) => ["in_shop", "out_of_service"].includes(x.status))) {
    out.push({ key: `shop:${t.id}`, cat: "fleet", tone: "transit", tag: t.status === "in_shop" ? "IN SHOP" : "OUT OF SERVICE", text: `Truck ${t.truck_number}${t.notes ? ` · ${t.notes}` : ""}`, to: "/trucks", windowHours: 24 });
  }
  for (const r of d.billing.toInvoice.filter((x) => x.ageDays >= 1)) {
    out.push({ key: `invoice:${r.load.id}`, cat: "billing", tone: "transit", tag: "READY TO INVOICE", text: `${r.load.load_number} (${r.broker}) delivered ${r.ageDays} days ago`, to: "/billing", windowHours: 24 });
  }
  for (const r of d.billing.waitingPod.filter((x) => x.ageDays >= 2)) {
    out.push({ key: `pod:${r.load.id}`, cat: "billing", tone: "transit", tag: "POD MISSING", text: `${r.load.load_number} (${r.broker}) delivered ${r.ageDays} days ago, no POD yet`, to: "/billing", windowHours: 24 });
  }
  for (const r of d.billing.overdue) {
    out.push({ key: `overdue:${r.load.id}`, cat: "billing", tone: "problem", tag: "PAYMENT OVERDUE", text: `${r.load.load_number} (${r.broker}) ${r.daysOverdue} days past due`, to: "/billing", windowHours: 48 });
  }
  for (const t of d.tasks ?? []) {
    const who = t.assignee ?? "Someone";
    const tone = t.priority === "urgent" ? "problem" : "transit";
    if (isOverdue(t, now)) {
      out.push({ key: `task-overdue:${t.id}`, cat: "loads", tone: "problem", tag: "TASK OVERDUE", text: `${who}: "${t.title}" is past its due time`, to: "/dispatch", windowHours: 4 });
    } else if (isUnreceived(t, now)) {
      const mins = (now.getTime() - new Date(t.created_at).getTime()) / 60000;
      out.push({ key: `task-unreceived:${t.id}`, cat: "loads", tone, tag: "TASK NOT RECEIVED", text: `${who} has not acknowledged "${t.title}" for ${fmtAgo(mins)}`, to: "/dispatch", windowHours: 2 });
    }
  }
  return out;
}

/** Which kinds of alerts each role sees in the bell. */
export function catsForRoles(roles: string[]): AttentionCat[] {
  const has = (r: string) => roles.includes(r);
  if (has("super_admin") || has("admin") || has("supervisor")) return ["loads", "safety", "fleet", "billing"];
  const cats = new Set<AttentionCat>();
  if (has("dispatcher") || has("updater")) cats.add("loads");
  if (has("safety")) cats.add("safety");
  if (has("fleet_manager") || has("maintenance")) cats.add("fleet");
  if (has("accounting")) cats.add("billing");
  return [...cats];
}
