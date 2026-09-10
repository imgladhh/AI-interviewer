import { describe, expect, it } from "vitest";
import { exitCodeForMonitoringSnapshot } from "@/scripts/check-system-design-alerts";

const snapshot = (overrides: Record<string, unknown> = {}) => ({ availability: "available", freshness: "fresh", quality: "ok", diagnostics: [], ...overrides }) as never;
describe("system design alert checker exit codes", () => {
  it("uses 0, 1, 2, and 3 for success, critical quality, telemetry, and configuration", () => {
    expect(exitCodeForMonitoringSnapshot(snapshot())).toBe(0);
    expect(exitCodeForMonitoringSnapshot(snapshot({ quality: "critical" }))).toBe(1);
    expect(exitCodeForMonitoringSnapshot(snapshot({ availability: "missing", freshness: "unknown", quality: "not_evaluated" }))).toBe(2);
    expect(exitCodeForMonitoringSnapshot(snapshot({ diagnostics: ["invalid SYSTEM_DESIGN_MONITORING_MAX_AGE_HOURS=bad; using 192"] }))).toBe(3);
  });
});
