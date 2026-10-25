/** Invoicing and payment follow-up (pure functions). */
export type BillLoad = {
  id: string;
  load_number: string;
  status: string;
  broker_id: string | null;
  customer_name: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  delivered_at: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  paid_date: string | null;
  rate?: number | null;
  fuel_surcharge?: number | null;
  detention?: number | null;
  layover?: number | null;
  other_charges?: number | null;
  deleted_at?: string | null;
};

const num = (v: number | null | undefined) => Number(v ?? 0);
export const revenueOf = (l: BillLoad) => num(l.rate) + num(l.fuel_surcharge) + num(l.detention) + num(l.layover) + num(l.other_charges);

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export const addDaysTo = (date: string, n: number) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export type BillRow = {
  load: BillLoad;
  amount: number;
  broker: string;
  /** Days since delivery (ready / POD rows) or since the invoice date (unpaid rows). */
  ageDays: number;
  dueDate: string | null;
  daysOverdue: number;
  termsDays: number;
};

export type BillingBuckets = {
  waitingPod: BillRow[];
  toInvoice: BillRow[];
  unpaid: BillRow[];
  overdue: BillRow[];
  paidRecent: BillRow[];
};

export function billingBuckets(
  loads: BillLoad[],
  brokers: { id: string; name: string; payment_terms_days?: number | null }[],
  today: Date = new Date(),
): BillingBuckets {
  const todayStr = localDate(today);
  const out: BillingBuckets = { waitingPod: [], toInvoice: [], unpaid: [], overdue: [], paidRecent: [] };
  for (const l of loads) {
    if (l.deleted_at) continue;
    const b = brokers.find((x) => x.id === l.broker_id);
    const terms = b?.payment_terms_days ?? 30;
    const base = {
      load: l,
      amount: revenueOf(l),
      broker: b?.name ?? l.customer_name ?? "No broker",
      termsDays: terms,
    };
    const sinceDelivery = l.delivered_at ? Math.floor((today.getTime() - new Date(l.delivered_at).getTime()) / 86400000) : 0;
    if (l.status === "delivered") {
      if (sinceDelivery >= 1) out.waitingPod.push({ ...base, ageDays: sinceDelivery, dueDate: null, daysOverdue: 0 });
    } else if (l.status === "pod_received") {
      out.toInvoice.push({ ...base, ageDays: sinceDelivery, dueDate: null, daysOverdue: 0 });
    } else if (l.status === "billing") {
      const inv = l.invoice_date ?? (l.delivered_at ? l.delivered_at.slice(0, 10) : todayStr);
      const due = addDaysTo(inv, terms);
      const overdueDays = Math.max(0, dayNum(todayStr) - dayNum(due));
      const row = { ...base, ageDays: dayNum(todayStr) - dayNum(inv), dueDate: due, daysOverdue: overdueDays };
      out.unpaid.push(row);
      if (overdueDays > 0) out.overdue.push(row);
    } else if (l.status === "paid" && l.paid_date && dayNum(todayStr) - dayNum(l.paid_date) <= 30) {
      out.paidRecent.push({ ...base, ageDays: 0, dueDate: null, daysOverdue: 0 });
    }
  }
  out.waitingPod.sort((a, b) => b.ageDays - a.ageDays);
  out.toInvoice.sort((a, b) => b.ageDays - a.ageDays);
  out.unpaid.sort((a, b) => b.daysOverdue - a.daysOverdue || b.ageDays - a.ageDays);
  out.overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return out;
}

export const sumAmount = (rows: BillRow[]) => rows.reduce((s, r) => s + r.amount, 0);

/** Generic invoice CSV (opens in Excel; QuickBooks can import it with column mapping). */
export function invoiceCsvRows(rows: BillRow[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    InvoiceNo: r.load.invoice_number || r.load.load_number,
    Customer: r.broker,
    InvoiceDate: r.load.invoice_date ?? "",
    DueDate: r.dueDate ?? "",
    Terms: `Net ${r.termsDays}`,
    Memo: `${r.load.load_number}: ${r.load.pickup_location ?? ""} to ${r.load.delivery_location ?? ""}`,
    "Item(Product/Service)": "Freight",
    ItemDescription: `Load ${r.load.load_number}`,
    ItemQuantity: 1,
    ItemRate: r.amount.toFixed(2),
    ItemAmount: r.amount.toFixed(2),
  }));
}
