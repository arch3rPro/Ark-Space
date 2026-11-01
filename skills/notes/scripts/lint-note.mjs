#!/usr/bin/env node
// Advisory lint for notes written by the notes Skill. Checks form only, never factual correctness.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = ["note", "tool-research"];
const LANGS = ["zh", "en"];
const STATUSES = ["draft", "verified", "outdated"];
const REQUIRED = ["title", "type", "lang", "sources", "status", "updated"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SECTION_CHARS = 2000;
const HEADINGS = {
  zh: { sources: ["来源"], confirm: ["待确认"] },
  en: { sources: ["Sources"], confirm: ["To confirm"] },
};
const OPENINGS = {
  zh: ["此外", "上述", "如上", "另外", "同上", "其次", "它", "这个"],
  en: ["Also", "As above", "The above", "It ", "This ", "These ", "They ", "However"],
};

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: node lint-note.mjs <file> [--lang zh|en] [--lexicon <file>]... [--root <dir>] [--json]\n",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = { file: undefined, lang: undefined, lexicons: [], root: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--lang" || arg === "--lexicon" || arg === "--root") {
      const value = argv[++i];
      if (value === undefined) usage(`${arg} needs a value`);
      if (arg === "--lang") {
        if (!LANGS.includes(value)) usage(`--lang must be one of ${LANGS.join(", ")}`);
        options.lang = value;
      } else if (arg === "--lexicon") options.lexicons.push(value);
      else options.root = value;
    } else if (arg.startsWith("--")) usage(`unknown option ${arg}`);
    else if (options.file === undefined) options.file = arg;
    else usage("only one note file is accepted");
  }
  if (!options.file) usage("missing note file");
  return options;
}

