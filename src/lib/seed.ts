import { prisma } from "@/lib/db";
import { QUESTION_BANK } from "@/lib/interview/question-bank";

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

  await Promise.all(
    QUESTION_BANK.map((question) =>
      prisma.question.upsert({
        where: { slug: question.slug },
        update: question,
        create: question,
      }),
    ),
  );
}
