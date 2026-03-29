import { CompanyStyle, Difficulty, QuestionType, TargetLevel } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function ensureSeedData() {
  const existing = await prisma.user.findFirst({
    where: { email: "demo@example.com" },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: "demo@example.com",
        name: "Demo Candidate",
      },
    });
  }

  const questions = [
    {
      type: QuestionType.CODING,
      title: "Two Sum",
      slug: "two-sum",
      prompt: "Given an array of integers nums and an integer target, return the indices of the two numbers such that they add up to target. Assume exactly one valid answer exists and you may not use the same element twice.",
      difficulty: Difficulty.EASY,
      companyStyle: CompanyStyle.GENERIC,
      levelTarget: TargetLevel.SDE1,
      estimatedMinutes: 20,
    },
    {
      type: QuestionType.CODING,
      title: "Merge Intervals",
      slug: "merge-intervals",
      prompt: "Given an array of intervals, merge all overlapping intervals and return a list of non-overlapping intervals covering the same ranges.",
      difficulty: Difficulty.MEDIUM,
      companyStyle: CompanyStyle.GENERIC,
      levelTarget: TargetLevel.SDE1,
      estimatedMinutes: 35,
    },
    {
      type: QuestionType.CODING,
      title: "Top K Frequent Elements",
      slug: "top-k-frequent-elements",
      prompt: "Return the k most frequent elements from the input array.",
      difficulty: Difficulty.MEDIUM,
      companyStyle: CompanyStyle.GENERIC,
      levelTarget: TargetLevel.SDE2,
      estimatedMinutes: 35,
    },
    {
      type: QuestionType.SYSTEM_DESIGN,
      title: "Design URL Shortener",
      slug: "design-url-shortener",
      prompt: "Design a URL shortening service that supports creation and redirection at internet scale.",
      difficulty: Difficulty.MEDIUM,
      companyStyle: CompanyStyle.GENERIC,
      levelTarget: TargetLevel.SDE2,
      estimatedMinutes: 45,
    },
  ];

  await Promise.all(
    questions.map((question) =>
      prisma.question.upsert({
        where: { slug: question.slug },
        update: question,
        create: question,
      }),
    ),
  );
}
