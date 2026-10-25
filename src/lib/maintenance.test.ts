import { describe, it, expect } from "vitest";
import { planStatus, assetMiles, type MaintenancePlan } from "./maintenance";
import { collectExpiries, collectMissing } from "./alerts";
import { placeMatch, scoreDriver } from "./dispatch";

const today = new Date(2026, 9, 9, 12, 0);
const base: MaintenancePlan = { id: "p", asset_type: "truck", asset_id: "t", name: "Oil", interval_miles: 20000, interval_days: 180, last_service_date: null, last_service_miles: null, notes: null };

describe("maintenance plans", () => {
  it("needs a baseline first", () => expect(planStatus(base, 100000, today).state).toBe("no_baseline"));
  it("tracks miles", () => {
    expect(planStatus({ ...base, last_service_miles: 90000 }, 100000, today).state).toBe("ok");
    expect(planStatus({ ...base, last_service_miles: 81000 }, 100000, today).state).toBe("due_soon");
    expect(planStatus({ ...base, last_service_miles: 79000 }, 100000, today).state).toBe("overdue");
  });
  it("tracks days", () => {
    const p = { ...base, interval_miles: null };
    expect(planStatus({ ...p, last_service_date: "2026-07-01" }, null, today).state).toBe("ok");
    expect(planStatus({ ...p, last_service_date: "2026-04-20" }, null, today).state).toBe("due_soon");
    expect(planStatus({ ...p, last_service_date: "2026-04-01" }, null, today).daysLeft).toBe(-11);
  });
  it("picks the best known mileage", () => expect(assetMiles(null, [null, 12000, 9000])).toBe(12000));
});

describe("expiry alerts", () => {
  it("lists expiring items soonest first and ignores inactive drivers", () => {
    const drivers = [
      { id: "d1", full_name: "Ann", status: "available", cdl_expiration: "2026-10-05", medical_card_expiration: "2026-11-01" },
      { id: "d2", full_name: "Bob", status: "inactive", cdl_expiration: "2020-01-01", medical_card_expiration: null },
    ];
    const items = collectExpiries({ drivers, trucks: [], trailers: [], docs: [] }, today);
    expect(items.map((i) => [i.owner, i.what, i.days])).toEqual([["Ann", "CDL", -4], ["Ann", "Medical card", 23]]);
    expect(collectMissing({ drivers, docs: [] }).every((m) => m.owner === "Ann")).toBe(true);
  });
});

describe("dispatch helpers", () => {
  it("matches locations", () => {
    expect(placeMatch("Dallas, TX", "dallas, tx")).toBe("city");
    expect(placeMatch("Austin, TX", "Dallas, TX")).toBe("state");
    expect(placeMatch("Austin, TX", "Chicago, IL")).toBeNull();
  });
  it("ranks a cleared driver near the pickup above one with an expired CDL", () => {
    const good = scoreDriver({ issues: [], driverAvailable: true, truck: { unavailable: false, serviceOverdue: false, location: "Dallas, TX" }, pickup: "Dallas, TX" });
    const bad = scoreDriver({ issues: ["CDL expired"], driverAvailable: true, truck: null, pickup: "Dallas, TX" });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(bad.warn).toContain("CDL expired");
  });
});
