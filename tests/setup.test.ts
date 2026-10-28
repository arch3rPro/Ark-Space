import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runSetup } from "../src/cli/setup.js";
import { initialSetupLanguage, setupAffirmative, setupSafeError } from "../src/cli/setup-language.js";
import { initializeConfig, loadConfig } from "../src/config/store.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";

vi.mock("../src/tui/index.js", () => ({
  runSetupTui: vi.fn(async () => {
    const mode = (globalThis as { __tuiMode?: string }).__tuiMode;
    if (mode === "cancel") throw new Error("Setup cancelled.");
    if (mode === "fatal") throw new Error("Synthetic failure");
  }),
}));

const directories: string[] = [];
afterEach(async () => {
  for (const s of [process.stdin, process.stdout]) Reflect.deleteProperty(s, "isTTY");
  delete (globalThis as { __tuiMode?: string }).__tuiMode;
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});
async function fixture(tty = true) {
  const home = await mkdtemp(join(tmpdir(), "arks-setup-")); directories.push(home);
  for (const s of [process.stdin, process.stdout]) Object.defineProperty(s, "isTTY", { configurable: true, value: tty });
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { paths: resolveArkSpacePaths({ ARKSPACE_HOME: home }), output };
}
const text = (output: { mock: { calls: unknown[][] } }) => output.mock.calls.map(call => String(call[0])).join("");
const options = { environment: {} };

it("renders cancel and fatal exits in the session language through the v2 engine", async () => {
  for (const mode of ["cancel", "fatal"] as const) {
    const { paths, output } = await fixture();
    (globalThis as { __tuiMode?: string }).__tuiMode = mode;
    await runSetup(paths, { environment: {}, language: "en" });
    const written = text(output);
    expect(written).toContain(mode === "cancel" ? "Setup cancelled." : "Operation failed;");
    expect(written).not.toContain("Synthetic failure");
    expect(process.exitCode).toBe(mode === "fatal" ? 1 : undefined);
    if (mode === "fatal") process.exitCode = undefined;
  }
  const { paths, output } = await fixture();
  (globalThis as { __tuiMode?: string }).__tuiMode = "cancel";
  await runSetup(paths, { environment: {}, language: "zh" });
  expect(text(output)).toContain("设置已取消");
});

it("honours flag over saved language over locale on the noninteractive line without persisting detection or flag", async () => {
  const { paths, output } = await fixture(false);
  await runSetup(paths, { environment: { LANG: "zh_CN.UTF-8" } });
  expect(text(output)).toContain("配置已就绪");
  expect((await loadConfig(paths.config)).setupLanguage).toBeUndefined();
  const config = await loadConfig(paths.config); config.setupLanguage = "en";
  await writeFile(paths.config, JSON.stringify(config));
  output.mockClear();
  await runSetup(paths, { environment: { LANG: "zh_CN" } });
  expect(text(output)).toContain("configuration ready");
  output.mockClear();
  await runSetup(paths, { environment: { LANG: "zh_CN" }, language: "zh" });
  expect(text(output)).toContain("配置已就绪");
  expect((await loadConfig(paths.config)).setupLanguage).toBe("en");
});

it("validates --lang and the positional provider before touching configuration", async () => {
  const { paths } = await fixture(false);
  await expect(runSetup(paths, { ...options, language: "fr" })).rejects.toThrow(/--lang/);
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(runSetup(paths, { ...options, provider: "local" })).rejects.toThrow(/unsupported/i);
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
});

it("noninteractive setup emits one plain line and preserves existing config bytes", async () => {
  const { paths } = await fixture(false);
  await initializeConfig(paths.config);
  const config = await loadConfig(paths.config); config.providerOrder = ["tavily"];
  await writeFile(paths.config, JSON.stringify(config)); const before = await readFile(paths.config, "utf8");
  const { output } = { output: vi.spyOn(process.stdout, "write").mockReturnValue(true) };
  await runSetup(paths, options);
  const written = text(output);
  expect(written).toContain("not an interactive terminal");
  expect(written).not.toContain("\x1b");
  expect(await readFile(paths.config, "utf8")).toBe(before);
});

