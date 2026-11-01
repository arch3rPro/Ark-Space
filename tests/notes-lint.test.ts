import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = resolve("skills/notes/scripts/lint-note.mjs");
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const front = (extra: Record<string, string> = {}) => {
  const f: Record<string, string> = {
    title: "T", type: "note", lang: "zh", sources: "\n  - http://x", retrieved: "2025-01-01",
    status: "verified", updated: "2025-01-01", ...extra,
  };
  return `---\n${Object.entries(f).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
};
const body = (mid = "A 的说明。\n") => `\n# T\n\n## 摘要\n\n结论。\n\n## A 说明\n\n${mid}\n## 来源\n\n- x\n`;

async function lint(text: string, args: string[] = [], files: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "notes-lint-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  await writeFile(join(dir, "n.md"), text);
  const r = spawnSync("node", [script, join(dir, "n.md"), "--json", ...args.map((a) => a.replace("$DIR", dir))], { encoding: "utf8" });
  const out = JSON.parse(r.stdout) as { errors: number; warnings: number; diagnostics: { rule: string; severity: string }[] };
  return { status: r.status, rules: out.diagnostics.map((d) => d.rule), out };
}

describe("lint-note", () => {
  it("passes a clean zh note", async () => {
    const r = await lint(front() + body());
    expect(r.status).toBe(0);
    expect(r.rules).toEqual([]);
  });

  it("passes a clean en note with English headings", async () => {
    const r = await lint(front({ lang: "en" }) + "\n# T\n\n## Summary\n\nx\n\n## Tool setup\n\nTool installs.\n\n## Sources\n\n- x\n");
    expect(r.rules).toEqual([]);
  });

  it.each([
    ["missing frontmatter", "# T\n", "frontmatter-missing"],
    ["missing field", front({ title: "" }) + body(), "frontmatter-required"],
    ["bad enum", front({ type: "blog" }) + body(), "frontmatter-value"],
    ["bad date", front({ updated: "yesterday" }) + body(), "frontmatter-date"],
    ["verified without retrieved", front({ retrieved: "" }) + body(), "verified-without-retrieved"],
    ["missing summary", front() + "\n# T\n\n## 来源\n\n- x\n", "summary-missing"],
    ["missing sources", front() + "\n# T\n\n## 摘要\n\nx\n", "sources-missing"],
    ["heading jump", front() + body("### a\n\n##### b\n\nx\n"), "heading-level"],
  ])("errors on %s", async (_n, text, rule) => {
    const r = await lint(text);
    expect(r.rules).toContain(rule);
    expect(r.status).toBe(1);
  });

  it("warns on long section and context-dependent opening without failing", async () => {
    const r = await lint(front() + body("此外，" + "字".repeat(3100) + "\n"));
    expect(r.rules).toEqual(expect.arrayContaining(["section-length", "section-opening"]));
    expect(r.status).toBe(0);
  });

  it("flags hedges in prose, zh and en, but not in code, inline code, or quotes", async () => {
    const zh = await lint(front() + body("这可能有效。\n"));
    expect(zh.rules).toContain("hedge");
    const en = await lint(front({ lang: "en" }) + "\n# T\n\n## Summary\n\nx\n\n## Tool\n\nTool is probably fine.\n\n## Sources\n\n- x\n");
    expect(en.rules).toContain("hedge");
    const exempt = await lint(front() + body("```\n可能\n```\n\n> 可能\n\n`可能`\n"));
    expect(exempt.rules).not.toContain("hedge");
  });

  it("merges lexicon layers: built-in, --lexicon, local .notes-lint.json", async () => {
    const text = front() + body("A 很玄学，可能。\n");
    const extra = { "extra.json": '{"hedges":["玄学"]}' };
    expect((await lint(text, [], extra)).out.warnings).toBe(1); // 可能 only
    expect((await lint(text, ["--lexicon", "$DIR/extra.json"], extra)).out.warnings).toBe(2);
    const local = { ...extra, ".notes-lint.json": '{"allow":["可能"]}' };
    expect((await lint(text, ["--lexicon", "$DIR/extra.json"], local)).out.warnings).toBe(1);
  });

  it("checks [[links]] only with --root", async () => {
    const text = front() + body("见 [[Other]] 与 [[Missing]]。\n");
    const files = { "other.md": front({ title: "Other" }) + body() };
    expect((await lint(text, [], files)).rules).not.toContain("broken-link");
    const r = await lint(text, ["--root", "$DIR"], files);
    expect(r.out.diagnostics.filter((d) => d.rule === "broken-link")).toHaveLength(1);
    expect(r.status).toBe(1);
  });

  it("exits 2 with stderr on bad usage", () => {
    const r = spawnSync("node", [script], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("usage");
  });

  it("runs from an isolated copy without siblings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "notes-iso-"));
    dirs.push(dir);
    await cp(resolve("skills/notes"), join(dir, "notes"), { recursive: true });
    await writeFile(join(dir, "n.md"), front() + body());
    const r = spawnSync("node", [join(dir, "notes/scripts/lint-note.mjs"), join(dir, "n.md")], { encoding: "utf8", cwd: dir });
    expect(r.status).toBe(0);
  });
});
