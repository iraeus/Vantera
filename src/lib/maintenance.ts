/** Maintenance schedule logic (pure functions). */

export type MaintenancePlan = {
  id: string;
  asset_type: "truck" | "trailer";
  asset_id: string;
  name: string;
  interval_miles: number | null;
  interval_days: number | null;
  last_service_date: string | null;
  last_service_miles: number | null;
  notes: string | null;
};

export const DUE_SOON_DAYS = 14;
export const DUE_SOON_MILES = 1500;

export type PlanState = "overdue" | "due_soon" | "ok" | "no_baseline";
export type PlanStatus = {
  state: PlanState;
  dueDate: string | null;
  dueMiles: number | null;
  daysLeft: number | null;
  milesLeft: number | null;
  text: string;
};

/** Starter plans. These are common intervals, not manufacturer rules: edit them per truck. */
export const STANDARD_PLANS: Record<"truck" | "trailer", { name: string; interval_miles: number | null; interval_days: number | null }[]> = {
  truck: [
    { name: "Oil & filter change", interval_miles: 20000, interval_days: 180 },
    { name: "PM inspection", interval_miles: null, interval_days: 90 },
    { name: "Brake & tire check", interval_miles: 30000, interval_days: null },
    { name: "Annual DOT inspection", interval_miles: null, interval_days: 365 },
  ],
  trailer: [
    { name: "PM inspection", interval_miles: null, interval_days: 90 },
    { name: "Brake & tire check", interval_miles: null, interval_days: 120 },
    { name: "Annual DOT inspection", interval_miles: null, interval_days: 365 },
  ],
};

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
const plusDays = (date: string, n: number) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Best known odometer: the larger of the unit's mileage and any odometer reading logged. */
export function assetMiles(mileage: number | null | undefined, odometers: (number | null | undefined)[]): number | null {
  const all = [mileage, ...odometers].filter((v): v is number => typeof v === "number" && v > 0);
  return all.length ? Math.max(...all) : null;
}

export function planStatus(plan: MaintenancePlan, currentMiles: number | null, today: Date = new Date()): PlanStatus {
  const todayStr = localDate(today);
  let dueDate: string | null = null;
  let daysLeft: number | null = null;
  if (plan.interval_days && plan.last_service_date) {
    dueDate = plusDays(plan.last_service_date, plan.interval_days);
    daysLeft = stamp(dueDate) - stamp(todayStr);
  }
  let dueMiles: number | null = null;
  let milesLeft: number | null = null;
  if (plan.interval_miles && plan.last_service_miles != null && currentMiles != null) {
    dueMiles = plan.last_service_miles + plan.interval_miles;
    milesLeft = dueMiles - currentMiles;
  }
  if (daysLeft === null && milesLeft === null) {
    return { state: "no_baseline", dueDate, dueMiles, daysLeft, milesLeft, text: "Record the last service to start tracking" };
  }
  const overdue = (daysLeft !== null && daysLeft < 0) || (milesLeft !== null && milesLeft < 0);
  const soon = (daysLeft !== null && daysLeft <= DUE_SOON_DAYS) || (milesLeft !== null && milesLeft <= DUE_SOON_MILES);
  const parts: string[] = [];
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `${-daysLeft} d overdue` : `${daysLeft} d left`);
  if (milesLeft !== null) parts.push(milesLeft < 0 ? `${(-milesLeft).toLocaleString()} mi overdue` : `${milesLeft.toLocaleString()} mi left`);
  return { state: overdue ? "overdue" : soon ? "due_soon" : "ok", dueDate, dueMiles, daysLeft, milesLeft, text: parts.join(" · ") };
}

const RANK: Record<PlanState, number> = { overdue: 0, due_soon: 1, no_baseline: 2, ok: 3 };
export const planRank = (s: PlanState) => RANK[s];

type PlanAsset = { id: string; status: string; mileage: number | null };

export type PlanRow = {
  plan: MaintenancePlan;
  asset: PlanAsset;
  label: string;
  miles: number | null;
  status: PlanStatus;
};

/** One row per plan with its computed status. Sold and inactive units are skipped. */
export function buildPlanRows(
  d: {
    plans: MaintenancePlan[];
    trucks: (PlanAsset & { truck_number: string })[];
    trailers: (PlanAsset & { trailer_number: string })[];
    records: { asset_type: string; asset_id: string; odometer: number | null }[];
    fuel: { truck_id: string; odometer: number | null }[];
  },
  today: Date = new Date(),
): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const p of d.plans) {
    const truck = p.asset_type === "truck" ? d.trucks.find((t) => t.id === p.asset_id) : undefined;
    const trailer = p.asset_type === "trailer" ? d.trailers.find((t) => t.id === p.asset_id) : undefined;
    const asset = truck ?? trailer;
    if (!asset || ["sold", "inactive"].includes(asset.status)) continue;
    const odos = [
      ...d.records.filter((r) => r.asset_type === p.asset_type && r.asset_id === p.asset_id).map((r) => r.odometer),
      ...(truck ? d.fuel.filter((f) => f.truck_id === truck.id).map((f) => f.odometer) : []),
    ];
    const miles = assetMiles(asset.mileage, odos);
    rows.push({
      plan: p,
      asset,
      label: truck ? `Truck ${truck.truck_number}` : `Trailer ${trailer?.trailer_number ?? ""}`,
      miles,
      status: planStatus(p, miles, today),
    });
  }
  return rows;
}
