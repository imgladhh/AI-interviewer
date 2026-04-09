export type PersonaUiState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "preview_valid"; normalizedUrl: string; sourceType: string }
  | { kind: "preview_invalid"; message: string }
  | { kind: "creating_persona" }
  | {
      kind: "persona_queued";
      profileId: string;
      jobStatus?: PersonaJobStatus;
    }
  | {
      kind: "persona_processing";
      profileId: string;
      jobStatus?: PersonaJobStatus;
    }
  | {
      kind: "persona_ready";
      profileId: string;
      summary: string;
      fullName?: string | null;
      currentRole?: string | null;
      currentCompany?: string | null;
      technicalFocus?: string[];
      likelyInterviewFocus?: string[];
      jobStatus?: PersonaJobStatus;
    }
  | {
      kind: "persona_failed";
      profileId?: string;
      message: string;
      jobStatus?: PersonaJobStatus;
    }
  | { kind: "session_creating" }
  | { kind: "session_failed"; message: string };

export type PersonaJobStatus = {
  id: string;
  state:
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "delayed"
    | "waiting-children"
    | "unknown";
  attemptsMade: number;
  attemptsAllowed: number;
  failedReason?: string | null;
  progress?: number | null;
  enqueuedAt?: number | null;
  processedAt?: number | null;
  finishedAt?: number | null;
};

export type SetupFormState = {
  mode: "CODING" | "SYSTEM_DESIGN";
  targetLevel: "NEW_GRAD" | "SDE1" | "SDE2" | "SENIOR" | "STAFF";
  selectedLanguage: string;
  companyStyle: "GENERIC" | "AMAZON" | "META" | "GOOGLE" | "STRIPE";
  voiceEnabled: boolean;
  lowCostMode: boolean;
  interviewerProfileUrl: string;
};
