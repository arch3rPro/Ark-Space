import process from "node:process";
import { BlockList, isIP } from "node:net";
import { executeWebSearch } from "../capabilities/web-search.js";
import { loadCredentialEnvironment } from "../config/credentials.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { SearxngInstanceSchema } from "../config/schema.js";
import { addSearxngInstance, initializeConfig, loadConfig } from "../config/store.js";
import {
  getSetupSnapshot, addSetupKey, replaceSetupKey, removeSetupKey, setSetupKeyEnabled,
  setSetupProviderEnabled, setSetupProviderOrder, updateSetupInstance, removeSetupInstance, setSetupLanguage,
} from "../config/manage.js";
import { ProviderError } from "../errors/provider-error.js";
import { resolveWebSearchInput } from "../protocol/schema.js";
import type { ProviderId } from "../protocol/types.js";
import { createSearchProviderRegistry } from "../providers/registry.js";
import { SetupTerminal } from "./setup-terminal.js";
import { runSetupWorkbench } from "./setup-workbench.js";
import { initialSetupLanguage, setupMessage, setupSafeError, type SetupLanguage } from "./setup-language.js";

const PROVIDERS = ["exa", "tavily", "firecrawl", "searxng"] as const;
const KEY_PAGES = {
  exa: "https://dashboard.exa.ai/api-keys", tavily: "https://app.tavily.com/home",
  firecrawl: "https://www.firecrawl.dev/app/api-keys",
};
type SetupProvider = (typeof PROVIDERS)[number];
export interface SetupPrompts {
  askText(question: string): Promise<string>;
  askSecret(label: string): Promise<string>;
  askYesNo(question: string): Promise<boolean>;
}
export interface SetupOptions { provider?: string; language?: string; environment?: NodeJS.ProcessEnv; signal?: AbortSignal }
class SetupCancelled extends Error { constructor() { super("Setup cancelled."); } }
const say = (text: string) => { process.stdout.write(`${text}\n`); };
// Only non-secret, validated metadata is rendered; never print unexpected error bodies.
const display = (value: unknown) => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
function reportInitial(error: unknown, language: SetupLanguage) {
  if (error instanceof ProviderError) {
    say(setupSafeError(language, error.message) ?? setupMessage(language, "notSaved", { kind: setupMessage(language, error.kind) }));
  } else say(setupMessage(language, "operationFailed"));
}

