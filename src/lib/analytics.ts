/** Profit, scorecards, lanes and shift performance (pure functions). */
import { LATE_GRACE_MIN } from "./intervals";
import { billingBuckets, revenueOf, type BillLoad } from "./billing";

export type ALoad = BillLoad & {
  driver_id: string | null;
  truck_id: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  created_at: string;
  miles: number | null;
  deadhead_miles?: number | null;
  driver_pay?: number | null;
  is_problem?: boolean | null;
};

export const DONE_STATUSES = ["delivered", "pod_received", "billing", "paid"];
const num = (v: number | null | undefined) => Number(v ?? 0);
const rpmOf = (revenue: number, miles: number) => (miles > 0 ? revenue / miles : null);

export const dateOf = (l: { pickup_date: string | null; created_at: string }) =>
  l.pickup_date ?? l.created_at.slice(0, 10);
export const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/** Loads picked up (or created) in the date range, not deleted or cancelled. */
export function selectLoads<T extends ALoad>(loads: T[], from: string, to: string): T[] {
  return loads.filter(
    (l) =>
      !l.deleted_at &&
      !["cancelled", "rejected", "tonu"].includes(l.status) &&
      inRange(dateOf(l), from, to),
  );
}

/** true = delivered by the delivery date, false = late, null = cannot tell yet. Compared by calendar day. */
export function deliveredOnTime(l: ALoad, localDate: (iso: string) => string): boolean | null {
  if (!l.delivered_at || !l.delivery_date) return null;
  return localDate(l.delivered_at) <= l.delivery_date;
}

/* ---------------- profit per truck ---------------- */
export type TruckProfit = {
  id: string;
  label: string;
  loads: number;
  revenue: number;
  driverPay: number;
  fuel: number;
  maintenance: number;
  profit: number;
  miles: number;
  deadheadPct: number | null;
  rpm: number | null;
  profitPerMile: number | null;
};

export function profitByTruck(
  loads: ALoad[],
  trucks: { id: string; truck_number: string }[],
  fuel: { truck_id: string; fuel_date: string; cost: number }[],
  maint: { asset_type: string; asset_id: string; service_date: string; cost: number }[],
  from: string,
  to: string,
): TruckProfit[] {
  const rows: TruckProfit[] = [];
  for (const t of trucks) {
    const mine = selectLoads(loads, from, to).filter((l) => l.truck_id === t.id);
    const revenue = mine.reduce((s, l) => s + revenueOf(l), 0);
    const driverPay = mine.reduce((s, l) => s + num(l.driver_pay), 0);
    const miles = mine.reduce((s, l) => s + num(l.miles), 0);
    const dead = mine.reduce((s, l) => s + num(l.deadhead_miles), 0);
    const f = fuel
      .filter((x) => x.truck_id === t.id && inRange(x.fuel_date, from, to))
      .reduce((s, x) => s + num(x.cost), 0);
    const m = maint
      .filter(
        (x) => x.asset_type === "truck" && x.asset_id === t.id && inRange(x.service_date, from, to),
      )
      .reduce((s, x) => s + num(x.cost), 0);
    if (mine.length === 0 && f === 0 && m === 0) continue;
    const profit = revenue - driverPay - f - m;
    rows.push({
      id: t.id,
      label: `Truck ${t.truck_number}`,
      loads: mine.length,
      revenue,
      driverPay,
      fuel: f,
      maintenance: m,
      profit,
      miles,
      deadheadPct: miles + dead > 0 ? (dead / (miles + dead)) * 100 : null,
      rpm: rpmOf(revenue, miles),
      profitPerMile: rpmOf(profit, miles),
    });
  }
  return rows.sort((a, b) => b.profit - a.profit);
}

/* ---------------- driver scorecard ---------------- */
export type DriverScore = {
  id: string;
  name: string;
  loads: number;
  delivered: number;
  miles: number;
  revenue: number;
  margin: number;
  rpm: number | null;
  problemLoads: number;
  onTimePct: number | null;
  onTimeMeasured: number;
  issues: string[];
};

