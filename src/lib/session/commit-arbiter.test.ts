import { describe, expect, it } from "vitest";
import {
  decorateTranscriptForRead,
  deriveTranscriptCommitState,
  getCommittedTranscriptSegments,
} from "@/lib/session/commit-arbiter";

describe("commit arbiter", () => {
  it("treats non-final transcript segments as pending", () => {
    expect(deriveTranscriptCommitState({ isFinal: false })).toBe("PENDING");
    expect(deriveTranscriptCommitState({ isFinal: true })).toBe("COMMITTED");
    expect(deriveTranscriptCommitState({ isFinal: undefined })).toBe("COMMITTED");
  });

  it("filters assistant decision input down to committed transcripts only", () => {
    const transcripts = [
      { id: "seg-1", speaker: "USER" as const, text: "live partial", segmentIndex: 0, isFinal: false },
      { id: "seg-2", speaker: "USER" as const, text: "final answer", segmentIndex: 1, isFinal: true },
    ];

    expect(getCommittedTranscriptSegments(transcripts)).toEqual([transcripts[1]]);
  });

  it("decorates transcript reads with commit metadata", () => {
    expect(
      decorateTranscriptForRead(
        {
          id: "seg-1",
          speaker: "USER",
          text: "final answer",
          segmentIndex: 0,
          isFinal: true,
        },
        { correctionOfId: "seg-0" },
      ),
    ).toMatchObject({
      commitState: "COMMITTED",
      transcriptVersion: 1,
      correctionOfId: "seg-0",
    });
  });
});
