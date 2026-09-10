import { readSystemDesignMonitoringSnapshot } from "@/lib/operations/system-design-monitoring";

export function exitCodeForMonitoringSnapshot(snapshot: Awaited<ReturnType<typeof readSystemDesignMonitoringSnapshot>>) {
  if (snapshot.diagnostics.some((diagnostic) => diagnostic.startsWith("invalid SYSTEM_DESIGN_MONITORING_MAX_AGE_HOURS"))) return 3;
  if (snapshot.availability !== "available" || snapshot.freshness !== "fresh" || snapshot.quality === "not_evaluated") return 2;
  if (snapshot.quality === "critical") return 1;
  return 0;
}

async function main() {
  const snapshot = await readSystemDesignMonitoringSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
  process.exitCode = exitCodeForMonitoringSnapshot(snapshot);
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 3;
  });
}
