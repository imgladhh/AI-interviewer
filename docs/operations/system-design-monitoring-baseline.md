# System Design Monitoring & Alert Baseline

This document defines the production baseline for system-design interviewer health.

## Exit codes and operator action

`npm run check:system-design-alerts` returns `0` for fresh non-critical quality, `1` for a quality regression to investigate or roll back, `2` for missing/invalid/unsupported/stale or incomplete telemetry to repair or regenerate, and `3` for a script or configuration error. CI writes the weekly snapshot before checking it.

## Scope

- `calibration` (label agreement on calibration pack)
- `pass-rate` (system-design regression health)
- `drift` (week-over-week movement)
- `stability` (replay variance and expectation flips)

## Primary Data Sources

- [latest.json](/E:/AI%20interviewer/docs/metrics/system-design-weekly/latest.json)
- [latest.json](../metrics/system-design-weekly/latest.json)
- Dated snapshots in `/docs/metrics/system-design-weekly/snapshot-YYYY-MM-DD.json`
- Local checker:
  - `npm run check:system-design-alerts`

## Dashboard Panels

1. Calibration Accuracy (weekly)
- Source: `latest.calibration.accuracy`
- Target: `>= 0.75`

2. Regression Pass Rate (weekly)
- Source: `latest.regression.health.passRate`
- Target: `1.00`

3. Calibration Drift Delta (weekly)
- Source: `snapshot.drift.calibrationAccuracyDelta`
- Target: `>= -0.03`

4. Replay Stability
- Source:
  - `latest.regression.stability.maxScoreVariance`
  - `latest.regression.stability.maxRewardVariance`
  - `latest.regression.stability.expectationFlipCount`
- Target:
  - score variance = `0`
  - reward variance = `0`
  - expectation flips = `0`

## Alert Thresholds

Warning:
- calibration accuracy `< 0.72`
- regression pass rate `< 1.00`
- calibration delta `< -0.03`
- max score variance `> 0`
- max reward variance `> 0`
- expectation flips `> 0`

Critical:
- calibration accuracy `< 0.70`
- regression pass rate `< 0.98`
- calibration delta `< -0.05`
- max score variance `> 0.01`
- max reward variance `> 0.01`
- expectation flips `>= 1`

## Alert Runbook (On-call)

Warning response (same day):
1. Run `npm run eval:system-design`
2. Run `npm run check:system-design-gates`
3. Compare latest vs previous dated snapshot and identify changed dimension(s):
  - calibration only
  - regression only
  - both
4. Open remediation issue with owner and ETA.

Critical response (immediate):
1. Freeze new scoring/decision merges.
2. Re-run full matrix:
  - `npm run check:system-design-gates`
  - `npm run check:system-design-alerts`
  - targeted vitest suites from CI gate workflow
3. If critical persists for two consecutive runs:
  - rollback to previous known good release
  - keep a mitigation note in incident log
4. Open incident ticket with:
  - failing metric
  - regression signature
  - suspected commit range

## Operational Cadence

Daily:
- `npm run check:system-design-alerts`

Release day:
- run both:
  - `npm run check:system-design-gates`
  - `npm run check:system-design-alerts`

Weekly:
- `npm run eval:system-design:weekly`
- review drift deltas and archive outcomes in release notes.

## Ownership

- Primary: interviewer quality owner
- Secondary: release owner (for rollback decisions)
- Escalation: engineering lead if critical state lasts > 24h
