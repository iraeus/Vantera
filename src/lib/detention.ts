/** Detention = time waiting at a stop beyond the free time. */
export type DetentionInfo = {
  pickupHours: number | null;
  deliveryHours: number | null;
  billableHours: number;
  amount: number | null;
};

export function hoursBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 3600_000;
}

/** Hours over the free time, rounded UP to the next quarter hour. */
const billable = (hours: number | null, free: number) => {
  if (hours === null || hours <= free) return 0;
  return Math.ceil((hours - free) * 4) / 4;
};

export function detentionFor(
  l: {
    pickup_arrived_at?: string | null;
    pickup_departed_at?: string | null;
    delivery_arrived_at?: string | null;
    delivery_departed_at?: string | null;
  },
  freeHours: number,
  ratePerHour: number | null,
): DetentionInfo {
  const pickupHours = hoursBetween(l.pickup_arrived_at, l.pickup_departed_at);
  const deliveryHours = hoursBetween(l.delivery_arrived_at, l.delivery_departed_at);
  const billableHours = billable(pickupHours, freeHours) + billable(deliveryHours, freeHours);
  return { pickupHours, deliveryHours, billableHours, amount: ratePerHour && ratePerHour > 0 ? billableHours * ratePerHour : null };
}

export const fmtHours = (h: number | null) => {
  if (h === null) return "—";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
