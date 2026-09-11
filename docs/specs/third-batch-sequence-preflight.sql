-- Must return zero rows before applying the third-batch uniqueness migration.
SELECT "sessionId", "segmentIndex", COUNT(*) AS duplicate_count
FROM "TranscriptSegment"
GROUP BY "sessionId", "segmentIndex"
HAVING COUNT(*) > 1;

SELECT "sessionId", "snapshotIndex", COUNT(*) AS duplicate_count
FROM "CodeSnapshot"
GROUP BY "sessionId", "snapshotIndex"
HAVING COUNT(*) > 1;
