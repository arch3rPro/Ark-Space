import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config/store.js";
import type { ArkSpacePaths } from "../config/paths.js";
import type { UseGptHubStore } from "../usegpt/hub-store.js";
import { useGptFailure, useGptSuccess, type UseGptEnvelope, type UseGptCapability } from "../protocol/usegpt-schema.js";
import { MAX_REQUEST_BYTES, capabilityOf, parseRequest } from "../usegpt/contracts.js";

// Store failures are deliberately mapped without interpolating filesystem or input details.
const HUB_RUNTIME = [22, 13, 0] as const;

function supportsUseGptHub(): boolean {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  return major > HUB_RUNTIME[0] || major === HUB_RUNTIME[0] && (minor > HUB_RUNTIME[1] || minor === HUB_RUNTIME[1] && patch >= HUB_RUNTIME[2]);
}

const hubErrors: Record<string, string> = {
  invalid_input: "Invalid Artifact Hub input.", invalid_range: "Invalid artifact byte range.",
  project_not_found: "Project not found.", project_deleted: "Project is deleted; restore it before use.",
  project_mismatch: "Objects must belong to the same project.", project_archived: "Project is archived.",
  task_not_found: "Task not found.", task_deleted: "Task is deleted; restore it before use.", task_terminal: "Task is already terminal.",
  artifact_not_found: "Artifact revision not found.", artifact_deleted: "Artifact is deleted.",
  artifact_content_corrupt: "Artifact content failed integrity verification.",
  handoff_not_found: "Handoff not found.", handoff_busy: "A handoff is active; settle it before this operation.",
  handoff_fenced: "The handoff claim is stale or invalid.", handoff_unavailable: "Handoff is unavailable for this consumer.",
  handoff_terminal: "Handoff is already terminal.", idempotency_conflict: "Idempotency key was already used with different input.",
  quota_exceeded: "Artifact Hub storage quota exceeded.", unsafe_path: "Artifact Hub storage path is unsafe.",
  schema_too_new: "Artifact Hub database requires a newer ArkSpace version.",
  not_deleted: "Delete this object before permanently purging it.",
};

export async function executeUseGpt(request: unknown, paths: ArkSpacePaths, _environment: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<UseGptEnvelope> {
  let capability: UseGptCapability = "usegpt.connection.status";
  let input: Record<string, unknown>;
  try {
    capability = capabilityOf(request);
    const parsed = parseRequest(request);
    input = parsed.input;
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) throw new Error();
  } catch { return useGptFailure(capability, "invalid-request", "Invalid UseGPT request."); }
  if (capability === "usegpt.task.start" || capability === "usegpt.task.follow_up" || capability === "usegpt.artifact.get") {
    return useGptFailure(capability, "unsupported", "Legacy ChatGPT browser execution is unsupported. Use project.create, task.create, and artifact.publish_inline with the Artifact Hub.");
  }
  if (!supportsUseGptHub()) return useGptFailure(capability, "runtime-unsupported", "Artifact Hub requires Node.js 22.13.0 or newer.");
  let dataDir: string;
  try {
    const config = await loadConfig(paths.config);
    const connection = config.connections?.usegpt;
    if (!connection?.enabled || config.tools[capability]?.enabled === false) return useGptFailure(capability, "config", "Enable UseGPT and this capability in ArkSpace configuration.");
    dataDir = connection.dataDir ?? join(homedir(), ".arkspace", "usegpt");
  } catch { return useGptFailure(capability, "config", "Invalid Artifact Hub configuration."); }
  let store: UseGptHubStore | undefined;
  try {
    signal?.throwIfAborted();
    const { UseGptHubStore } = await import("../usegpt/hub-store.js");
    store = await UseGptHubStore.open(dataDir);
    if (capability === "usegpt.connection.status") return useGptSuccess(capability, { ready: true, storage: "local", browserExecution: "unsupported" });
    const operation = capability.slice("usegpt.".length);
    if (operation === "task.wait") {
      // A wait observes persisted task state; its deadline never cancels the task.
      const deadline = Date.now() + Number(input.timeoutMs);
      for (;;) {
        signal?.throwIfAborted();
        const task = await store.execute("task.get", { taskId: input.taskId });
        if (["completed", "failed", "cancelled", "deleted"].includes(String(task.status))) return useGptSuccess(capability, { ...task, waitOutcome: "terminal" });
        const remaining = deadline - Date.now();
        if (remaining <= 0) return useGptSuccess(capability, { ...task, waitOutcome: "timeout" });
        await delay(Math.min(200, remaining), undefined, { signal });
      }
    }
    signal?.throwIfAborted();
    return useGptSuccess(capability, await store.execute(operation, input));
  } catch (error) {
    if (signal?.aborted) return useGptFailure(capability, "cancelled", "Artifact Hub request cancelled.");
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return useGptFailure(capability, hubErrors[code] ? code : "storage", hubErrors[code] ?? "Artifact Hub operation failed.");
  } finally { await store?.close(); }
}
