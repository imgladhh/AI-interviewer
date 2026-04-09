import { z } from "zod";

export const interviewModeSchema = z.enum(["CODING", "SYSTEM_DESIGN"]);
export const targetLevelSchema = z.enum(["NEW_GRAD", "SDE1", "SDE2", "SENIOR", "STAFF"]);
export const companyStyleSchema = z.enum(["GENERIC", "AMAZON", "META", "GOOGLE", "STRIPE"]);
export const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);

export const createSessionSchema = z.object({
  mode: interviewModeSchema,
  targetLevel: targetLevelSchema,
  selectedLanguage: z.string().trim().min(1).max(32).optional(),
  companyStyle: companyStyleSchema.optional(),
  difficulty: difficultySchema.optional(),
  questionId: z.string().trim().min(1).optional(),
  voiceEnabled: z.boolean().default(true),
  lowCostMode: z.boolean().default(false),
  personaEnabled: z.boolean().default(false),
  interviewerProfileId: z.string().trim().min(1).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
