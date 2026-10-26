import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";

export interface HubProject { id: string; name: string; description?: string; status: "active" | "deleted"; createdAt: string; updatedAt: string; }
export interface HubTask { id: string; projectId: string; title: string; request: string; status: "queued" | "active" | "completed" | "failed" | "deleted"; createdAt: string; updatedAt: string; }
export interface HubArtifact { id: string; projectId: string; taskId?: string; name: string; kind: string; mediaType: string; revision: number; sha256: string; sizeBytes: number; createdAt: string; }

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'active', 'completed', 'failed', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id, revision)
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id, created_at);
CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(task_id, created_at);
`;

export class UseGptHubStore {
  readonly database: DatabaseSync;
  readonly blobDir: string;
  private readonly lockPath: string;

  constructor(readonly dataDir: string) {
    this.blobDir = join(dataDir, "objects", "sha256");
    this.lockPath = join(dataDir, ".writer.lock");
    this.database = new DatabaseSync(join(dataDir, "index.sqlite"));
    this.database.exec(SCHEMA);
  }

  async close(): Promise<void> { this.database.close(); }

  createProject(name: string, description = ""): HubProject {
    const now = new Date().toISOString();
    const project = { id: `project_${randomUUID()}`, name, description, status: "active", createdAt: now, updatedAt: now } as const;
    this.database.prepare("INSERT INTO projects (id,name,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(project.id, project.name, project.description, project.status, now, now);
    return project;
  }

  createTask(projectId: string, title: string, request: string): HubTask {
    const now = new Date().toISOString();
    const task = { id: `task_${randomUUID()}`, projectId, title, request, status: "queued", createdAt: now, updatedAt: now } as const;
    this.database.prepare("INSERT INTO tasks (id,project_id,title,request,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(task.id, task.projectId, task.title, task.request, task.status, now, now);
    return task;
  }

  listTasks(projectId: string): HubTask[] {
    // SAFETY: SQL aliases match HubTask fields and status is constrained by the table.
    return this.database.prepare("SELECT id, project_id AS projectId, title, request, status, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE project_id = ? AND status <> 'deleted' ORDER BY created_at DESC").all(projectId) as unknown as HubTask[];
  }

  async publishText(input: { projectId: string; taskId?: string; name: string; kind?: string; mediaType?: string; content: string }): Promise<HubArtifact> {
    const bytes = Buffer.from(input.content, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const now = new Date().toISOString();
    const artifact: HubArtifact = { id: `artifact_${randomUUID()}`, projectId: input.projectId, ...(input.taskId ? { taskId: input.taskId } : {}), name: input.name, kind: input.kind ?? "document", mediaType: input.mediaType ?? "text/plain", revision: 1, sha256, sizeBytes: bytes.byteLength, createdAt: now };
    await this.withWriter(async () => {
      await mkdir(join(this.blobDir, sha256.slice(0, 2), sha256.slice(2, 4)), { recursive: true, mode: 0o700 });
      const target = join(this.blobDir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
      try { await readFile(target); } catch {
        const partial = `${target}.${randomUUID()}.partial`;
        await open(partial, "wx", 0o600).then(async handle => { try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } });
        try { await rename(partial, target); } catch (error) { await rm(partial, { force: true }); if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.prepare("INSERT OR IGNORE INTO blobs (sha256,size_bytes,created_at) VALUES (?,?,?)").run(sha256, bytes.byteLength, now);
        this.database.prepare("INSERT INTO artifacts (id,project_id,task_id,name,kind,media_type,revision,sha256,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(artifact.id, artifact.projectId, artifact.taskId ?? null, artifact.name, artifact.kind, artifact.mediaType, artifact.revision, artifact.sha256, artifact.sizeBytes, now);
        this.database.exec("COMMIT");
      } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    });
    return artifact;
  }

  async readArtifact(artifactId: string): Promise<string> {
    const row = this.database.prepare("SELECT sha256 FROM artifacts WHERE id = ?").get(artifactId) as { sha256?: string } | undefined;
    if (!row?.sha256) throw new Error("Artifact not found.");
    return readFile(join(this.blobDir, row.sha256.slice(0, 2), row.sha256.slice(2, 4), row.sha256), "utf8");
  }

  private async withWriter<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    const handle = await open(this.lockPath, "wx", 0o600);
    try { return await action(); } finally { await handle.close(); await rm(this.lockPath, { force: true }); }
  }
}
