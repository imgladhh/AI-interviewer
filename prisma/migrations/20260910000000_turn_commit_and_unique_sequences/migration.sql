-- Run docs/specs/third-batch-sequence-preflight.sql and archive its output before applying.
CREATE TABLE "SessionTurnCommit" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "responseTranscriptId" TEXT,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionTurnCommit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionTurnCommit_sessionId_turnId_key" ON "SessionTurnCommit"("sessionId", "turnId");
CREATE INDEX "SessionTurnCommit_sessionId_status_idx" ON "SessionTurnCommit"("sessionId", "status");
ALTER TABLE "SessionTurnCommit" ADD CONSTRAINT "SessionTurnCommit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TranscriptSegment_sessionId_segmentIndex_key" ON "TranscriptSegment"("sessionId", "segmentIndex");
CREATE UNIQUE INDEX "CodeSnapshot_sessionId_snapshotIndex_key" ON "CodeSnapshot"("sessionId", "snapshotIndex");
