const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isFeatureEnabled(name: string): boolean {
  return ENABLED_VALUES.has(process.env[name]?.trim().toLowerCase() ?? "");
}

export const isCodeRunEnabled = () => isFeatureEnabled("ENABLE_CODE_RUNS");
export const isHostCodeExecutionEnabled = () => isFeatureEnabled("ENABLE_HOST_CODE_EXECUTION");
export const isPersonaIngestionEnabled = () => isFeatureEnabled("ENABLE_PERSONA_INGESTION");
