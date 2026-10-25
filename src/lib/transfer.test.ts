import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as X from "./transfer";

describe("transferring board and adding drivers by name", () => {
  it("works", () => {
    const step = (id: string, label: string, n: number, active = true): X.TStep => ({ id, key: id, label, sort_order: n, is_active: active });
    const opt = (id: string, step_id: string, label: string, n: number, o: Partial<X.TOption> = {}): X.TOption => ({ id, step_id, label, tone: "neutral", is_done: false, is_default: false, asks_details: false, sort_order: n, ...o });
    const steps = [step("eld", "ELD", 1), step("st", "Stickers", 2), step("ls", "Lease", 3), step("old", "Old", 4, false)];
    const options = [
      opt("eld0", "eld", "Not completed", 1, { is_default: true }), opt("eld1", "eld", "Done", 2, { is_done: true, tone: "good" }),
      opt("st0", "st", "Not started", 1, { is_default: true }), opt("st1", "st", "Ordered", 2, { asks_details: true }), opt("st2", "st", "Done", 3, { is_done: true }),
      opt("ls0", "ls", "Not started", 1, { is_default: true }), opt("ls1", "ls", "Done", 2, { is_done: true }),
      opt("old0", "old", "No", 1, { is_default: true }),
    ];
    const row = (id: string, name: string, o: Partial<X.TRow> = {}): X.TRow => ({ id, driver_id: null, driver_name: name, truck_label: null, notes: null, due_date: null, is_archived: false, created_at: "2026-10-01T00:00:00Z", driver_phone: null, driver_email: null, sticker_shop_id: null, sticker_shop_name: null, sticker_email: null, sticker_location: null, sticker_phone: null, sticker_ordered_on: null, sticker_note: null, sticker_ordered_by: null, ...o });
    const rows = [row("r1", "John Smith", { truck_label: "214", due_date: "2026-10-05" }), row("r2", "Mike Ross"), row("r3", "Anna Kim", { notes: "waiting for stickers" })];
    const prog = (r: string, s: string, o: string): X.TProgress => ({ row_id: r, step_id: s, option_id: o, updated_by: null, updated_at: "" });
    const idx = X.progressIndex([prog("r1", "eld", "eld1"), prog("r1", "st", "st2"), prog("r1", "ls", "ls1"),   // r1 all done
                                 prog("r2", "eld", "eld1"), prog("r2", "st", "st1"),                           // r2 partly, stickers ordered
                                 prog("r3", "eld", "eld1"), prog("r3", "st", "st2"), prog("r3", "ls", "ls1")]);   // r3 all done
    // defaults and choices
    assert.equal(X.defaultOption(options, "st")?.label, "Not started");
    assert.equal(X.chosen("r2", "ls", options, idx)?.label, "Not started");   // no choice yet -> default
    assert.equal(X.chosen("r2", "st", options, idx)?.asks_details, true);
    // a stale option id from another step is ignored
    assert.equal(X.chosen("r2", "ls", options, X.progressIndex([prog("r2", "ls", "eld1")]))?.label, "Not started");
    // finished: inactive steps are ignored
    assert.equal(X.isFinished("r1", steps, options, idx), true);
    assert.equal(X.isFinished("r2", steps, options, idx), false);
    assert.equal(X.isFinished("r1", [], options, idx), false);
    // summary
    const s = X.summarize(rows, steps, options, idx, "2026-10-10");
    assert.equal(s.total, 3); assert.equal(s.finished, 2); assert.equal(s.open, 1); assert.equal(s.overdue, 0);
    assert.equal(s.steps.length, 3);
    assert.equal(s.steps[1]!.done, 2);                                 // stickers: r1 + r3 done
    assert.equal(s.steps[1]!.byOption.find((b) => b.option.id === "st1")!.count, 1);
    const s2 = X.summarize([row("r9", "Late", { due_date: "2026-10-01" })], steps, options, idx, "2026-10-10");
    assert.equal(s2.overdue, 1);
    // filters
    const f0: X.Filters = { q: "", status: "all", steps: {} };
    assert.equal(X.applyFilters(rows, f0, steps, options, idx, "2026-10-10").length, 3);
    assert.deepEqual(X.applyFilters(rows, { ...f0, status: "finished" }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r1", "r3"]);
    assert.deepEqual(X.applyFilters(rows, { ...f0, status: "open" }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r2"]);
    assert.deepEqual(X.applyFilters(rows, { ...f0, steps: { st: "st1" } }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r2"]);
    assert.deepEqual(X.applyFilters(rows, { ...f0, steps: { ls: "ls0" } }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r2"]);  // default counts
    assert.deepEqual(X.applyFilters(rows, { ...f0, q: "214" }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r1"]);
    assert.deepEqual(X.applyFilters(rows, { ...f0, q: "stickers" }, steps, options, idx, "2026-10-10").map((r) => r.id), ["r3"]);
    assert.deepEqual(X.applyFilters(rows, { ...f0, status: "overdue" }, steps, options, idx, "2026-10-10").map((r) => r.id), []);   // r1 is finished
    // templates
    const r = row("r4", "Sam Lee", { truck_label: "88", sticker_shop_name: "Print Pro", sticker_phone: "(555) 123-4567", sticker_location: "12 Main St, Dallas, TX" });
    const v = X.templateVars(r);
    assert.equal(X.fillTemplate("Hi {driver_name}, pick up at {shop_name}, {shop_address}. Call {shop_phone}. By {due_date}.", v), "Hi Sam Lee, pick up at Print Pro, 12 Main St, Dallas, TX. Call (555) 123-4567. By {due_date}.");
    assert.deepEqual(X.missingPlaceholders("{driver_name} {due_date} {shop_email}", v).sort(), ["due_date", "shop_email"]);
    assert.equal(X.telUrl("(555) 123-4567"), "tel:5551234567");
    assert.equal(X.telUrl("+1 555 123"), "tel:+1555123");
    assert.ok(X.smsUrl("555 1", "hi there").startsWith("sms:5551?&body=hi%20there"));
    assert.ok(X.mailtoUrl("a@b.com", "Subj", "Body x").includes("subject=Subj&body=Body%20x"));
    assert.ok(X.mapsUrl("12 Main St, Dallas").includes("query=12%20Main%20St%2C%20Dallas"));
    assert.equal(X.safeFileName("My Lease (final) v2.pdf"), "My_Lease_final_v2.pdf");
    assert.equal(X.formatBytes(2048), "2 KB"); assert.equal(X.formatBytes(5 * 1024 * 1024), "5.0 MB");
    console.log("TRANSFER OK");
    // ---- adding drivers by name
    assert.deepEqual(X.parseNames("John Smith\nMike  Ross\n\n  Anna Kim  "), ["John Smith", "Mike Ross", "Anna Kim"]);
    assert.deepEqual(X.parseNames("John Smith, Mike Ross; john smith"), ["John Smith", "Mike Ross"]);
    assert.deepEqual(X.parseNames("1. John Smith\n2) Mike Ross\n- Anna Kim"), ["John Smith", "Mike Ross", "Anna Kim"]);
    assert.deepEqual(X.parseNames("Иван Петров\nАлексей  Сидоров"), ["Иван Петров", "Алексей Сидоров"]);
    assert.deepEqual(X.parseNames("   \n ,, "), []);
    const sp = X.splitNew(["John Smith", "New Guy", "mike  ross"], rows);
    assert.deepEqual(sp.fresh, ["New Guy"]); assert.deepEqual(sp.already, ["John Smith", "mike  ross"]);
    console.log("TRANSFER NAMES OK");

  });
});
