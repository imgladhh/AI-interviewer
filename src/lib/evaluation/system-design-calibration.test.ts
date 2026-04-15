import { describe, expect, it } from "vitest";
import {
  SYSTEM_DESIGN_CALIBRATION_PACK,
  evaluateSystemDesignCalibrationPack,
  summarizeSystemDesignCalibrationPack,
} from "@/lib/evaluation/system-design-calibration";

describe("system design calibration pack", () => {
  it("provides a usable baseline pack for calibration runs", () => {
    expect(SYSTEM_DESIGN_CALIBRATION_PACK.length).toBeGreaterThanOrEqual(50);
  });

  it("keeps level-stratified coverage so calibration does not collapse to a single band", () => {
    const summary = summarizeSystemDesignCalibrationPack();
    expect(summary.byLevel["Mid-level"]).toBeGreaterThanOrEqual(15);
    expect(summary.byLevel.Senior).toBeGreaterThanOrEqual(15);
    expect(summary.byLevel.Staff).toBeGreaterThanOrEqual(15);
    expect(summary.byHire.NO_HIRE).toBeGreaterThan(0);
    expect(summary.byHire.STRONG_HIRE).toBeGreaterThan(0);
  });

  it("returns level agreement metrics with non-linear caps applied", () => {
    const result = evaluateSystemDesignCalibrationPack();
    expect(result.total).toBeGreaterThan(0);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
    expect(result.perSample.length).toBe(result.total);
  });
});
