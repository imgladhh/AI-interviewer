import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSystemDesignMonitoringSnapshot } from "@/lib/operations/system-design-monitoring";

const now = new Date("2026-09-09T12:00:00.000Z");
const envelope = (generatedAt = "2026-09-09T10:00:00.000Z") => ({ schemaVersion: 1, generatedAt, calibration: { total: 10, matched: 8, accuracy: 0.8 }, regression: { health: { passRate: 1 }, stability: { maxScoreVariance: 0, maxRewardVariance: 0, expectationFlipCount: 0 } } });
async function fixture(latest: unknown, dated: unknown = { snapshot: envelope(), drift: { calibrationAccuracyDelta: 0 } }) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "monitoring-"));
  const dir = path.join(cwd, "docs", "metrics", "system-design-weekly");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "latest.json"), JSON.stringify(latest));
  await writeFile(path.join(dir, "snapshot-2026-09-09.json"), JSON.stringify(dated));
  return cwd;
}
describe("system design monitoring envelope", () => {
  it("distinguishes fresh quality from invalid, unsupported, stale, and unavailable drift", async () => {
    await expect(readSystemDesignMonitoringSnapshot(await fixture(envelope()), now)).resolves.toMatchObject({ availability: "available", freshness: "fresh", quality: "ok" });
    await expect(readSystemDesignMonitoringSnapshot(await fixture({ generatedAt: now.toISOString() }), now)).resolves.toMatchObject({ availability: "invalid", quality: "not_evaluated" });
    await expect(readSystemDesignMonitoringSnapshot(await fixture({ ...envelope(), schemaVersion: 2 }), now)).resolves.toMatchObject({ availability: "unsupported_version" });
    await expect(readSystemDesignMonitoringSnapshot(await fixture(envelope("2026-08-20T00:00:00.000Z")), now)).resolves.toMatchObject({ availability: "available", freshness: "stale", quality: "not_evaluated" });
    await expect(readSystemDesignMonitoringSnapshot(await fixture(envelope(), {}), now)).resolves.toMatchObject({ availability: "available", freshness: "fresh", quality: "not_evaluated" });
  });
});
