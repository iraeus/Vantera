import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { bootState } from "./boot";

describe("loading screen rules", () => {
  it("works", () => {
    const c = (...st: string[]) => st.map((status, i) => ({ label: `Step ${i}`, status }));
    // nothing loaded yet
    let b = bootState(c("pending", "pending", "pending", "pending"), false, false);
    assert.equal(b.progress, 0); assert.equal(b.ready, false); assert.equal(b.label, "Step 0");
    // half loaded
    b = bootState(c("success", "success", "pending", "pending"), true, false);
    assert.equal(b.progress, 0.5); assert.equal(b.ready, false); assert.equal(b.label, "Step 2");
    // all loaded but under the minimum time -> still showing
    b = bootState(c("success", "success", "success", "success"), false, false);
    assert.equal(b.progress, 1); assert.equal(b.ready, false);
    b = bootState(c("success", "success", "success", "success"), true, false);
    assert.equal(b.ready, true); assert.equal(b.label, "Almost ready…");
    // a failed page query does not block the app
    b = bootState(c("success", "error", "success", "success"), true, false);
    assert.equal(b.ready, true); assert.equal(b.accountError, false);
    // slow loading: after the timeout the app is shown anyway
    b = bootState(c("success", "pending", "pending", "pending"), true, true);
    assert.equal(b.ready, true);
    // the account failing never lets the app through, even after the timeout
    b = bootState(c("error", "success", "success", "success"), true, true);
    assert.equal(b.ready, false); assert.equal(b.accountError, true);
    assert.equal(bootState([], true, false).ready, true);
    console.log("BOOT OK");

  });
});
