import { expect, test } from "@playwright/test";

test("core application and dependencies are reachable", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).data.status).toBe("ok");
  await page.goto("/setup");
  await expect(page).toHaveTitle(/AI Interviewer/i);
  await expect(page.locator("body")).toContainText(/interview/i);
});
