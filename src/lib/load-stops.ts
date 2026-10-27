export const MAX_LOAD_STOPS = 10;
export const DEFAULT_STOP_TIMEZONE = "America/New_York";

export type LoadStopType = "pickup" | "delivery" | "intermediate";

export type LoadStop = {
  id: string;
  sequence_number: number;
  stop_type: LoadStopType;
  facility_name: string;
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  appointment_date: string;
  appointment_time: string;
  timezone: string;
  appointment_number: string;
  bol_number: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  instructions: string;
  status: string;
};

export function easternDateToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_STOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function createLoadStop(
  stopType: LoadStopType,
  sequenceNumber: number,
  appointmentDate = "",
): LoadStop {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `stop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sequence_number: sequenceNumber,
    stop_type: stopType,
    facility_name: "",
    street_address: "",
    city: "",
    state: "",
    postal_code: "",
    country: "United States",
    appointment_date: appointmentDate,
    appointment_time: "",
    timezone: DEFAULT_STOP_TIMEZONE,
    appointment_number: "",
    bol_number: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    instructions: "",
    status: "scheduled",
  };
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizeLoadStops(value: unknown): LoadStop[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, index) => {
      const rawType = asString(item.stop_type);
      const stopType: LoadStopType =
        rawType === "pickup" || rawType === "delivery" ? rawType : "intermediate";
      const stop = createLoadStop(stopType, index + 1);
      return {
        ...stop,
        ...Object.fromEntries(
          Object.keys(stop).map((key) => [key, key === "sequence_number" ? index + 1 : asString(item[key])]),
        ),
        id: asString(item.id) || stop.id,
        sequence_number: index + 1,
        stop_type: stopType,
        country: asString(item.country) || "United States",
        timezone: asString(item.timezone) || DEFAULT_STOP_TIMEZONE,
        status: asString(item.status) || "scheduled",
      } as LoadStop;
    });
}

export function initialLoadStops(
  savedStops: unknown,
  legacy: {
    shipper?: string | null;
    pickup_address?: string | null;
    pickup_location?: string | null;
    pickup_date?: string | null;
    pickup_time?: string | null;
    consignee?: string | null;
    delivery_address?: string | null;
    delivery_location?: string | null;
    delivery_date?: string | null;
    delivery_time?: string | null;
  },
  defaultDate: string,
) {
  const saved = normalizeLoadStops(savedStops);
  if (saved.length) return saved;

  const pickup = createLoadStop("pickup", 1, legacy.pickup_date || defaultDate);
  pickup.facility_name = legacy.shipper ?? "";
  pickup.street_address = legacy.pickup_address ?? "";
  pickup.city = legacy.pickup_location ?? "";
  pickup.appointment_time = legacy.pickup_time ?? "";

  const delivery = createLoadStop("delivery", 2, legacy.delivery_date || defaultDate);
  delivery.facility_name = legacy.consignee ?? "";
  delivery.street_address = legacy.delivery_address ?? "";
  delivery.city = legacy.delivery_location ?? "";
  delivery.appointment_time = legacy.delivery_time ?? "";
  return [pickup, delivery];
}
