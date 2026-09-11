import { describe, expect, it, vi } from "vitest";
import { adjudicateCandidateSignals, appendTurnAssessment, latestAdjudicatedSignals } from "@/lib/assistant/turn-assessment";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import { assessConversationHealth } from "@/lib/assistant/conversation_health";

const heuristic: CandidateSignalSnapshot = {
  understanding: "partial", progress: "progressing", communication: "clear", codeQuality: "partial",
  algorithmChoice: "reasonable", edgeCaseAwareness: "partial", behavior: "structured", readyToCode: false,
  reasoningDepth: "moderate", testingDiscipline: "partial", complexityRigor: "partial", confidence: 0.7,
  evidence: ["heuristic"], structuredEvidence: [], summary: "heuristic", source: "heuristic",
};

describe("turn assessment adjudication and replay", () => {
  it("deterministically adjudicates provider conflicts and falls back on invalid/missing provider", () => {
    const provider = { ...heuristic, progress: "stuck" as const, summary: "provider", source: "gemini-observer" as const };
    expect(adjudicateCandidateSignals({ heuristic, provider }).adjudicated).toBe(provider);
    expect(adjudicateCandidateSignals({ heuristic, provider: null, providerFailure: "invalid_json" })).toMatchObject({
      status: "HEURISTIC_FALLBACK", adjudicated: heuristic, fallbackReason: "invalid_json",
    });
  });

  it("replay is stable, ignores duplicate events, and selects the highest assessment version", () => {
    const v1 = { eventType: "TURN_ASSESSMENT_RECORDED", payloadJson: { candidateTurnId: "u1", assessmentVersion: 1, adjudicated: heuristic } };
    const v2Signals = { ...heuristic, progress: "done" as const };
    const v2 = { eventType: "TURN_ASSESSMENT_RECORDED", payloadJson: { candidateTurnId: "u1", assessmentVersion: 2, adjudicated: v2Signals } };
    const stream = [v1, v1, v2];
    expect(latestAdjudicatedSignals(stream)).toEqual(latestAdjudicatedSignals(stream));
    expect(latestAdjudicatedSignals(stream)).toEqual([{ candidateTurnId: "u1", assessmentVersion: 2, signals: v2Signals }]);
  });

  it("appends a new version without updating an old assessment and emits its canonical event", async () => {
    const client = { turnAssessment: { findFirst: vi.fn().mockResolvedValue({ assessmentVersion: 2 }), create: vi.fn().mockResolvedValue({ id: "a3" }) },
      sessionEvent: { create: vi.fn().mockResolvedValue({ id: "e3", eventType: "TURN_ASSESSMENT_RECORDED" }) } };
    await appendTurnAssessment(client as never, { sessionId: "s1", candidateTurn: { id: "u1", text: "Use a hash map." },
      trace: adjudicateCandidateSignals({ heuristic, provider: null }) });
    expect(client.turnAssessment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ candidateTurnId: "u1", assessmentVersion: 3 }) }));
    expect(client.sessionEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: "TURN_ASSESSMENT_RECORDED" }) }));
    expect("update" in client.turnAssessment).toBe(false);
  });

  it("replays the same authoritative stream to identical ledger and health outputs", () => {
    const event = { eventType: "TURN_ASSESSMENT_RECORDED", payloadJson: { candidateTurnId: "u1", assessmentVersion: 1, adjudicated: heuristic } };
    const replay = (events: typeof event[]) => ({
      ledger: buildMemoryLedger({ currentStage: "APPROACH_DISCUSSION", signals: heuristic, recentEvents: events }).summary,
      health: assessConversationHealth({ signals: heuristic, recentEvents: events }),
    });
    expect(replay([event])).toEqual(replay([event]));
    expect(replay([event, event])).toEqual(replay([event]));
  });
});
