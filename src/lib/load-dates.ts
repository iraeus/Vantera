/** Date to use for load filtering and gross reporting, in the user's local timezone. */
export type EndDatedLoad = {
  delivery_departed_at?: string | null;
  delivered_at?: string | null;
  delivery_date?: string | null;
  pickup_date?: string | null;
  created_at: string;
};

export function loadEndDateKey(load: EndDatedLoad) {
  const value =
    load.delivery_departed_at ??
    load.delivered_at ??
    load.delivery_date ??
    load.pickup_date ??
    load.created_at;
  if (value.length === 10) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
