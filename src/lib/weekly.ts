/** Weekly management summary (pure functions). */
import { billingBuckets, revenueOf, sumAmount, type BillingBuckets } from "./billing";
import { DONE_STATUSES, deliveredOnTime, inRange, profitByTruck, shiftPerformance, type ALoad } from "./analytics";

export type WeeklySummary = {
  from: string;
  to: string;
  deliveredLoads: number;
  revenue: number;
  driverPay: number;
  fuel: number;
  maintenance: number;
  profit: number;
  miles: number;
  rpm: number | null;
  onTimePct: number | null;
  onTimeMeasured: number;
  updatesOnTimePct: number | null;
  updatesMeasured: number;
  problemLoadsNow: number;
  topBrokers: { name: string; revenue: number }[];
  topTrucks: { label: string; profit: number }[];
  expiredItems: number;
  expiringSoon: number;
  serviceOverdue: number;
  toInvoiceCount: number;
  toInvoiceAmount: number;
  overdueCount: number;
  overdueAmount: number;
};

export type WeeklyInput = {
  loads: ALoad[];
  brokers: { id: string; name: string; payment_terms_days?: number | null }[];
  trucks: { id: string; truck_number: string }[];
  fuel: { truck_id: string; fuel_date: string; cost: number }[];
  maint: { asset_type: string; asset_id: string; service_date: string; cost: number }[];
  events: { shift_id: string | null; late_minutes: number | null; created_at: string }[];
  shifts: { id: string; name: string; sort_order: number }[];
  expiryDays: number[];
  serviceOverdue: number;
  from: string;
  to: string;
  localDate: (iso: string) => string;
  today?: Date;
};

export function buildWeekly(i: WeeklyInput): WeeklySummary {
  const delivered = i.loads.filter(
    (l) => !l.deleted_at && DONE_STATUSES.includes(l.status) && l.delivered_at && inRange(i.localDate(l.delivered_at), i.from, i.to),
  );
  const revenue = delivered.reduce((s, l) => s + revenueOf(l), 0);
  const driverPay = delivered.reduce((s, l) => s + Number(l.driver_pay ?? 0), 0);
  const miles = delivered.reduce((s, l) => s + Number(l.miles ?? 0), 0);
  const fuel = i.fuel.filter((f) => inRange(f.fuel_date, i.from, i.to)).reduce((s, f) => s + Number(f.cost), 0);
  const maintenance = i.maint.filter((m) => inRange(m.service_date, i.from, i.to)).reduce((s, m) => s + Number(m.cost), 0);
  const measured = delivered.map((l) => deliveredOnTime(l, i.localDate)).filter((x): x is boolean => x !== null);
  const shiftRows = shiftPerformance(i.events, i.shifts, i.from, i.to, i.localDate);
  const updates = shiftRows.reduce((s, r) => s + r.updates, 0);
  const onTimeUpdates = shiftRows.reduce((s, r) => s + r.onTime, 0);

  const byBroker = new Map<string, number>();
  for (const l of delivered) {
    const name = i.brokers.find((b) => b.id === l.broker_id)?.name ?? l.customer_name ?? "No broker";
    byBroker.set(name, (byBroker.get(name) ?? 0) + revenueOf(l));
  }
  const buckets: BillingBuckets = billingBuckets(i.loads, i.brokers, i.today);
  const trucks = profitByTruck(i.loads, i.trucks, i.fuel, i.maint, i.from, i.to);

  return {
    from: i.from,
    to: i.to,
    deliveredLoads: delivered.length,
    revenue,
    driverPay,
    fuel,
    maintenance,
    profit: revenue - driverPay - fuel - maintenance,
    miles,
    rpm: miles > 0 ? revenue / miles : null,
    onTimePct: measured.length ? (measured.filter(Boolean).length / measured.length) * 100 : null,
    onTimeMeasured: measured.length,
    updatesOnTimePct: updates ? (onTimeUpdates / updates) * 100 : null,
    updatesMeasured: updates,
    problemLoadsNow: i.loads.filter((l) => !l.deleted_at && (l.is_problem || l.status === "problem")).length,
    topBrokers: [...byBroker.entries()].map(([name, rev]) => ({ name, revenue: rev })).sort((a, b) => b.revenue - a.revenue).slice(0, 3),
    topTrucks: trucks.slice(0, 3).map((t) => ({ label: t.label, profit: t.profit })),
    expiredItems: i.expiryDays.filter((d) => d < 0).length,
    expiringSoon: i.expiryDays.filter((d) => d >= 0 && d <= 30).length,
    serviceOverdue: i.serviceOverdue,
    toInvoiceCount: buckets.toInvoice.length,
    toInvoiceAmount: sumAmount(buckets.toInvoice),
    overdueCount: buckets.overdue.length,
    overdueAmount: sumAmount(buckets.overdue),
  };
}

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n)}%`);

export function weeklyText(s: WeeklySummary, company = "Vantera TMS"): string {
  const lines = [
    `${company} - weekly summary (${s.from} to ${s.to})`,
    "",
    `Delivered loads: ${s.deliveredLoads}`,
    `Revenue: ${usd(s.revenue)}   Driver pay: ${usd(s.driverPay)}   Fuel: ${usd(s.fuel)}   Maintenance: ${usd(s.maintenance)}`,
    `Profit: ${usd(s.profit)}   Miles: ${Math.round(s.miles).toLocaleString("en-US")}   Revenue/mile: ${s.rpm === null ? "n/a" : `$${s.rpm.toFixed(2)}`}`,
    `On-time deliveries: ${pct(s.onTimePct)} (of ${s.onTimeMeasured} measured)`,
    `Updates on time: ${pct(s.updatesOnTimePct)} (of ${s.updatesMeasured})`,
    "",
    `Top brokers: ${s.topBrokers.length ? s.topBrokers.map((b) => `${b.name} ${usd(b.revenue)}`).join(", ") : "none"}`,
    `Top trucks by profit: ${s.topTrucks.length ? s.topTrucks.map((t) => `${t.label} ${usd(t.profit)}`).join(", ") : "none"}`,
    "",
    "Needs attention:",
    `- Problem loads now: ${s.problemLoadsNow}`,
    `- Expired items: ${s.expiredItems}, expiring within 30 days: ${s.expiringSoon}`,
    `- Service overdue: ${s.serviceOverdue}`,
    `- Ready to invoice: ${s.toInvoiceCount} loads (${usd(s.toInvoiceAmount)})`,
    `- Overdue payments: ${s.overdueCount} loads (${usd(s.overdueAmount)})`,
  ];
  return lines.join("\n");
}