function readLexicon(path, required) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (!required && error.code === "ENOENT") return undefined;
    usage(`cannot read lexicon ${path}: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    usage(`invalid JSON in lexicon ${path}: ${error.message}`);
  }
  for (const key of ["hedges", "allow"]) {
    const list = data?.[key] ?? [];
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || !item))
      usage(`lexicon ${path}: "${key}" must be an array of non-empty strings`);
  }
  return { hedges: data.hedges ?? [], allow: data.allow ?? [] };
}

function mergeLexicons(layers) {
  const hedges = new Set();
  const allow = new Set();
  for (const layer of layers) {
    layer.hedges.forEach((word) => hedges.add(word));
    layer.allow.forEach((word) => allow.add(word));
  }
  for (const word of allow) hedges.delete(word);
  return { hedges: [...hedges], allow: [...allow] };
}

function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return { data: undefined, end: 0 };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return { data: undefined, end: 0 };
  const data = {};
  let listKey;
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
      listKey = undefined;
    } else {
      data[key] = unquote(value.trim());
      listKey = undefined;
    }
  }
  return { data, end: end + 1 };
}

function unquote(value) {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

// Marks which lines are prose (not fenced code, not block quote).
function proseMask(lines, start) {
  let fence;
  return lines.map((line, i) => {
    if (i < start) return false;
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      return false;
    }
    return !fence && !/^\s*>/.test(line);
  });
}

function hedgeMatcher(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[\x20-\x7e]+$/.test(word) ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "g");
}

function collectNoteTargets(root) {
  const targets = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md")) {
        targets.add(basename(entry.name, ".md"));
        const { data } = parseFrontmatter(readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n"));
        if (data?.title) targets.add(data.title);
        for (const alias of Array.isArray(data?.aliases) ? data.aliases : []) targets.add(alias);
      }
    }
  };
  walk(root);
  return targets;
}

export function lintNote(text, { lang, lexicon, root }) {
  const diagnostics = [];
  const add = (severity, rule, line, message) => diagnostics.push({ severity, rule, line, message });
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { data, end } = parseFrontmatter(lines);

  if (!data) add("error", "frontmatter-missing", 1, "note must start with a frontmatter block");
  else {
    for (const key of REQUIRED)
      if (data[key] === undefined || data[key] === "" || (Array.isArray(data[key]) && !data[key].length))
        add("error", "frontmatter-required", 1, `frontmatter field "${key}" is missing or empty`);
    for (const [key, allowed] of [["type", TYPES], ["lang", LANGS], ["status", STATUSES]])
      if (data[key] && !allowed.includes(data[key]))
        add("error", "frontmatter-value", 1, `"${key}" must be one of ${allowed.join(", ")}`);
    for (const key of ["retrieved", "updated"])
      if (data[key] && !DATE.test(data[key]))
        add("error", "frontmatter-date", 1, `"${key}" must be YYYY-MM-DD`);
    if (data.status === "verified" && !data.retrieved)
      add("error", "verified-without-retrieved", 1, 'status "verified" requires a "retrieved" date');
  }

  const effectiveLang = lang ?? (LANGS.includes(data?.lang) ? data.lang : "zh");
  const names = HEADINGS[effectiveLang];
  const prose = proseMask(lines, end);

  const headings = [];
  lines.forEach((line, i) => {
    const match = prose[i] && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (match) headings.push({ level: match[1].length, text: match[2], line: i + 1, index: i });
  });

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) add("error", "heading-h1", h1s[1]?.line ?? 1, "note needs exactly one H1");
  else if (data?.title && h1s[0].text !== data.title)
    add("warning", "heading-h1-title", h1s[0].line, "H1 should equal frontmatter title");
  headings.forEach((h, i) => {
    const previous = headings[i - 1]?.level ?? 0;
    if (h.level > previous + 1)
      add("error", "heading-level", h.line, `heading level jumps from H${previous} to H${h.level}`);
  });

  const h2s = headings.filter((h) => h.level === 2);
  if (!h2s.some((h) => h.text === "TL;DR")) add("error", "tldr-missing", 1, 'missing "## TL;DR" section');
  if (!h2s.some((h) => names.sources.includes(h.text)))
    add("error", "sources-missing", 1, `missing "## ${names.sources[0]}" section`);

  const special = new Set(["TL;DR", ...names.sources, ...names.confirm]);
  h2s.forEach((h) => {
    const next = headings.find((other) => other.index > h.index && other.level <= 2);
    const body = lines.slice(h.index + 1, next?.index ?? lines.length);
    const length = body.join("").replace(/\s/g, "").length;
    if (length > MAX_SECTION_CHARS)
      add("warning", "section-length", h.line, `section "${h.text}" has ${length} characters; split it`);
    if (special.has(h.text)) return;
    const first = body.find((line) => line.trim())?.trim() ?? "";
    const opening = OPENINGS[effectiveLang].find((word) => first.startsWith(word));
    if (opening)
      add("warning", "section-opening", h.line, `section "${h.text}" opens with "${opening.trim()}"; name the subject instead`);
  });

  const matchers = lexicon.hedges.map((word) => [word, hedgeMatcher(word)]);
  lines.forEach((line, i) => {
    if (!prose[i]) return;
    let scan = line.replace(/`[^`]*`/g, " ");
    for (const phrase of lexicon.allow) scan = scan.split(phrase).join(" ");
    for (const [word, pattern] of matchers) {
      pattern.lastIndex = 0;
      if (pattern.test(scan)) add("warning", "hedge", i + 1, `hedge "${word}": state it as verified, inferred, or to confirm`);
    }
  });

  if (root) {
    const targets = collectNoteTargets(root);
    lines.forEach((line, i) => {
      if (!prose[i]) return;
      for (const match of line.replace(/`[^`]*`/g, " ").matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
        const target = match[1].trim();
        if (!targets.has(target)) add("error", "broken-link", i + 1, `[[${target}]] resolves to no note under the root`);
      }
    });
  }

  return diagnostics.sort((a, b) => a.line - b.line);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let text;
  try {
    text = readFileSync(options.file, "utf8");
  } catch (error) {
    usage(`cannot read ${options.file}: ${error.message}`);
  }
  const frontmatterLang = parseFrontmatter(text.replace(/\r\n/g, "\n").split("\n")).data?.lang;
  const lang = options.lang ?? (LANGS.includes(frontmatterLang) ? frontmatterLang : "zh");
  const layers = [
    readLexicon(fileURLToPath(new URL(`./lexicons/${lang}.json`, import.meta.url)), true),
    ...options.lexicons.map((path) => readLexicon(path, true)),
  ];
  const local = readLexicon(join(dirname(resolve(options.file)), ".notes-lint.json"), false);
  if (local) layers.push(local);

  const diagnostics = lintNote(text, {
    lang,
    lexicon: mergeLexicons(layers),
    root: options.root ? resolve(options.root) : undefined,
  });
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;

  if (options.json) process.stdout.write(`${JSON.stringify({ file: options.file, errors, warnings, diagnostics }, null, 2)}\n`);
  else {
    for (const d of diagnostics) process.stdout.write(`${options.file}:${d.line}: ${d.severity} [${d.rule}] ${d.message}\n`);
    process.stdout.write(`${errors} error(s), ${warnings} warning(s)\n`);
  }
  process.exit(errors ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
