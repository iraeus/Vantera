import { describe, it, expect } from "vitest";
import { clockIn, currentOccurrences, nextOccurrence, occurrenceOn, onDutyUserIds, fmt12, addMinutesToTime, type Shift, type ShiftOverride, type ShiftTime } from "./shifts";

const shifts: Shift[] = [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Shift ${n}`, sort_order: n, is_active: true }));
const times: ShiftTime[] = [];
for (let d = 0; d < 7; d++) {
  const we = d === 0 || d === 6;
  times.push({ shift_id: "s1", dow: d, start_time: "08:00:00", end_time: we ? "20:00:00" : "16:00:00", is_off: false });
  times.push({ shift_id: "s2", dow: d, start_time: we ? "20:00:00" : "16:00:00", end_time: we ? "08:00:00" : "00:00:00", is_off: false });
  times.push({ shift_id: "s3", dow: d, start_time: "00:00:00", end_time: "08:00:00", is_off: d === 0 || d === 1 });
}
const cur = (iso: string, ov: ShiftOverride[] = []) => currentOccurrences(shifts, times, ov, clockIn("UTC", new Date(iso))).map((o) => o.shiftId);

describe("shift schedule", () => {
  it("finds the current shift, including overnight and weekend 12-hour shifts", () => {
    expect(cur("2026-10-12T09:00:00Z")).toEqual(["s1"]); // Monday morning
    expect(cur("2026-10-12T17:30:00Z")).toEqual(["s2"]);
    expect(cur("2026-10-13T00:30:00Z")).toEqual(["s3"]);
    expect(cur("2026-10-12T03:00:00Z")).toEqual(["s2"]); // Sunday night shift runs to Monday 8 AM
    expect(cur("2026-10-17T12:00:00Z")).toEqual(["s1"]); // Saturday 8 AM - 8 PM
    expect(cur("2026-10-18T05:00:00Z")).toEqual(["s2"]);
  });
  it("covers every half hour of the week with exactly one shift", () => {
    for (let m = 0; m < 7 * 24 * 60; m += 30) {
      const d = new Date(Date.UTC(2026, 9, 12) + m * 60000);
      expect(currentOccurrences(shifts, times, [], clockIn("UTC", d))).toHaveLength(1);
    }
  });
  it("one-off changes win over the weekly pattern", () => {
    const ov: ShiftOverride[] = [{ id: "o", shift_id: "s1", on_date: "2026-10-12", start_time: "10:00:00", end_time: "18:00:00", is_off: false, note: null }];
    expect(occurrenceOn("s1", "2026-10-12", times, ov)?.end).toBe("18:00");
    const off: ShiftOverride[] = [{ id: "o", shift_id: "s1", on_date: "2026-10-12", start_time: null, end_time: null, is_off: true, note: null }];
    expect(occurrenceOn("s1", "2026-10-12", times, off)).toBeNull();
  });
  it("reads times in the company timezone", () => {
    const c = clockIn("America/New_York", new Date("2026-10-12T21:00:00Z"));
    expect(currentOccurrences(shifts, times, [], c).map((o) => o.shiftId)).toEqual(["s2"]);
  });
  it("finds the next shift and who is on duty", () => {
    expect(nextOccurrence(shifts, times, [], clockIn("UTC", new Date("2026-10-12T09:00:00Z")))?.shiftId).toBe("s2");
    const members = [{ user_id: "u1", shift_id: "s1" }, { user_id: "u2", shift_id: "s1" }];
    const covers = [{ id: "c", shift_id: "s2", user_id: "u2", on_date: "2026-10-12", note: null }];
    expect(onDutyUserIds("s1", "2026-10-12", members, covers)).toEqual(["u1"]);
    expect(onDutyUserIds("s2", "2026-10-12", members, covers)).toEqual(["u2"]);
  });
  it("formats times", () => {
    expect(fmt12("00:00")).toBe("12:00 AM");
    expect(fmt12("16:30:00")).toBe("4:30 PM");
    expect(addMinutesToTime("23:30", 90)).toBe("01:00");
  });
});
