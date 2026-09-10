import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeAtomically } from "@/scripts/eval-system-design-weekly";

describe("weekly monitoring publisher", () => {
  it("keeps the prior latest artifact readable when publication rename fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "weekly-publish-"));
    const latest = path.join(dir, "latest.json");
    await writeFile(latest, '{"previous":true}', "utf8");
    await expect(writeAtomically(latest, '{"next":true}', async () => { throw new Error("rename failed"); })).rejects.toThrow("rename failed");
    await expect(readFile(latest, "utf8")).resolves.toBe('{"previous":true}');
  });
});
