import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve("skills/gh-repo", path), "utf8");

describe("gh-repo rate-limit recovery guidance", () => {
  it("makes the first limit an explicit recovery decision at the Skill entry", async () => {
    const skill = await read("SKILL.md");
    expect(skill).toContain("On the first rate-limit response, stop that route and tell the user");
    expect(skill).toContain("ask whether they prefer user-controlled login or continued public-source analysis");
    expect(skill).not.toContain("not reasons for automatic login or transport switching");
  });

  it("offers bounded source acquisition after primary REST exhaustion, not a retry loop", async () => {
    const acquisition = await read("references/acquisition.md");
    expect(acquisition).toContain("### First-limit decision");
    expect(acquisition).toContain("Continue without login (default for public source)");
    expect(acquisition).toContain("git ls-remote");
    expect(acquisition).toContain("raw.githubusercontent.com/OWNER/REPO/FULL_COMMIT_SHA");
    expect(acquisition).toContain("These source reads are only for primary REST quota exhaustion");
    expect(acquisition).toContain("If the user declines login, continue the eligible public-source path");
    expect(acquisition).toContain("gh auth login --hostname github.com --web");
    expect(acquisition).toContain("Never initiate login");
    expect(acquisition).not.toContain("rather than probing alternative network routes");
  });

  it("keeps secondary limits and discussion helper failures separate from source recovery", async () => {
    const acquisition = await read("references/acquisition.md");
    const discussion = await read("references/discussions.md");
    expect(acquisition).toContain("For secondary or unclassified limits, use local/already-fetched evidence only");
    expect(acquisition).toContain("Never rotate identities, tokens, or proxies");
    expect(discussion).toContain("The helper does not ask the user; the calling Agent must run the acquisition reference's first-limit decision");
    expect(discussion).toContain("Raw source cannot replace an unavailable issue/PR record");
    expect(discussion).toContain("No prompt, automatic anonymous fallback, or retry");
  });
});
