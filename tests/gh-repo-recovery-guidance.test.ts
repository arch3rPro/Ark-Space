import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve("skills/gh-repo", path), "utf8");

describe("gh-repo rate-limit recovery guidance", () => {
  it("makes the first limit an explicit recovery decision at the Skill entry", async () => {
    const skill = await read("SKILL.md");
    expect(skill).toContain("probe existing `gh` readiness once, use valid authentication when it is already there, and only then ask the user");
    expect(skill).not.toContain("not reasons for automatic login or transport switching");
  });

  it("probes readiness before asking the user about login", async () => {
    const acquisition = await read("references/acquisition.md");
    const decision = acquisition.slice(acquisition.indexOf("### First-limit decision"));
    expect(decision).toContain("Run `gh auth status --hostname github.com` at most once per task *before* asking anything");
    expect(decision).toContain("there is nothing to ask");
    expect(decision).toContain("Never ask about logging in before probing readiness");
    // Ordering: the probe precedes the first user question, so an authenticated user is never asked.
    expect(decision).toMatch(/Probe readiness, then ask once/);
    expect(decision.indexOf("gh auth status --hostname github.com")).toBeLessThan(decision.indexOf("ask the user once"));
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
