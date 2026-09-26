import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, parse } from "node:path";

import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { WebFetchData } from "../protocol/types.js";

export interface CacheBounds { ttlSeconds: number; maxCount: number; maxBytes: number }
interface Entry { content: string; expiresAt: number; createdAt: number }
type Entries = Record<string, Entry>;
const ID = /^[a-f0-9]{32}$/;
const FILE = "web-responses.json";

async function cachePath(statePath: string): Promise<string> {
  const directory = resolve(dirname(statePath));
  // Never follow a symlink in the cache directory chain, including the home directory.
  const parts: string[] = [];
  let cursor = directory;
  while (cursor !== parse(cursor).root) {
    parts.unshift(cursor);
    cursor = dirname(cursor);
  }
  for (const part of parts) {
    try {
      const info = await lstat(part);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe response cache directory.");
      if (part === directory && (info.mode & 0o077) !== 0) throw new Error("Response cache directory must be private.");
    } catch (error) {
      if (isMissing(error) && part === directory) await mkdir(part, { mode: 0o700 });
      else throw error;
    }
  }
  const path = join(directory, FILE);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error("Unsafe response cache file.");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return path;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readEntries(path: string): Promise<Entries> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if (isMissing(error)) return {}; throw error; }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response cache.");
  const entries: Entries = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!ID.test(id) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid response cache.");
    const e = entry as Partial<Entry>;
    if (typeof e.content !== "string" || !Number.isFinite(e.expiresAt) || !Number.isFinite(e.createdAt)) throw new Error("Invalid response cache.");
    entries[id] = e as Entry;
  }
  return entries;
}

function size(entries: Entries): number { return Buffer.byteLength(JSON.stringify(entries), "utf8"); }

export async function cacheFetchResults(data: WebFetchData, statePath: string, bounds: CacheBounds): Promise<WebFetchData> {
  if (!data.results.length) return data;
  const path = await cachePath(statePath);
  return withFileLock(path, async () => {
    const entries = await readEntries(path);
    const now = Date.now();
    for (const [id, entry] of Object.entries(entries)) if (entry.expiresAt <= now) delete entries[id];
    const results = data.results.map((result) => {
      const id = randomUUID().replaceAll("-", "");
      const entry = { content: result.content, createdAt: now, expiresAt: now + bounds.ttlSeconds * 1_000 };
      if (size({ [id]: entry }) > bounds.maxBytes) return result;
      entries[id] = entry;
      return { ...result, responseId: id };
    });
    // Oldest first, deterministic even for entries written in the same millisecond.
    for (const id of Object.keys(entries).sort((a, b) => entries[a]!.createdAt - entries[b]!.createdAt)) {
      if (Object.keys(entries).length <= bounds.maxCount && size(entries) <= bounds.maxBytes) break;
      delete entries[id];
    }
    await writeJsonAtomic(path, entries);
    return { ...data, results: results.map((result) => {
      if (!result.responseId || entries[result.responseId]) return result;
      const { responseId: _discard, ...withoutId } = result;
      return withoutId;
    }) };
  });
}

export async function getCachedContent(responseId: string, statePath: string): Promise<string | undefined> {
  if (!ID.test(responseId)) return undefined;
  const path = await cachePath(statePath);
  return withFileLock(path, async () => {
    // Recheck after acquiring the lock, before opening the file.
    await cachePath(statePath);
    const entry = (await readEntries(path))[responseId];
    return entry && entry.expiresAt > Date.now() ? entry.content : undefined;
  });
}
