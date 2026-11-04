import { describe, expect, it } from "vitest";
import { assertDateRange, rangesOverlap, todayUtc } from "@/convex/lib/dates";

describe("loan date rules", () => {
  it("detects inclusive overlap", () => {
    expect(rangesOverlap("2026-11-01", "2026-11-03", "2026-11-03", "2026-11-05")).toBe(true);
    expect(rangesOverlap("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05")).toBe(false);
  });

  it("rejects inverted and malformed ranges", () => {
    expect(() => assertDateRange("2026-11-03", "2026-11-01")).toThrow();
    expect(() => assertDateRange("tomorrow", "2026-11-01")).toThrow();
  });

  it("uses a stable UTC date for scheduled work", () => {
    expect(todayUtc(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10-31");
  });
});
