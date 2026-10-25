/** Expiring documents / dates and missing safety information (pure functions). */

type Dated = { id: string; status?: string | null };
type DriverLike = Dated & {
  full_name: string;
  cdl_expiration: string | null;
  medical_card_expiration: string | null;
};
type TruckLike = Dated & {
  truck_number: string;
  insurance_expiration: string | null;
  registration_expiration: string | null;
  inspection_due: string | null;
};
type TrailerLike = Dated & {
  trailer_number: string;
  insurance_expiration: string | null;
  registration_expiration: string | null;
};
type DocLike = { id: string; entity_type: string; entity_id: string; doc_type: string; file_name: string; expires_on: string | null };

export type ExpiryKind = "driver" | "truck" | "trailer";
export type ExpiryItem = {
  key: string;
  kind: ExpiryKind;
  owner: string;
  what: string;
  date: string;
  days: number;
  fromDocument: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export const daysFrom = (date: string, today: Date = new Date()) => dayNum(date) - dayNum(localDate(today));
const nice = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const INACTIVE_DRIVER = ["inactive"];
const INACTIVE_ASSET = ["sold", "inactive"];

export function collectExpiries(
  data: { drivers: DriverLike[]; trucks: TruckLike[]; trailers: TrailerLike[]; docs: DocLike[] },
  today: Date = new Date(),
): ExpiryItem[] {
  const items: ExpiryItem[] = [];
  const add = (kind: ExpiryKind, id: string, owner: string, what: string, date: string | null, fromDocument = false) => {
    if (!date) return;
    items.push({ key: `${kind}:${id}:${what}:${date}`, kind, owner, what, date, days: daysFrom(date, today), fromDocument });
  };
  const names = new Map<string, { kind: ExpiryKind; owner: string }>();

  for (const d of data.drivers) {
    if (INACTIVE_DRIVER.includes(d.status ?? "")) continue;
    names.set(d.id, { kind: "driver", owner: d.full_name });
    add("driver", d.id, d.full_name, "CDL", d.cdl_expiration);
    add("driver", d.id, d.full_name, "Medical card", d.medical_card_expiration);
  }
  for (const t of data.trucks) {
    if (INACTIVE_ASSET.includes(t.status ?? "")) continue;
    const owner = `Truck ${t.truck_number}`;
    names.set(t.id, { kind: "truck", owner });
    add("truck", t.id, owner, "Insurance", t.insurance_expiration);
    add("truck", t.id, owner, "Registration", t.registration_expiration);
    add("truck", t.id, owner, "Inspection due", t.inspection_due);
  }
  for (const t of data.trailers) {
    if (INACTIVE_ASSET.includes(t.status ?? "")) continue;
    const owner = `Trailer ${t.trailer_number}`;
    names.set(t.id, { kind: "trailer", owner });
    add("trailer", t.id, owner, "Insurance", t.insurance_expiration);
    add("trailer", t.id, owner, "Registration", t.registration_expiration);
  }
  for (const doc of data.docs) {
    const o = names.get(doc.entity_id);
    if (!o || !doc.expires_on) continue;
    add(o.kind, doc.entity_id, o.owner, `${nice(doc.doc_type)} (file)`, doc.expires_on, true);
  }
  return items.sort((a, b) => a.days - b.days);
}

/** Documents every active driver should have on file. Edit this list to match your company. */
export const REQUIRED_DRIVER_DOCS = ["cdl_front", "medical_certificate", "mvr", "clearinghouse"] as const;

export type MissingItem = { key: string; owner: string; what: string };

export function collectMissing(data: { drivers: DriverLike[]; docs: DocLike[] }): MissingItem[] {
  const out: MissingItem[] = [];
  for (const d of data.drivers) {
    if (INACTIVE_DRIVER.includes(d.status ?? "")) continue;
    if (!d.cdl_expiration) out.push({ key: `${d.id}:cdl-date`, owner: d.full_name, what: "CDL expiration date not entered" });
    if (!d.medical_card_expiration) out.push({ key: `${d.id}:med-date`, owner: d.full_name, what: "Medical card expiration not entered" });
    const have = new Set(data.docs.filter((x) => x.entity_type === "driver" && x.entity_id === d.id).map((x) => x.doc_type));
    for (const req of REQUIRED_DRIVER_DOCS) {
      if (!have.has(req)) out.push({ key: `${d.id}:doc:${req}`, owner: d.full_name, what: `No ${nice(req).toLowerCase()} uploaded` });
    }
  }
  return out;
}
