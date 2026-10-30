import type { DatabaseSync } from "node:sqlite";

export const HUB_SCHEMA_VERSION = 2;
const SCHEMA = `
CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
 previous_status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, request TEXT NOT NULL,
 status TEXT NOT NULL, previous_status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0), created_at TEXT NOT NULL);
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), owner_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 name TEXT NOT NULL, kind TEXT NOT NULL, media_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', created_at TEXT NOT NULL
);
CREATE TABLE artifact_revisions (
 artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision > 0),
 sha256 TEXT NOT NULL REFERENCES blobs(sha256), size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(artifact_id, revision)
);
CREATE TABLE task_artifacts (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, artifact_id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(task_id,artifact_id,revision),
 FOREIGN KEY(artifact_id,revision) REFERENCES artifact_revisions(artifact_id,revision) ON DELETE CASCADE
);
CREATE TABLE project_artifacts (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, artifact_id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(project_id,artifact_id,revision),
 FOREIGN KEY(artifact_id,revision) REFERENCES artifact_revisions(artifact_id,revision) ON DELETE CASCADE
);
CREATE TABLE handoffs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 sender TEXT NOT NULL, recipient TEXT NOT NULL, instruction TEXT NOT NULL, status TEXT NOT NULL,
 claim_token TEXT, generation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE handoff_artifacts (
 handoff_id TEXT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE, artifact_id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(handoff_id,artifact_id,revision),
 FOREIGN KEY(artifact_id,revision) REFERENCES artifact_revisions(artifact_id,revision) ON DELETE CASCADE
);
CREATE TABLE outbox_events (
 cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, object_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE idempotency (
 scope TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
 PRIMARY KEY(scope,operation,key)
);
CREATE TABLE delete_jobs (sha256 TEXT PRIMARY KEY REFERENCES blobs(sha256) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE INDEX tasks_project_idx ON tasks(project_id,created_at,id);
CREATE INDEX artifacts_project_idx ON artifacts(project_id,created_at,id);
CREATE INDEX revisions_blob_idx ON artifact_revisions(sha256);
CREATE INDEX task_artifacts_artifact_idx ON task_artifacts(artifact_id,revision);
CREATE INDEX handoff_artifacts_artifact_idx ON handoff_artifacts(artifact_id,revision);
CREATE INDEX handoffs_recipient_idx ON handoffs(recipient,status,created_at,id);
CREATE INDEX events_project_idx ON outbox_events(project_id,cursor);
CREATE INDEX events_task_idx ON outbox_events(task_id,cursor);
`;

/** Called under BEGIN IMMEDIATE; version zero may contain the original prototype. */
export function migrateHubSchema(db: DatabaseSync): void {
  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (version > HUB_SCHEMA_VERSION) throw new Error("schema_too_new: Hub database was created by a newer version.");
  if (version === HUB_SCHEMA_VERSION) return;
  if (version === 1) {
    db.exec(`CREATE TABLE uploads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT REFERENCES tasks(id),
      reserved_bytes INTEGER NOT NULL, idempotency_key TEXT, expires_at TEXT NOT NULL
    ); PRAGMA user_version=2;`);
    return;
  }
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artifacts'").get();
  if (legacy) {
    db.exec("ALTER TABLE projects RENAME TO legacy_projects; ALTER TABLE tasks RENAME TO legacy_tasks; ALTER TABLE blobs RENAME TO legacy_blobs; ALTER TABLE artifacts RENAME TO legacy_artifacts;");
    db.exec("DROP INDEX IF EXISTS tasks_project_idx; DROP INDEX IF EXISTS artifacts_task_idx;");
  }
  db.exec(SCHEMA);
  if (legacy) db.exec(`
    INSERT INTO projects SELECT id,name,COALESCE(description,''),status,CASE WHEN status='deleted' THEN 'active' END,created_at,updated_at FROM legacy_projects;
    INSERT INTO tasks SELECT id,project_id,title,request,status,CASE WHEN status='deleted' THEN 'queued' END,created_at,updated_at FROM legacy_tasks;
    INSERT INTO blobs SELECT * FROM legacy_blobs;
    INSERT INTO artifacts SELECT id,project_id,task_id,name,kind,media_type,'available',created_at FROM legacy_artifacts;
    INSERT INTO artifact_revisions SELECT id,revision,sha256,size_bytes,created_at FROM legacy_artifacts;
    INSERT INTO task_artifacts SELECT task_id,id,revision FROM legacy_artifacts WHERE task_id IS NOT NULL;
    INSERT INTO project_artifacts SELECT project_id,id,revision FROM legacy_artifacts WHERE task_id IS NULL;
    DROP TABLE legacy_artifacts; DROP TABLE legacy_tasks; DROP TABLE legacy_projects; DROP TABLE legacy_blobs;
  `);
  db.exec(`CREATE TABLE uploads (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT REFERENCES tasks(id),
    reserved_bytes INTEGER NOT NULL, idempotency_key TEXT, expires_at TEXT NOT NULL
  );`);
  db.exec(`PRAGMA user_version = ${HUB_SCHEMA_VERSION}`);
}