it("localizes only exact safe errors, preserving honest partial-write recovery", () => {
  const partial = setupSafeError("zh", "Setup: Local credential remains stored as env:EXA_API_KEY_1, but registration failed; recover with arks key add exa --env EXA_API_KEY_1.");
  expect(partial).toContain("已保留"); expect(partial).toContain("arks key add exa --env EXA_API_KEY_1");
  expect(setupSafeError("zh", "Setup: Local credential was replaced, but key health reset failed; inspect state before retrying.")).toContain("已替换");
  expect(setupSafeError("zh", "Setup: Reference was unlinked, but its local credential remains stored; remove the orphaned credential after inspecting the store.")).toContain("仍保留");
  expect(setupSafeError("zh", "Setup: Tracked owned resources require this credential and enabled provider for cleanup; clean them up first.")).toContain("请先清理");
  expect(setupSafeError("zh", "Setup: The selected reference is shared; unlink it or add a new local key instead.")).toContain("已共享");
  expect(setupSafeError("zh", "Setup: The selected reference is environment-managed; change it externally or add a new local key.")).toContain("由环境管理");
  expect(setupSafeError("zh", "SearXNG instance is already configured; permissions were not changed.")).toContain("权限未更改");
  expect(setupSafeError("zh", "Setup: fake-private-secret")).toBeUndefined();
});
it("every P2-P4 workbench failure literal stays on the localized safe list", () => {
  // commands.ts may only surface these exact strings from manage/store write paths; anything else shows a suppressed generic.
  const reachable = [
    "Setup: Credential values must be non-empty and must not contain controls or placeholders.",
    "Setup: The selected key reference is no longer configured; refresh setup.",
    "Setup: The selected reference is environment-managed; change it externally or add a new local key.",
    "Setup: Unable to read or update local setup files safely; inspect their permissions and format.",
    "Setup: Automatic provider order must be nonempty and contain no duplicates.",
    "Setup: Unknown provider in automatic order.",
    "Setup: Invalid SearXNG endpoint or per-instance CIDR configuration.",
    "Setup: Invalid SearXNG instance identity.",
    "Setup: The selected instance is no longer configured; refresh setup.",
    "Setup: SearXNG has no local entry; environment endpoints are external. Add a local instance explicitly first.",
    "Setup: Change automatic provider order before removing the last SearXNG instance.",
    "SearXNG instance is already configured; permissions were not changed.",
    "Invalid SearXNG endpoint or CIDR configuration.",
    "WeKnora is not configured yet; set the API root first.",
    "Setup: An existing WeKnora credential requires explicit replacement consent; refresh setup before replacing it.",
    "Setup: Changing the WeKnora API root requires explicit consent to reuse its saved key.",
    "Setup: Invalid WeKnora API root or connection settings.",
    "Setup: WeKnora connection is no longer configured; refresh configuration.",
    "Setup: WeKnora has no saved key to reuse; supply a new credential explicitly.",
    "Setup: WeKnora connection save failed; the saved credential was not changed.",
    "Setup: WeKnora environment-managed configuration is read-only; change it externally.",
    "Setup: Setup language must be en or zh.",
  ];
  for (const message of reachable) {
    expect(setupSafeError("en", message), message).toBeDefined();
    expect(setupSafeError("zh", message), message).toBeTruthy();
  }
  expect(setupSafeError("zh", "Setup: Unexpected internal detail with a path /home/user/.ssh/id_rsa")).toBeUndefined();
});
it("uses original locale precedence and never treats blank Chinese consent as affirmative", () => {
  expect(initialSetupLanguage(undefined, undefined, {})).toBe("en");
  expect(initialSetupLanguage(undefined, undefined, { LC_ALL: "en_US", LC_MESSAGES: "zh_CN", LANG: "zh_CN" })).toBe("en");
  expect(initialSetupLanguage(undefined, undefined, { LANG: "zh_CN" })).toBe("zh");
  expect(initialSetupLanguage(undefined, "zh", { LANG: "en_US" })).toBe("zh");
  expect(initialSetupLanguage("en", "zh", { LANG: "zh_CN" })).toBe("en");
  expect(setupAffirmative("确认")).toBe(true); expect(setupAffirmative("是")).toBe(true);
  expect(setupAffirmative("")).toBe(false); expect(setupAffirmative("确认取消")).toBe(false);
});
