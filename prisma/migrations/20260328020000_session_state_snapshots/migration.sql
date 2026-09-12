-- CreateTable
CREATE TABLE "CandidateStateSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stage" TEXT,
    "source" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewerDecisionSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stage" TEXT,
    "source" TEXT,
    "decisionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewerDecisionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateStateSnapshot_sessionId_createdAt_idx" ON "CandidateStateSnapshot"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewerDecisionSnapshot_sessionId_createdAt_idx" ON "InterviewerDecisionSnapshot"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateStateSnapshot" ADD CONSTRAINT "CandidateStateSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewerDecisionSnapshot" ADD CONSTRAINT "InterviewerDecisionSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
