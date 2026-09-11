CREATE TABLE "TurnAssessment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "candidateTurnId" TEXT NOT NULL,
  "assessmentVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "heuristicJson" JSONB NOT NULL,
  "providerJson" JSONB,
  "adjudicatedJson" JSONB NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TurnAssessment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TurnAssessment_sessionId_candidateTurnId_assessmentVersion_key"
  ON "TurnAssessment"("sessionId", "candidateTurnId", "assessmentVersion");
CREATE INDEX "TurnAssessment_sessionId_candidateTurnId_createdAt_idx"
  ON "TurnAssessment"("sessionId", "candidateTurnId", "createdAt");
ALTER TABLE "TurnAssessment" ADD CONSTRAINT "TurnAssessment_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
