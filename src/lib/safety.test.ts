import { describe, it, expect } from "vitest";
import { safetyIssues } from "./tms";
const today = new Date("2026-10-09T12:00:00Z");
describe("safetyIssues", () => {
  it("clears a driver with valid CDL and medical", () => {
    expect(safetyIssues({ status: "available", cdl_expiration: "2027-01-01", medical_card_expiration: "2027-01-01" }, today)).toEqual([]);
  });
  it("blocks expired CDL", () => {
    expect(safetyIssues({ status: "available", cdl_expiration: "2026-10-01", medical_card_expiration: "2027-01-01" }, today)).toContain("CDL expired");
  });
  it("blocks missing medical card", () => {
    expect(safetyIssues({ status: "available", cdl_expiration: "2027-01-01", medical_card_expiration: null }, today)).toContain("no medical card");
  });
  it("blocks inactive drivers", () => {
    expect(safetyIssues({ status: "inactive", cdl_expiration: "2027-01-01", medical_card_expiration: "2027-01-01" }, today).length).toBe(1);
  });
});
