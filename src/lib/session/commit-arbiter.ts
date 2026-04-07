export type TranscriptCommitState = "PENDING" | "COMMITTED";

export type CommitArbiterTranscript = {
  id?: string;
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
  segmentIndex: number;
  isFinal?: boolean | null;
};

export function deriveTranscriptCommitState(
  transcript: Pick<CommitArbiterTranscript, "isFinal">,
): TranscriptCommitState {
  return transcript.isFinal === false ? "PENDING" : "COMMITTED";
}

export function isCommittedTranscript(
  transcript: Pick<CommitArbiterTranscript, "isFinal">,
): boolean {
  return deriveTranscriptCommitState(transcript) === "COMMITTED";
}

export function getCommittedTranscriptSegments<T extends Pick<CommitArbiterTranscript, "isFinal">>(
  transcripts: T[],
): T[] {
  return transcripts.filter((transcript) => isCommittedTranscript(transcript));
}

export function decorateTranscriptForRead<T extends CommitArbiterTranscript>(
  transcript: T,
  extras?: {
    correctionOfId?: string | null;
    transcriptVersion?: number;
  },
) {
  return {
    ...transcript,
    commitState: deriveTranscriptCommitState(transcript),
    correctionOfId: extras?.correctionOfId ?? null,
    transcriptVersion: extras?.transcriptVersion ?? 1,
  };
}
