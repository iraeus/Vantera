import { facilityMiles, findFacility, isAmazonLoadId } from "./amazon-facilities";

export type ParsedAmazonLoad = {
  load_number: string;
  shipper: string;
  consignee: string;
  pickup_date: string;
  delivery_date: string;
  miles: string;
  rate: string;
  equipment_type: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDates(text: string, year: number): string[] {
  const found: { at: number; v: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const v = iso(+m[1]!, +m[2]!, +m[3]!);
    if (v) found.push({ at: m.index!, v });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3]! : +m[3]!) : year;
    const v = iso(y, +m[1]!, +m[2]!);
    if (v) found.push({ at: m.index!, v });
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/g)) {
    const mi = MONTHS.indexOf(m[1]!.toLowerCase());
    if (mi < 0) continue;
    const v = iso(m[3] ? +m[3]! : year, mi + 1, +m[2]!);
    if (v) found.push({ at: m.index!, v });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.v);
}

/** Pull load ID, facilities, dates, miles, rate and equipment out of text copied from Amazon Relay. */
export function parseAmazonLoad(text: string, year = new Date().getFullYear()): ParsedAmazonLoad {
  const upper = text.toUpperCase();
  const tokens = upper.match(/[A-Z0-9-]+/g) ?? [];

  const load_number = tokens.find((t) => isAmazonLoadId(t) && !/^\d+$/.test(t)) ?? "";

  const facilities: string[] = [];
  for (const t of tokens) {
    if (/^[A-Z]{3}\d{1,2}$/.test(t) && findFacility(t) && facilities[facilities.length - 1] !== t)
      facilities.push(t);
  }
  const shipper = facilities[0] ?? "";
  const consignee = facilities[1] ?? "";

  const dates = findDates(text, year);

  let miles = "";
  const mm = text.match(/([\d,]+(?:\.\d+)?)\s*(?:mi\b|miles\b)/i);
  if (mm) miles = String(Math.round(Number(mm[1]!.replace(/,/g, ""))));
  else if (shipper && consignee) {
    const d = facilityMiles(findFacility(shipper)!, findFacility(consignee)!);
    if (d != null) miles = String(d);
  }

  let rate = "";
  const rates = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)(?!\s*\/\s*mi)/gi)]
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => n > 0);
  if (rates.length) rate = String(Math.max(...rates));

  let equipment_type = "Dry van";
  if (/reefer/i.test(text)) equipment_type = "Reefer";
  else if (/53/.test(text) && /trailer|van/i.test(text)) equipment_type = "53' Dry van";

  return {
    load_number,
    shipper,
    consignee,
    pickup_date: dates[0] ?? "",
    delivery_date: dates[1] ?? dates[0] ?? "",
    miles,
    rate,
    equipment_type,
  };
}
