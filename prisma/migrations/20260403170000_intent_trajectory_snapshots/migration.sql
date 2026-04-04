CREATE TABLE "IntentSnapshot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "stage" TEXT,
  "source" TEXT,
  "intentJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrajectorySnapshot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "stage" TEXT,
  "source" TEXT,
  "trajectoryJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrajectorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntentSnapshot_sessionId_createdAt_idx" ON "IntentSnapshot"("sessionId", "createdAt");
CREATE INDEX "TrajectorySnapshot_sessionId_createdAt_idx" ON "TrajectorySnapshot"("sessionId", "createdAt");

ALTER TABLE "IntentSnapshot"
ADD CONSTRAINT "IntentSnapshot_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrajectorySnapshot"
ADD CONSTRAINT "TrajectorySnapshot_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
