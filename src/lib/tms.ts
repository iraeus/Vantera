export const LOAD_STATUSES = [
  "new",
  "available",
  "booked",
  "assigned",
  "dispatched",
  "at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "at_delivery",
  "unloading",
  "upcoming",
  "delivered",
  "pod_received",
  "billing",
  "paid",
  "cancelled",
  "rejected",
  "tonu",
  "problem",
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

export const TRUCK_STATUSES = [
  "available",
  "assigned",
  "in_transit",
  "at_home",
  "in_shop",
  "out_of_service",
  "sold",
  "inactive",
] as const;

export const TRAILER_STATUSES = [
  "available",
  "assigned",
  "in_transit",
  "in_shop",
  "out_of_service",
  "sold",
  "inactive",
] as const;

export const DRIVER_STATUSES = [
  "available",
  "on_load",
  "off_duty",
  "home",
  "vacation",
  "sick",
  "inactive",
] as const;

export const APP_ROLES = [
  "super_admin",
  "admin",
  "supervisor",
  "dispatcher",
  "updater",
  "accounting",
  "safety",
  "fleet_manager",
  "maintenance",
  "viewer",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function label(value?: string | null): string {
  if (!value) return "—";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Tone = "accent" | "transit" | "delivered" | "problem" | "mut";

const STATUS_TONE: Record<string, Tone> = {
  new: "mut",
  upcoming: "accent",
  available: "accent",
  booked: "accent",
  assigned: "accent",
  dispatched: "accent",
  at_pickup: "transit",
  loading: "transit",
  picked_up: "transit",
  in_transit: "transit",
  at_delivery: "transit",
  unloading: "transit",
  delivered: "delivered",
  pod_received: "delivered",
  billing: "delivered",
  paid: "delivered",
  cancelled: "mut",
  rejected: "problem",
  tonu: "problem",
  problem: "problem",
  on_load: "transit",
  in_shop: "problem",
  out_of_service: "problem",
  off_duty: "mut",
  home: "mut",
  vacation: "mut",
  sick: "problem",
  inactive: "mut",
  at_home: "mut",
  sold: "mut",
};

export function statusTone(status?: string | null): Tone {
  if (!status) return "mut";
  return STATUS_TONE[status] ?? "mut";
}

export const ACTIVE_STATUSES: string[] = [
  "booked",
  "upcoming",
  "assigned",
  "dispatched",
  "at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "at_delivery",
  "unloading",
];

export const TRANSIT_STATUSES: string[] = ["picked_up", "in_transit", "at_delivery", "unloading"];

export function money(value?: number | null): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function loadRevenue(l: {
  rate?: number | null;
  fuel_surcharge?: number | null;
  detention?: number | null;
  layover?: number | null;
  other_charges?: number | null;
}): number {
  return (
    Number(l.rate ?? 0) +
    Number(l.fuel_surcharge ?? 0) +
    Number(l.detention ?? 0) +
    Number(l.layover ?? 0) +
    Number(l.other_charges ?? 0)
  );
}

export function rpm(l: { miles?: number | null } & Parameters<typeof loadRevenue>[0]): number {
  const miles = Number(l.miles ?? 0);
  if (!miles) return 0;
  return loadRevenue(l) / miles;
}

/** Safety clearance: driver is active and CDL + medical card are on file and not expired. */
export function safetyIssues(
  d: {
    status?: string | null;
    cdl_expiration?: string | null;
    medical_card_expiration?: string | null;
  },
  today: Date = new Date(),
): string[] {
  const issues: string[] = [];
  const day = today.toISOString().slice(0, 10);
  if (["inactive", "sick", "vacation"].includes(d.status ?? ""))
    issues.push(`status ${label(d.status)}`);
  if (!d.cdl_expiration) issues.push("no CDL expiry");
  else if (d.cdl_expiration < day) issues.push("CDL expired");
  if (!d.medical_card_expiration) issues.push("no medical card");
  else if (d.medical_card_expiration < day) issues.push("medical expired");
  return issues;
}

/** Where each role lands after signing in. The first matching role (in this order) wins. */
export function homeFor(
  roles: string[],
): "/command" | "/dispatch" | "/updates" | "/safety" | "/maintenance" | "/billing" | "/dashboard" {
  const has = (r: string) => roles.includes(r);
  if (has("super_admin") || has("admin") || has("supervisor")) return "/command";
  if (has("dispatcher")) return "/dispatch";
  if (has("updater")) return "/updates";
  if (has("safety")) return "/safety";
  if (has("fleet_manager") || has("maintenance")) return "/maintenance";
  if (has("accounting")) return "/billing";
  return "/dashboard";
}
