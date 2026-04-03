import { prisma } from "@/lib/db";

type PersonaSourceType = "GITHUB" | "BLOG" | "PERSONAL_SITE" | "LINKEDIN" | "OTHER" | string;

type DerivedPersonaProfile = {
  fullName: string;
  headline: string;
  currentRole: string;
  currentCompany: string;
  location: string | null;
  bioSummary: string;
  personaSummary: string;
  technicalFocus: string[];
  likelyInterviewFocus: string[];
  communicationStyleGuess: string[];
  seniorityEstimate: string;
  confidence: number;
  rawTextExcerpt: string;
  normalizedContent: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readMeta(html: string, name: string) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function readTitle(html: string) {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

function readFirstHeading(html: string) {
  return html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null;
}

function pickUnique(values: string[], max = 4) {
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

function inferSeniority(text: string) {
  if (/\b(staff|principal|distinguished|architect)\b/i.test(text)) return "staff_plus";
  if (/\b(senior|lead|manager|head of|director)\b/i.test(text)) return "senior";
  if (/\b(intern|student|new grad|graduate)\b/i.test(text)) return "junior";
  return "mid";
}

function inferTechnicalFocus(text: string, sourceType: PersonaSourceType) {
  const focus: string[] = [];
  if (/\b(distributed|scalab|latency|throughput|cache|queue|storage|consistency)\b/i.test(text)) focus.push("system design");
  if (/\b(test|pytest|jest|unit test|integration test|tdd|debug)\b/i.test(text)) focus.push("testing and debugging");
  if (/\b(frontend|react|next\.js|typescript|javascript|css|ui)\b/i.test(text)) focus.push("frontend engineering");
  if (/\b(backend|api|database|postgres|redis|service|microservice)\b/i.test(text)) focus.push("backend engineering");
  if (/\b(algorithm|leetcode|complexity|graph|dynamic programming|heap|hash map)\b/i.test(text)) focus.push("coding interviews");
  if (/\b(tooling|infra|developer experience|observability|ci\/cd)\b/i.test(text)) focus.push("developer tooling");
  if (sourceType === "GITHUB") focus.push("implementation quality");
  if (sourceType === "BLOG") focus.push("technical communication");
  return pickUnique(focus.length > 0 ? focus : ["software engineering"]);
}

function inferInterviewFocus(text: string, sourceType: PersonaSourceType) {
  const focus: string[] = [];
  if (/\b(tradeoff|complexity|performance)\b/i.test(text)) focus.push("tradeoffs");
  if (/\b(test|edge case|correctness|invariant|proof)\b/i.test(text)) focus.push("correctness and validation");
  if (/\b(system design|distributed|scalab|latency)\b/i.test(text)) focus.push("scalability reasoning");
  if (/\b(leadership|mentoring|ownership|collaboration)\b/i.test(text)) focus.push("communication and ownership");
  if (sourceType === "GITHUB") focus.push("implementation clarity");
  if (sourceType === "BLOG") focus.push("structured explanation");
  return pickUnique(focus.length > 0 ? focus : ["structured problem solving"]);
}

function inferCommunicationStyle(text: string, sourceType: PersonaSourceType) {
  const styles: string[] = [];
  if (/\b(tutorial|guide|explained|walkthrough|deep dive)\b/i.test(text)) styles.push("thoughtful");
  if (/\b(pragmatic|practical|ship|production|reliable)\b/i.test(text)) styles.push("pragmatic");
  if (/\b(precise|rigorous|formal|invariant|proof)\b/i.test(text)) styles.push("rigorous");
  if (sourceType === "GITHUB") styles.push("implementation-focused");
  if (sourceType === "BLOG") styles.push("explanatory");
  return pickUnique(styles.length > 0 ? styles : ["direct"]);
}

function deriveNameAndRole(title: string | null, heading: string | null, text: string) {
  const source = heading ?? title ?? text;
  const firstLine = source.split(/[\-|•|:]/)[0]?.trim() ?? "Public Profile";
  const fullName = firstLine.length > 2 ? firstLine : "Public Profile";
  const roleMatch = text.match(/\b((staff|senior|lead|principal|software|frontend|backend|full[- ]stack) [a-z ]{0,30}(engineer|developer))\b/i);
  const companyMatch = text.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/);
  return {
    fullName,
    currentRole: roleMatch?.[1]?.trim() ?? "Software Engineer",
    currentCompany: companyMatch?.[1]?.trim() ?? "Unknown",
  };
}

export function derivePersonaProfileFromPublicContent(input: {
  url: string;
  sourceType: PersonaSourceType;
  html?: string | null;
}) : DerivedPersonaProfile {
  const html = input.html ?? "";
  const title = readTitle(html);
  const heading = readFirstHeading(html);
  const description = readMeta(html, "description") ?? readMeta(html, "og:description");
  const text = stripHtml(`${title ?? ""} ${heading ?? ""} ${description ?? ""} ${html}`);
  const normalizedContent = text.slice(0, 4000);
  const { fullName, currentRole, currentCompany } = deriveNameAndRole(title, heading, text);
  const technicalFocus = inferTechnicalFocus(text, input.sourceType);
  const likelyInterviewFocus = inferInterviewFocus(text, input.sourceType);
  const communicationStyleGuess = inferCommunicationStyle(text, input.sourceType);
  const seniorityEstimate = inferSeniority(text);
  const contentSignal = clamp(normalizedContent.length / 1600, 0, 1);
  const confidence = clamp(0.32 + contentSignal * 0.38 + (description ? 0.08 : 0) + (heading ? 0.07 : 0), 0.35, 0.88);
  const headline = [currentRole, currentCompany !== "Unknown" ? `at ${currentCompany}` : null].filter(Boolean).join(" ");
  const personaSummary = `Public-source ingestion suggests a ${seniorityEstimate.replace('_', ' ')} interviewer who likely values ${likelyInterviewFocus.slice(0, 2).join(" and ")} with a ${communicationStyleGuess[0] ?? "direct"} communication style.`;
  const bioSummary = description ?? `Synthesized from public profile content at ${input.url}.`;
  const rawTextExcerpt = normalizedContent.slice(0, 600) || `Public source was reachable but sparse for ${input.url}.`;

  return {
    fullName,
    headline,
    currentRole,
    currentCompany,
    location: null,
    bioSummary,
    personaSummary,
    technicalFocus,
    likelyInterviewFocus,
    communicationStyleGuess,
    seniorityEstimate,
    confidence,
    rawTextExcerpt,
    normalizedContent,
  };
}

async function fetchPublicProfileHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AI-Interviewer/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Public profile fetch failed with status ${response.status}`);
  }

  return response.text();
}

export async function runPersonaIngestion(interviewerProfileId: string, attemptNumber: number) {
  const profile = await prisma.interviewerProfile.findUnique({
    where: { id: interviewerProfileId },
  });

  if (!profile) {
    return;
  }

  await prisma.interviewerProfile.update({
    where: { id: interviewerProfileId },
    data: {
      status: "PROCESSING",
      fetchStatus: "FETCHING",
    },
  });

  let html = "";
  let fetchError: Error | null = null;

  try {
    html = await fetchPublicProfileHtml(profile.sourceUrl);
  } catch (error) {
    fetchError = error instanceof Error ? error : new Error("Unknown public profile fetch error");
  }

  const derived = derivePersonaProfileFromPublicContent({
    url: profile.sourceUrl,
    sourceType: profile.sourceType,
    html,
  });

  const fallbackPenalty = fetchError ? 0.14 : 0;
  const finalConfidence = clamp(derived.confidence - fallbackPenalty, 0.25, 0.88);
  const sourceError = fetchError ? `${fetchError.message} Falling back to heuristic public-profile inference.` : null;

  await prisma.interviewerProfile.update({
    where: { id: interviewerProfileId },
    data: {
      fullName: derived.fullName,
      headline: derived.headline,
      currentRole: derived.currentRole,
      currentCompany: derived.currentCompany,
      location: derived.location,
      bioSummary: derived.bioSummary,
      personaSummary: derived.personaSummary,
      seniorityEstimate: derived.seniorityEstimate,
      technicalFocus: derived.technicalFocus,
      likelyInterviewFocus: derived.likelyInterviewFocus,
      communicationStyleGuess: derived.communicationStyleGuess,
      confidence: finalConfidence,
      fetchedAt: new Date(),
      status: fetchError ? "PARTIAL" : "READY",
      fetchStatus: fetchError ? "FAILED" : "SUCCEEDED",
      sources: {
        updateMany: {
          where: { interviewerProfileId },
          data: {
            fetchStatus: fetchError ? "FAILED" : "SUCCEEDED",
            fetchedAt: new Date(),
            errorMessage: sourceError,
            rawTextExcerpt: derived.rawTextExcerpt,
            normalizedContent: derived.normalizedContent,
          },
        },
      },
      signalsJson: {
        sourceType: profile.sourceType,
        ingestionMode: fetchError ? "heuristic_fallback" : "public_fetch",
        attemptNumber,
        technicalFocus: derived.technicalFocus,
        likelyInterviewFocus: derived.likelyInterviewFocus,
      },
    },
  });
}