export async function runSetup(paths: ArkSpacePaths, injected?: SetupPrompts, options: SetupOptions = {}): Promise<void> {
  if (options.language !== undefined && options.language !== "en" && options.language !== "zh") {
    throw new ProviderError("--lang must be en or zh / --lang 必须为 en 或 zh.", { kind: "invalid-request" });
  }
  const environment = options.environment ?? { ...process.env };
  let language = initialSetupLanguage(options.language, undefined, environment);
  if (options.provider !== undefined && !PROVIDERS.includes(options.provider as SetupProvider)) {
    throw new ProviderError(setupMessage(language, "unsupportedProvider"), { kind: "invalid-request" });
  }
  const m = (key: Parameters<typeof setupMessage>[1], values?: Record<string, string | number>) => setupMessage(language, key, values);
  const status = (value: string) => value === "configured (not probed)" ? m("configured") :
    ["enabled", "disabled", "cooldown", "exhausted"].includes(value) ? m(value as "enabled" | "disabled" | "cooldown" | "exhausted") : m("unknown");
  const selection = (position?: number) => position === undefined ? m("explicitOnly") : m("automatic", { position });
  try {
    const config = await initializeConfig(paths.config);
    language = initialSetupLanguage(options.language, config.setupLanguage, environment);
  } catch (error) { reportInitial(error, language); process.exitCode = 1; return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${m("ready", { path: paths.config })}\n`);
    return;
  }
  const terminal = new SetupTerminal();
  if (!injected) {
    let failure: unknown; let cancelled = false;
    try {
      terminal.open();
      await runSetupWorkbench(paths, terminal, language, { ...options, environment, onLanguageChange: next => { language = next; } });
    } catch (error) {
      if (error instanceof Error && error.message === "Setup cancelled.") cancelled = true;
      else { failure = error; process.exitCode = 1; }
    } finally { terminal.close(); }
    if (cancelled) process.stdout.write(`${m("cancelled")}\n`);
    else if (failure) reportInitial(failure, language);
    return;
  }
  // Compatibility seam for existing injected safety tests only; never a human UI fallback.
  const notices: string[] = [];
  const say = (message: string) => { notices.push(message); };
  const report = (error: unknown, _language: SetupLanguage) => {
    say(error instanceof ProviderError ? setupSafeError(language, error.message) ?? m("notSaved", { kind: m(error.kind) }) : m("operationFailed"));
  };
  const screen = (content: string) => {
    const body = [...notices.splice(0), content].join("\n");
    process.stdout.write(`${body}\n`);
  };
  const prompts = injected;
  const confirm = async (question: string) => {
    screen(m("formFooter"));
    if (options.signal?.aborted) throw new SetupCancelled();
    const answer = await prompts.askYesNo(question);
    if (options.signal?.aborted) throw new SetupCancelled();
    return answer;
  };
  const secretInput = async (label: string, instructions = "") => {
    screen(`${m("safety", { path: paths.credentials })}\n${instructions}\n${m("formFooter")}`);
    if (options.signal?.aborted) throw new SetupCancelled();
    return prompts.askSecret(label);
  };
  const text = async (label: string) => {
    if (options.signal?.aborted) throw new SetupCancelled();
    screen(m("formFooter"));
    const value = await prompts.askText(label);
    if (options.signal?.aborted) throw new SetupCancelled();
    return value.trim();
  };
  const menu = async (title: string, entries: string[]): Promise<number> => {
    if (options.signal?.aborted) throw new SetupCancelled();
    for (;;) {
      screen(`\n${title}\n${entries.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n0. ${m("back")}\n${m("navigation")}`);
      const answer = (await prompts.askText(m("choice"))).trim();
      if (!answer || answer === "0") return 0;
      if (/^[1-9]\d*$/.test(answer) && Number(answer) <= entries.length) return Number(answer);
      say(m("invalidChoice"));
    }
  };
  const snapshot = () => getSetupSnapshot(paths, environment);
  const saved = () => say(m("saved"));
  const mutate = async (action: () => Promise<unknown>) => {
    if (options.signal?.aborted) throw new SetupCancelled();
    try { await action(); saved(); return true; } catch (error) { report(error, language); return false; }
  };
  const languageMenu = async () => {
    const choice = await menu("Language / 语言", ["English", "中文"]);
    if (!choice) return;
    const next = choice === 1 ? "en" : "zh";
    if (options.signal?.aborted) throw new SetupCancelled();
    try { await setSetupLanguage(paths, next); language = next; saved(); }
    catch (error) { report(error, language); }
  };
  const permissions = async (baseUrl: string, advanced: boolean): Promise<string[] | undefined> => {
    let host: string;
    try { host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, ""); }
    catch { throw new ProviderError("Setup: Invalid SearXNG URL.", { kind: "invalid-request" }); }
    const family = isIP(host);
    if (advanced) {
      for (;;) {
        const answer = await text(m("cidrs"));
        if (answer === "0") return undefined;
        const ranges = answer.split(/[,\s]+/).filter(Boolean);
        if (SearxngInstanceSchema.safeParse({ baseUrl, allowRanges: ranges }).success) return ranges;
        say(m("invalidCidrs"));
      }
    }
    if (family && privateAddress(host, family) && await confirm(
      m("privateConsent", { range: `${host}/${family === 4 ? 32 : 128}` }),
    )) return [`${host}/${family === 4 ? 32 : 128}`];
    return [];
  };
  const addInstances = async (advanced = false) => {
    for (;;) {
      const url = await text(`${m("searxngPrivacy")}\n${m(advanced ? "advancedUrl" : "instanceUrl")}`);
      if (!url || url === "0") return;
      const parsed = SearxngInstanceSchema.safeParse({ baseUrl: url, allowRanges: [] });
      if (!parsed.success) { say(m("invalidUrl")); continue; }
      const ranges = await permissions(parsed.data.baseUrl, advanced);
      if (!ranges) return;
      await mutate(() => addSearxngInstance(paths.config, parsed.data.baseUrl, ranges));
    }
  };
  const addKeys = async (id: Exclude<SetupProvider, "searxng">) => {
    for (;;) {
      const secret = await secretInput(m("secret"), m("keyInstructions", { url: KEY_PAGES[id] }));
      if (options.signal?.aborted) throw new SetupCancelled();
      if (!secret) return;
      await mutate(() => addSetupKey(paths, id, secret, environment));
    }
  };
  const manageKey = async (id: SetupProvider, reference: string) => {
      for (;;) {
        const key = (await snapshot()).providers.find(p => p.id === id)!.keys.find(k => k.reference === reference);
        if (!key) break;
        say(m("keyDetailLine", { reference: display(key.reference), id: display(key.keyId), source: m(key.source), status: status(key.status), owners: key.ownedResources }));
        if (key.source === "environment") say(m("envKey"));
        const choice = await menu(m("keyDetail"), [m("replaceKey"), m(key.status === "disabled" ? "enableKey" : key.status === "cooldown" ? "restoreKey" : "disableKey"), m("removeKey")]);
        if (!choice) break;
        if (choice === 1) {
          if (key.source === "environment" || !key.hasLocal) { say(m("replacementReadOnly")); continue; }
          if (!await confirm(m("replaceConsent"))) continue;
          const secret = await secretInput(m("replacementSecret"));
          if (options.signal?.aborted) throw new SetupCancelled();
          if (secret) await mutate(() => replaceSetupKey(paths, id, reference, secret, environment));
        } else if (choice === 2) {
          await mutate(() => setSetupKeyEnabled(paths, id, reference, key.status === "disabled" || key.status === "cooldown"));
        } else if (await confirm(m("removeKeyConsent"))) {
          if (await mutate(() => removeSetupKey(paths, id, reference))) break;
        }
      }
  };
  const manageInstance = async (baseUrl: string) => {
    for (;;) {
      const instances = (await snapshot()).providers.find(p => p.id === "searxng")!.instances;
      const instance = instances.find(i => i.baseUrl === baseUrl);
      if (!instance) return;
      if (instance.source === "environment") {
        await menu(m("envInstance"), []);
        return;
      }
      const choice = await menu(m("instanceTitle", { url: display(instance.baseUrl), ranges: instance.allowRanges.map(display).join(", ") || m("none") }), [m("editUrl"), m("editAdvanced"), m("removeInstance")]);
      if (!choice) return;
      if (choice === 3) {
        if (await confirm(m(instances.length === 1 ? "removeLastConsent" : "removeInstanceConsent")) && await mutate(() => removeSetupInstance(paths, instance.baseUrl))) return;
      } else {
        for (;;) {
          const answer = await text(m("newUrl"));
          if (answer === "0") break;
          const parsed = SearxngInstanceSchema.safeParse({ baseUrl: answer || instance.baseUrl, allowRanges: [] });
          if (!parsed.success) { say(m("invalidEditUrl")); continue; }
          const ranges = choice === 1 && parsed.data.baseUrl === instance.baseUrl
            ? [...instance.allowRanges] : await permissions(parsed.data.baseUrl, choice === 2);
          if (!ranges) break;
          if (await mutate(() => updateSetupInstance(paths, instance.baseUrl, parsed.data.baseUrl, ranges))) { baseUrl = parsed.data.baseUrl; break; }
        }
      }
    }
  };
  const liveTest = async (id: SetupProvider) => {
    if (!await confirm(m("liveConsent", { id }))) return;
    if (options.signal?.aborted) throw new SetupCancelled();
    try {
      const result = await executeWebSearch(resolveWebSearchInput({ query: "Agent Skills documentation", provider: id, maxResults: 1, timeoutMs: 5_000 }), {
        config: await loadConfig(paths.config), statePath: paths.state,
        providers: createSearchProviderRegistry(),
        environment: await loadCredentialEnvironment(paths.credentials, environment),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      say(m("liveResult", { status: m(result.ok ? "success" : "failed"), count: result.attempts.length }));
      // Do not render provider messages, response bodies or result snippets.
      for (const attempt of result.attempts) say(m("attempt", { provider: display(attempt.provider), id: display(attempt.keyId ?? attempt.instanceId ?? ""), status: attempt.ok ? m("success") : m(attempt.errorKind ?? "failed") }));
    } catch (error) { report(error, language); }
  };
  const providerMenu = async (id: SetupProvider) => {
    for (;;) {
      const p = (await snapshot()).providers.find(p => p.id === id)!;
      if (p.external) say(m("externalProvider"));
      const rows = id === "searxng" ? p.instances.map(i => `${display(i.baseUrl)} — ${m(i.source ?? "local")}, ${status(i.status)}`)
        : p.keys.map((k, i) => m("keyRow", { number: i + 1, source: m(k.source), available: m(k.available ? "available" : "unavailable"), status: status(k.status) }));
      const choice = await menu(m("providerTitle", { id, status: m(p.enabled ? "enabled" : "disabled"), selection: selection(p.automaticPosition) }), [
        m(id === "searxng" ? "addInstances" : "addKeys"), ...rows,
        m(p.enabled ? "disableProvider" : "enableProvider"), m("liveTest"),
        ...(id === "searxng" ? [m("advancedInstances")] : []), "Language / 语言",
      ]);
      if (!choice) return;
      if (choice === 1) { if (id === "searxng") await addInstances(); else await addKeys(id); }
      else if (choice <= rows.length + 1) {
        if (id === "searxng") await manageInstance(p.instances[choice - 2]!.baseUrl);
        else await manageKey(id, p.keys[choice - 2]!.reference);
      } else if (choice === rows.length + 2) {
        if (p.external) say(m("externalToggle"));
        else await mutate(() => setSetupProviderEnabled(paths, id, !p.enabled));
      } else if (choice === rows.length + 3) await liveTest(id);
      else if (choice === rows.length + 4 && id === "searxng") await addInstances(true);
      else await languageMenu();
    }
  };
  const saveOrder = async (old: ProviderId[], next: ProviderId[]) => {
    if (!next.length) { say(m("nonemptyOrder")); return; }
    const involved = [...old, ...next];
    const privacyChanged = old.join(",") !== next.join(",") && involved.includes("searxng") && involved.some(id => id === "exa" || id === "tavily" || id === "firecrawl");
    if (privacyChanged && !await confirm(m("routingConsent", { old: old.join(" → "), next: next.join(" → ") }))) return;
    await mutate(() => setSetupProviderOrder(paths, next));
  };
  const orderMenu = async () => {
    for (;;) {
      const current = await snapshot(); const order = current.providerOrder;
      const choice = await menu(m("orderTitle", { order: order.join(" → ") }), [m("moveEarlier"), m("moveLater"), m("removeOrder"), m("includeProvider")]);
      if (!choice) return;
      if (choice === 4) {
        const available = current.providers.filter(p => !order.includes(p.id) && (p.keys.some(k => k.available) || p.instances.length));
        const selected = await menu(m("includeTitle"), available.map(p => p.id));
        if (selected) await saveOrder(order, [...order, available[selected - 1]!.id]);
      } else {
        const selected = await menu(m("selectOrder"), order);
        if (!selected) continue;
        const index = selected - 1; const next = [...order];
        if (choice === 3) next.splice(index, 1);
        else { const target = index + (choice === 1 ? -1 : 1); if (target < 0 || target >= next.length) { say(m("boundary")); continue; } [next[index], next[target]] = [next[target]!, next[index]!]; }
        await saveOrder(order, next);
      }
    }
  };
  try {
    if (options.provider) { await providerMenu(options.provider as SetupProvider); return; }
    for (;;) {
      const current = await snapshot();
      const rows = PROVIDERS.map(id => {
        const p = current.providers.find(p => p.id === id)!;
        const name = { exa: "Exa", tavily: "Tavily", firecrawl: "Firecrawl", searxng: "SearXNG" }[id];
        return `${name} — ${m("configuredCount", { count: id === "searxng" ? p.instances.length : p.keys.filter(k => k.available).length })}${p.enabled ? "" : `; ${m("disabled")}`}`;
      });
      const choice = await menu(m("dashboard"), [...rows, m("manageOrder"), m("localCheck"), "Language / 语言"]);
      if (!choice) return;
      if (choice <= 4) await providerMenu(PROVIDERS[choice - 1]!);
      if (choice === 5) await orderMenu();
      if (choice === 6) { await snapshot(); say(m("localChecked")); }
      if (choice === 7) await languageMenu();
    }
  } catch (error) {
    if (error instanceof SetupCancelled || (error instanceof Error && error.message === "Setup cancelled.")) say(m("cancelled"));
    else { report(error, language); process.exitCode = 1; }
  } finally {
    terminal.close();
    for (const notice of notices) process.stdout.write(`${notice}\n`);
  }
}

const privateNetworks = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) privateNetworks.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) privateNetworks.addSubnet(ip, prefix, "ipv6");
function privateAddress(host: string, family: number) { return privateNetworks.check(host, family === 4 ? "ipv4" : "ipv6"); }
