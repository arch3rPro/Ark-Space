import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("ships automatic content-based tagging with real IDs and save verification in an isolated Skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weknora-tags-"));
  try {
    const installed = join(dir, "weknora");
    await cp(resolve("skills/weknora"), installed, { recursive: true });
    const skill = await readFile(join(installed, "SKILL.md"), "utf8");
    const ingest = await readFile(join(installed, "references/ingest.md"), "utf8");
    expect(skill).toContain("automatically create 1–3 content-backed topic tags");
    expect(ingest).toContain("The import request authorizes this limited tag creation");
    expect(ingest).toContain("do not ask for separate approval");
    expect(ingest).toContain("If no existing tags fit (including an empty tag list)");
    expect(ingest).toContain("POST /knowledge-bases/:id/tags");
    expect(ingest).toContain("stop before uploading");
    expect(ingest).toContain("unless the user explicitly requested an untagged import");
    expect(ingest).toContain("Compare the saved tag IDs with the selected IDs");
    expect(ingest).toContain("Multipart string: `id1,id2`");
    expect(ingest).toContain("JSON array");
    expect(ingest).not.toContain("obtain approval before creating");
    expect(ingest).not.toContain("Tags actually saved, or no match / automatic tagging pending");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
