import { describe, expect, it } from "vitest";
import { parseAmazonLoad } from "./amazon-parse";

describe("parseAmazonLoad", () => {
  const text = `Trip T-112ABCD9X\nSAT3 San Antonio, TX  Oct 6 08:00\nDFW6 Coppell, TX  Oct 7 14:00\n275 mi  $1,250.00  $4.55/mi`;
  const p = parseAmazonLoad(text, 2026);

  it("reads the Amazon load ID", () => expect(p.load_number).toBe("T-112ABCD9X"));
  it("reads pickup and drop facilities in order", () => {
    expect(p.shipper).toBe("SAT3");
    expect(p.consignee).toBe("DFW6");
  });
  it("reads dates", () => {
    expect(p.pickup_date).toBe("2026-10-06");
    expect(p.delivery_date).toBe("2026-10-07");
  });
  it("reads miles and total rate", () => {
    expect(p.miles).toBe("275");
    expect(p.rate).toBe("1250");
  });
});
