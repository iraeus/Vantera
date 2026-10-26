export type DispatchStatusValue =
  | "ready"
  | "prebook"
  | "covered"
  | "in_transit"
  | "rest_home"
  | "issue"
  | "off_duty"
  | "shop"
  | "no_update";

export type DispatchStatusConfig = {
  value: DispatchStatusValue;
  name: string;
  color: string;
  priority: number;
};

export const DEFAULT_DISPATCH_STATUSES: DispatchStatusConfig[] = [
  { value: "ready", name: "Ready", color: "#ef4444", priority: 1 },
  { value: "prebook", name: "Prebook", color: "#f59e0b", priority: 2 },
  { value: "covered", name: "Covered", color: "#3b82f6", priority: 3 },
  { value: "in_transit", name: "In transit", color: "#06b6d4", priority: 4 },
  { value: "rest_home", name: "Home/rest", color: "#8b5cf6", priority: 5 },
  { value: "issue", name: "Issue", color: "#f97316", priority: 6 },
  { value: "off_duty", name: "Off duty", color: "#64748b", priority: 7 },
  { value: "shop", name: "Shop", color: "#a1a1aa", priority: 8 },
  { value: "no_update", name: "No update", color: "#64748b", priority: 9 },
];

const validValues = new Set<string>(DEFAULT_DISPATCH_STATUSES.map((status) => status.value));
const validColor = /^#[0-9a-f]{6}$/i;

export function readDispatchStatusConfig(raw?: string): DispatchStatusConfig[] {
  let saved: unknown;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }

  const entries = Array.isArray(saved) ? saved : [];
  const byValue = new Map<string, Partial<DispatchStatusConfig>>();
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "value" in entry) {
      const item = entry as Partial<DispatchStatusConfig>;
      if (typeof item.value === "string" && validValues.has(item.value))
        byValue.set(item.value, item);
    }
  }

  return DEFAULT_DISPATCH_STATUSES.map((defaults) => {
    const savedStatus = byValue.get(defaults.value);
    const name = typeof savedStatus?.name === "string" ? savedStatus.name.trim().slice(0, 40) : "";
    const priority = Number(savedStatus?.priority);
    return {
      ...defaults,
      name: name || defaults.name,
      color:
        typeof savedStatus?.color === "string" && validColor.test(savedStatus.color)
          ? savedStatus.color
          : defaults.color,
      priority: Number.isFinite(priority) && priority > 0 ? priority : defaults.priority,
    };
  }).sort(
    (a, b) =>
      a.priority - b.priority ||
      DEFAULT_DISPATCH_STATUSES.findIndex((status) => status.value === a.value) -
        DEFAULT_DISPATCH_STATUSES.findIndex((status) => status.value === b.value),
  );
}

export function dispatchStatusName(
  status: string | null | undefined,
  config: DispatchStatusConfig[],
) {
  return config.find((item) => item.value === status)?.name ?? "No update";
}

export function dispatchStatusColor(
  status: string | null | undefined,
  config: DispatchStatusConfig[],
) {
  return config.find((item) => item.value === status)?.color ?? "#64748b";
}