export function driverScorecards(
  loads: ALoad[],
  drivers: { id: string; full_name: string }[],
  from: string,
  to: string,
  localDate: (iso: string) => string,
  issuesOf: (driverId: string) => string[],
): DriverScore[] {
  const rows: DriverScore[] = [];
  const pool = selectLoads(loads, from, to);
  for (const d of drivers) {
    const mine = pool.filter((l) => l.driver_id === d.id);
    if (mine.length === 0) continue;
    const revenue = mine.reduce((s, l) => s + revenueOf(l), 0);
    const pay = mine.reduce((s, l) => s + num(l.driver_pay), 0);
    const miles = mine.reduce((s, l) => s + num(l.miles), 0);
    const measured = mine
      .map((l) => deliveredOnTime(l, localDate))
      .filter((x): x is boolean => x !== null);
    rows.push({
      id: d.id,
      name: d.full_name,
      loads: mine.length,
      delivered: mine.filter((l) => DONE_STATUSES.includes(l.status)).length,
      miles,
      revenue,
      margin: revenue - pay,
      rpm: rpmOf(revenue, miles),
      problemLoads: mine.filter((l) => l.is_problem || l.status === "problem").length,
      onTimePct: measured.length ? (measured.filter(Boolean).length / measured.length) * 100 : null,
      onTimeMeasured: measured.length,
      issues: issuesOf(d.id),
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

/* ---------------- broker scorecard ---------------- */
export type BrokerScore = {
  id: string;
  name: string;
  loads: number;
  revenue: number;
  miles: number;
  rpm: number | null;
  problemLoads: number;
  problemPct: number;
  avgDaysToPay: number | null;
  paidCount: number;
  unpaid: number;
  overdue: number;
};

const dayNum = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export function brokerScorecards(
  loads: ALoad[],
  brokers: { id: string; name: string; payment_terms_days?: number | null }[],
  from: string,
  to: string,
  today: Date = new Date(),
): BrokerScore[] {
  const pool = selectLoads(loads, from, to);
  const buckets = billingBuckets(loads, brokers, today);
  const rows: BrokerScore[] = [];
  for (const b of brokers) {
    const mine = pool.filter((l) => l.broker_id === b.id);
    if (mine.length === 0) continue;
    const revenue = mine.reduce((s, l) => s + revenueOf(l), 0);
    const miles = mine.reduce((s, l) => s + num(l.miles), 0);
    const problem = mine.filter((l) => l.is_problem || l.status === "problem").length;
    const paid = loads.filter(
      (l) =>
        l.broker_id === b.id &&
        l.status === "paid" &&
        l.invoice_date &&
        l.paid_date &&
        !l.deleted_at,
    );
    const days = paid.map((l) => dayNum(l.paid_date as string) - dayNum(l.invoice_date as string));
    rows.push({
      id: b.id,
      name: b.name,
      loads: mine.length,
      revenue,
      miles,
      rpm: rpmOf(revenue, miles),
      problemLoads: problem,
      problemPct: (problem / mine.length) * 100,
      avgDaysToPay: days.length ? days.reduce((s, x) => s + x, 0) / days.length : null,
      paidCount: paid.length,
      unpaid: buckets.unpaid
        .filter((r) => r.load.broker_id === b.id)
        .reduce((s, r) => s + r.amount, 0),
      overdue: buckets.overdue
        .filter((r) => r.load.broker_id === b.id)
        .reduce((s, r) => s + r.amount, 0),
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

/* ---------------- lanes ---------------- */
export type LaneRow = {
  lane: string;
  loads: number;
  revenue: number;
  avgRevenue: number;
  avgRpm: number | null;
  margin: number;
  avgMargin: number;
  miles: number;
};

const city = (s: string | null) => (s ?? "").split(",")[0]?.trim() ?? "";

export function laneAnalysis(loads: ALoad[], from: string, to: string): LaneRow[] {
  const map = new Map<
    string,
    { label: string; loads: number; revenue: number; pay: number; miles: number }
  >();
  for (const l of selectLoads(loads, from, to)) {
    const a = city(l.pickup_location);
    const b = city(l.delivery_location);
    if (!a || !b) continue;
    const key = `${a.toLowerCase()}>${b.toLowerCase()}`;
    const g = map.get(key) ?? { label: `${a} → ${b}`, loads: 0, revenue: 0, pay: 0, miles: 0 };
    g.loads++;
    g.revenue += revenueOf(l);
    g.pay += num(l.driver_pay);
    g.miles += num(l.miles);
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({
      lane: g.label,
      loads: g.loads,
      revenue: g.revenue,
      avgRevenue: g.revenue / g.loads,
      avgRpm: rpmOf(g.revenue, g.miles),
      margin: g.revenue - g.pay,
      avgMargin: (g.revenue - g.pay) / g.loads,
      miles: g.miles,
    }))
    .sort((x, y) => y.margin - x.margin);
}

/* ---------------- shift performance ---------------- */
export type ShiftStat = {
  id: string;
  name: string;
  updates: number;
  onTime: number;
  late: number;
  pctOnTime: number | null;
  avgLateMin: number | null;
};

export function shiftPerformance(
  events: { shift_id: string | null; late_minutes: number | null; created_at: string }[],
  shifts: { id: string; name: string; sort_order: number }[],
  from: string,
  to: string,
  localDate: (iso: string) => string,
): ShiftStat[] {
  const rows: ShiftStat[] = [];
  for (const s of [...shifts].sort((a, b) => a.sort_order - b.sort_order)) {
    const mine = events.filter(
      (e) =>
        e.shift_id === s.id &&
        e.late_minutes !== null &&
        inRange(localDate(e.created_at), from, to),
    );
    const late = mine.filter((e) => (e.late_minutes ?? 0) > LATE_GRACE_MIN);
    rows.push({
      id: s.id,
      name: s.name,
      updates: mine.length,
      onTime: mine.length - late.length,
      late: late.length,
      pctOnTime: mine.length ? ((mine.length - late.length) / mine.length) * 100 : null,
      avgLateMin: late.length
        ? late.reduce((t, e) => t + (e.late_minutes ?? 0), 0) / late.length
        : null,
    });
  }
  return rows;
}
