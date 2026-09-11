import { detectSourceType } from "@/lib/persona/detect-source-type";
import { fail, ok } from "@/lib/http";
import { normalizeUrl } from "@/lib/persona/normalize-url";
import { interviewerProfileUrlSchema } from "@/schemas/interviewer-profile";
import { isPersonaIngestionEnabled } from "@/lib/security/feature-flags";

export async function POST(request: Request) {
  if (!isPersonaIngestionEnabled()) {
    return fail("Persona ingestion is disabled", 503, { code: "PERSONA_INGESTION_DISABLED" });
  }
  const body = await request.json().catch(() => null);
  const parsed = interviewerProfileUrlSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid request body", 400, {
      issues: parsed.error.flatten(),
    });
  }

  const normalizedUrl = normalizeUrl(parsed.data.url);
  const sourceType = detectSourceType(normalizedUrl);
  const supported = sourceType !== "LINKEDIN" && sourceType !== "OTHER";

  return ok({
    normalizedUrl,
    sourceType,
    supported,
    message: supported
      ? "Public profile detected and ready for ingestion."
      : "This URL type is not currently supported for reliable ingestion.",
  });
}
