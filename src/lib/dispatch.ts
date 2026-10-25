/** Dispatch helpers (pure functions). */

export type Place = { city: string; state: string };

/** "Dallas, TX" / "Dallas TX" / "Dallas, TX 75201" -> { city: "dallas", state: "TX" } */
export function parsePlace(raw?: string | null): Place | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const st = (parts[1] ?? "").match(/[A-Za-z]{2}/);
    return { city: (parts[0] ?? "").toLowerCase(), state: st ? st[0].toUpperCase() : "" };
  }
  const m = text.match(/^(.*?)\s+([A-Za-z]{2})(?:\s+\d{5})?$/);
  if (m) return { city: (m[1] ?? "").toLowerCase(), state: (m[2] ?? "").toUpperCase() };
  return { city: text.toLowerCase(), state: "" };
}

/** How close two free-text locations look: same city, same state, or unknown. */
export function placeMatch(a?: string | null, b?: string | null): "city" | "state" | null {
  const p = parsePlace(a);
  const q = parsePlace(b);
  if (!p || !q) return null;
  if (p.city && p.city === q.city && (!p.state || !q.state || p.state === q.state)) return "city";
  if (p.state && p.state === q.state) return "state";
  return null;
}

export type DriverScoreInput = {
  /** safetyIssues(driver) */
  issues: string[];
  driverAvailable: boolean;
  truck: { unavailable: boolean; serviceOverdue: boolean; location: string | null } | null;
  pickup: string | null;
};
export type DriverScore = { score: number; good: string[]; warn: string[] };

export function scoreDriver(i: DriverScoreInput): DriverScore {
  const good: string[] = [];
  const warn: string[] = [];
  let score = 0;
  if (i.issues.length) {
    score -= 100;
    warn.push(...i.issues);
  } else {
    score += 30;
    good.push("Documents OK");
  }
  if (i.driverAvailable) {
    score += 20;
    good.push("Available");
  }
  if (i.truck) {
    if (i.truck.unavailable) {
      score -= 50;
      warn.push("truck out of service");
    } else {
      if (i.truck.serviceOverdue) {
        score -= 15;
        warn.push("truck service overdue");
      }
      const m = placeMatch(i.truck.location, i.pickup);
      if (m === "city") {
        score += 30;
        good.push("Truck at pickup city");
      } else if (m === "state") {
        score += 15;
        good.push("Truck in pickup state");
      }
    }
  }
  return { score, good, warn };
}
