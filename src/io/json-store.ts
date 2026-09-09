import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const RETRY_DELAY_MS = 20;

interface LockRecord {
  token: string;
  createdAt: number;
  pid: number;
}

export async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function writePrivateFileExclusive(path: string, content: string): Promise<void> {
  await withPrivateFileReservation(path, async (write) => write(content));
}

export async function withPrivateFileReservation<T>(
  path: string,
  action: (write: (content: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  let committed = false;
  try {
    const result = await action(async (content) => {
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      committed = true;
    });
    if (!committed) throw new Error(`Private file reservation was not committed: ${path}`);
    return result;
  } catch (error) {
    await handle.close();
    await rm(path, { force: true });
    throw error;
  } finally {
    if (committed) await handle.close();
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function withFileLock<T>(
  path: string,
  action: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_LOCK_MS;
  const lockPath = `${path}.lock`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  while (!(await tryAcquire(lockPath, token))) {
    await removeStaleLock(lockPath, staleMs);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for state lock: ${lockPath}`);
    await sleep(RETRY_DELAY_MS);
  }

  try {
    return await action();
  } finally {
    await releaseLock(lockPath, token);
  }
}

async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      const record: LockRecord = { token, createdAt: Date.now(), pid: process.pid };
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return false;
    throw error;
  }
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<void> {
  let record: LockRecord;
  try {
    record = JSON.parse(await readFile(lockPath, "utf8")) as LockRecord;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    return;
  }
  if (typeof record.createdAt !== "number" || Date.now() - record.createdAt <= staleMs) return;
  const stalePath = `${lockPath}.${randomUUID()}.stale`;
  try {
    await rename(lockPath, stalePath);
    await rm(stalePath, { force: true });
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath, "utf8")) as LockRecord;
    if (current.token === token) await rm(lockPath, { force: true });
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
