import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as I from "./intervals";
import * as D from "./detention";
import * as B from "./billing";
import * as A from "./analytics";
import * as W from "./weekly";
import * as T from "./attention";
import * as M from "./maintenance";
import * as R from "./ranges";
import * as K from "./tasks";

describe("performance logic", () => {
  it("intervals, detention, billing, analytics, weekly summary, alerts and plan rows", () => {

    // ---- intervals
    assert.equal(I.parseIntervals(null)["in_transit"], 4);
    assert.equal(I.parseIntervals('{"in_transit": 2, "bogus": 5, "loading": -1}')["in_transit"], 2);
    assert.equal(I.parseIntervals('{"loading": -1}')["loading"], 1);
    assert.equal(I.parseIntervals("not json")["at_pickup"], 1);
    const now = new Date("2026-10-12T10:00:00Z");
    assert.equal(I.nextUpdateAt("in_transit", I.DEFAULT_UPDATE_HOURS, now), "2026-10-12T14:00:00.000Z");
    assert.equal(I.nextUpdateAt("delivered", I.DEFAULT_UPDATE_HOURS, now), null);
    assert.equal(I.minutesLate("2026-10-12T09:30:00Z", now), 30);
    assert.equal(I.minutesLate("2026-10-12T11:00:00Z", now), 0);
    assert.equal(I.minutesLate(null, now), null);

    // ---- detention (2h free, $60/h)
    const det = D.detentionFor({ pickup_arrived_at: "2026-10-12T08:00:00Z", pickup_departed_at: "2026-10-12T11:10:00Z", delivery_arrived_at: "2026-10-12T20:00:00Z", delivery_departed_at: "2026-10-12T21:30:00Z" }, 2, 60);
    assert.equal(det.pickupHours?.toFixed(2), "3.17"); assert.equal(det.billableHours, 1.25); assert.equal(det.amount, 75);
    assert.equal(D.detentionFor({}, 2, 60).billableHours, 0);
    assert.equal(D.detentionFor({ pickup_arrived_at: "2026-10-12T08:00:00Z", pickup_departed_at: "2026-10-12T12:00:00Z" }, 2, null).amount, null);
    assert.equal(D.fmtHours(3.25), "3h 15m");

    // ---- billing
    const L = (o: Partial<A.ALoad> & { id: string }): A.ALoad => ({ load_number: o.id.toUpperCase(), status: "new", broker_id: "b1", customer_name: null, pickup_location: "Dallas, TX", delivery_location: "Atlanta, GA", delivered_at: null, invoice_number: null, invoice_date: null, paid_date: null, rate: 1000, fuel_surcharge: 0, detention: 0, layover: 0, other_charges: 0, driver_id: "d1", truck_id: "t1", pickup_date: "2026-10-05", delivery_date: "2026-10-07", created_at: "2026-10-01T00:00:00Z", miles: 800, deadhead_miles: 100, driver_pay: 600, is_problem: false, ...o });
    const brokers = [{ id: "b1", name: "Acme Logistics", payment_terms_days: 30 }, { id: "b2", name: "FastPay", payment_terms_days: 15 }];
    const today = new Date(2026, 9, 12, 12, 0);
    const loads: A.ALoad[] = [
      L({ id: "a", status: "delivered", delivered_at: "2026-10-09T12:00:00Z" }),            // POD missing, 3 days
      L({ id: "b", status: "delivered", delivered_at: "2026-10-12T08:00:00Z" }),            // delivered today: not flagged
      L({ id: "c", status: "pod_received", delivered_at: "2026-10-08T12:00:00Z", rate: 2000 }), // to invoice
      L({ id: "d", status: "billing", broker_id: "b2", invoice_date: "2026-09-20", delivered_at: "2026-09-19T12:00:00Z", rate: 1500 }), // due 10-05 -> 7 days overdue
      L({ id: "e", status: "billing", invoice_date: "2026-10-01", delivered_at: "2026-09-30T12:00:00Z" }), // due 10-31, ok
      L({ id: "f", status: "paid", invoice_date: "2026-09-10", paid_date: "2026-10-05", delivered_at: "2026-09-09T12:00:00Z" }),
      L({ id: "g", status: "paid", invoice_date: "2026-09-12", paid_date: "2026-09-27", delivered_at: "2026-09-11T12:00:00Z", broker_id: "b2" }),
      L({ id: "h", status: "cancelled" }),
    ];
    const bk = B.billingBuckets(loads, brokers, today);
    assert.deepEqual(bk.waitingPod.map(r => r.load.id), ["a"]);
    assert.deepEqual(bk.toInvoice.map(r => r.load.id), ["c"]);
    assert.deepEqual(bk.unpaid.map(r => r.load.id), ["d", "e"]);
    assert.deepEqual(bk.overdue.map(r => [r.load.id, r.daysOverdue]), [["d", 7]]);
    assert.equal(B.sumAmount(bk.toInvoice), 2000);
    assert.equal(B.invoiceCsvRows(bk.overdue)[0]!["DueDate"], "2026-10-05");
    assert.equal(B.invoiceCsvRows(bk.overdue)[0]!["Terms"], "Net 15");

    // ---- analytics
    const tz = (iso: string) => iso.slice(0, 10);
    assert.equal(A.deliveredOnTime(L({ id: "x", delivered_at: "2026-10-07T23:00:00Z" }), tz), true);
    assert.equal(A.deliveredOnTime(L({ id: "x", delivered_at: "2026-10-08T01:00:00Z" }), tz), false);
    assert.equal(A.deliveredOnTime(L({ id: "x" }), tz), null);
    const trucks = [{ id: "t1", truck_number: "101" }, { id: "t2", truck_number: "102" }];
    const tp = A.profitByTruck(loads, trucks, [{ truck_id: "t1", fuel_date: "2026-10-06", cost: 500 }], [{ asset_type: "truck", asset_id: "t1", service_date: "2026-10-07", cost: 200 }], "2026-10-01", "2026-10-31");
    assert.equal(tp.length, 1); assert.equal(tp[0]!.loads, 7); // cancelled excluded
    assert.equal(tp[0]!.revenue, 8500);
    assert.equal(tp[0]!.driverPay, 4200);
    assert.equal(tp[0]!.fuel, 500); assert.equal(tp[0]!.maintenance, 200);
    assert.equal(tp[0]!.profit, 8500 - 4200 - 500 - 200);
    assert.equal(tp[0]!.deadheadPct?.toFixed(1), "11.1");

    const ds = A.driverScorecards(loads, [{ id: "d1", full_name: "Ann" }, { id: "d9", full_name: "Idle" }], "2026-10-01", "2026-10-31", tz, (id) => (id === "d1" ? ["CDL expires soon"] : []));
    assert.equal(ds.length, 1); assert.equal(ds[0]!.name, "Ann"); assert.equal(ds[0]!.loads, 7);
    assert.equal(ds[0]!.issues[0], "CDL expires soon");
    console.log("driver on-time:", ds[0]!.onTimeMeasured, ds[0]!.onTimePct);

    const bs = A.brokerScorecards(loads, brokers, "2026-10-01", "2026-10-31", today);
    const acme = bs.find((b) => b.id === "b1")!;
    assert.equal(acme.avgDaysToPay, 25);
    assert.equal(bs.find((b) => b.id === "b2")!.avgDaysToPay, 15);
    assert.equal(bs.find((b) => b.id === "b2")!.overdue, 1500);
    assert.equal(acme.unpaid, 1000);

    const lanes = A.laneAnalysis(loads, "2026-10-01", "2026-10-31");
    assert.equal(lanes.length, 1); assert.equal(lanes[0]!.lane, "Dallas → Atlanta"); assert.equal(lanes[0]!.loads, 7);

    const sh = [{ id: "s1", name: "Shift 1", sort_order: 1 }, { id: "s2", name: "Shift 2", sort_order: 2 }];
    const ev = [
      { shift_id: "s1", late_minutes: 0, created_at: "2026-10-05T10:00:00Z" },
      { shift_id: "s1", late_minutes: 10, created_at: "2026-10-05T11:00:00Z" },
      { shift_id: "s1", late_minutes: 90, created_at: "2026-10-05T12:00:00Z" },
      { shift_id: "s2", late_minutes: 0, created_at: "2026-10-06T22:00:00Z" },
      { shift_id: "s2", late_minutes: null, created_at: "2026-10-06T23:00:00Z" },
      { shift_id: null, late_minutes: 0, created_at: "2026-10-06T23:00:00Z" },
    ];
    const sp = A.shiftPerformance(ev, sh, "2026-10-01", "2026-10-31", tz);
    assert.deepEqual(sp.map((r) => [r.updates, r.late]), [[3, 1], [1, 0]]);
    assert.equal(sp[0]!.pctOnTime?.toFixed(1), "66.7"); assert.equal(sp[0]!.avgLateMin, 90);

    const wk = W.buildWeekly({ loads, brokers, trucks, fuel: [{ truck_id: "t1", fuel_date: "2026-10-08", cost: 500 }], maint: [], events: ev, shifts: sh, expiryDays: [-3, 5, 20, 90], serviceOverdue: 2, from: "2026-10-06", to: "2026-10-12", localDate: tz, today });
    console.log("weekly delivered:", wk.deliveredLoads, "revenue", wk.revenue, "profit", wk.profit);
    assert.equal(wk.expiredItems, 1); assert.equal(wk.expiringSoon, 2);
    assert.equal(wk.toInvoiceCount, 1); assert.equal(wk.overdueCount, 1); assert.equal(wk.overdueAmount, 1500);
    assert.ok(W.weeklyText(wk).includes("Delivered loads:"));

    // ---- attention
    const exp: any[] = [{ key: "k1", kind: "driver", owner: "Ann", what: "CDL", date: "2026-10-10", days: -2, fromDocument: false }, { key: "k2", kind: "truck", owner: "Truck 101", what: "Insurance", date: "2026-10-20", days: 8, fromDocument: false }, { key: "k3", kind: "trailer", owner: "Trailer 9", what: "Registration", date: "2027-01-01", days: 80, fromDocument: false }];
    const att = T.buildAttention({
      loads: [
        { id: "l1", load_number: "L1", status: "in_transit", is_problem: false, driver_id: "d1", pickup_date: "2026-10-01", pickup_location: "A", next_update_at: "2026-10-12T08:00:00Z" },
        { id: "l2", load_number: "L2", status: "booked", is_problem: false, driver_id: null, pickup_date: "2026-10-12", pickup_location: "Dallas, TX", next_update_at: null },
        { id: "l3", load_number: "L3", status: "in_transit", is_problem: true, problem_note: "Breakdown", driver_id: "d1", pickup_date: null, pickup_location: null, next_update_at: "2026-10-12T01:00:00Z" },
        { id: "l4", load_number: "L4", status: "delivered", is_problem: false, driver_id: null, pickup_date: "2026-10-01", pickup_location: null, next_update_at: null },
      ],
      trucks: [{ id: "t1", truck_number: "101", status: "in_shop", notes: "Brakes" }],
      plans: [{ plan: { id: "p1", name: "Oil" }, label: "Truck 101", status: { state: "overdue", text: "5 d overdue" } }, { plan: { id: "p2", name: "PM" }, label: "Truck 102", status: { state: "ok", text: "" } }],
      expiries: exp, billing: bk,
    }, new Date("2026-10-12T10:00:00Z"));
    const tags = att.map((a) => a.tag);
    assert.ok(tags.includes("PROBLEM") && tags.includes("UPDATE LATE") && tags.includes("NO DRIVER") && tags.includes("EXPIRED") && tags.includes("EXPIRING"));
    assert.ok(tags.includes("SERVICE OVERDUE") && tags.includes("IN SHOP") && tags.includes("READY TO INVOICE") && tags.includes("PAYMENT OVERDUE") && tags.includes("POD MISSING"));
    assert.ok(!att.some((a) => a.text.includes("Trailer 9")));       // 80 days away: not alerted
    assert.ok(!att.some((a) => a.key === "late:l3"));                // problem loads are not double-listed as late
    assert.ok(!att.some((a) => a.text.startsWith("L4")));            // delivered load is not "no driver"
    assert.deepEqual(T.catsForRoles(["accounting"]), ["billing"]);
    assert.deepEqual(T.catsForRoles(["viewer"]), []);
    assert.equal(T.catsForRoles(["supervisor"]).length, 4);
    assert.equal(T.fmtAgo(130), "2h 10m");

    // ---- plan rows
    const rows = M.buildPlanRows({
      plans: [{ id: "p1", asset_type: "truck", asset_id: "t1", name: "Oil", interval_miles: 20000, interval_days: null, last_service_date: null, last_service_miles: 80000, notes: null },
              { id: "p2", asset_type: "truck", asset_id: "tX", name: "Gone", interval_miles: 1, interval_days: null, last_service_date: null, last_service_miles: 1, notes: null }],
      trucks: [{ id: "t1", status: "available", mileage: 95000, truck_number: "101" }], trailers: [],
      records: [{ asset_type: "truck", asset_id: "t1", odometer: 101000 }], fuel: [{ truck_id: "t1", odometer: 99000 }],
    }, today);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.miles, 101000); assert.equal(rows[0]!.status.state, "overdue"); // due at 100,000 mi, truck is at 101,000

  });

  it("date ranges", () => {
    assert.deepEqual(R.rangeFor("7d", "2026-10-12"), { from: "2026-10-06", to: "2026-10-12" });
    assert.deepEqual(R.rangeFor("lastmonth", "2026-01-05"), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(R.rangeFor("qtd", "2026-08-12"), { from: "2026-07-01", to: "2026-08-12" });
    assert.deepEqual(R.lastFullWeek("2026-10-14"), { from: "2026-10-05", to: "2026-10-11" });
  });
  it("dispatch tasks", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const t = (o: Partial<K.Task>): K.Task => ({ id: "t", title: "x", details: null, load_id: null, assigned_to: "u", created_by: "c", priority: "normal", due_at: null, status: "new", received_at: null, started_at: null, done_at: null, done_note: null, created_at: "2026-10-12T09:00:00Z", ...o });
    assert.equal(K.isOverdue(t({ due_at: "2026-10-12T09:30:00Z" }), now), true);
    assert.equal(K.isOverdue(t({ due_at: "2026-10-12T09:30:00Z", status: "done" }), now), false);
    assert.equal(K.isUnreceived(t({}), now), true);
    assert.equal(K.isUnreceived(t({ created_at: "2026-10-12T09:55:00Z" }), now), false);
    assert.deepEqual(K.sortOpen([t({ id: "a" }), t({ id: "b", priority: "urgent" })]).map((x) => x.id), ["b", "a"]);
    assert.equal(K.nextStatus("on_it"), "done");
    assert.deepEqual(K.TASK_STEPS.map((x) => x.text), ["Received", "On it", "Done"]);
    const att = T.buildAttention(
      { loads: [], trucks: [], plans: [], expiries: [], billing: { waitingPod: [], toInvoice: [], unpaid: [], overdue: [], paidRecent: [] },
        tasks: [{ id: "1", title: "Check call", status: "new", priority: "urgent", due_at: null, created_at: "2026-10-12T09:00:00Z", assignee: "Ann" },
                { id: "2", title: "Upload POD", status: "on_it", priority: "normal", due_at: "2026-10-12T09:00:00Z", created_at: "2026-10-12T08:00:00Z", assignee: "Bob" },
                { id: "3", title: "Fresh", status: "new", priority: "normal", due_at: null, created_at: "2026-10-12T09:58:00Z", assignee: "Cy" }] },
      now,
    );
    assert.deepEqual(att.map((a) => a.tag).sort(), ["TASK NOT RECEIVED", "TASK OVERDUE"]);
  });
});
