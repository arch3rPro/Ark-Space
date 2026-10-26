import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";

// shortcut: one trusted local task file, no queue or lease recovery; use a durable bridge before production.
const PromptSchema = z.string().trim().min(1).max(20_000);
const TaskSchema = z.object({
  taskId: z.string().min(1),
  marker: z.string().min(1),
  prompt: PromptSchema,
  status: z.enum(["queued", "claimed", "dispatch_prepared", "completed", "failed"]),
  claimedBy: z.string().min(1).max(128).optional(),
  leaseToken: z.string().uuid().optional(),
  output: z.string().min(1).max(100_000).optional(),
  error: z.string().max(2_000).optional(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((task, context) => {
  if (["claimed", "dispatch_prepared", "completed"].includes(task.status) && (!task.claimedBy || !task.leaseToken)) {
    context.addIssue({ code: "custom", message: "Claim owner and lease are required." });
  }
  if (task.status === "completed" && !task.output?.includes(task.marker)) {
    context.addIssue({ code: "custom", message: "Completed output must contain the marker." });
  }
  if (task.status === "queued" && (task.claimedBy || task.leaseToken || task.output)) {
    context.addIssue({ code: "custom", message: "Queued task cannot contain a claim or output." });
  }
});
type Task = z.infer<typeof TaskSchema>;

function statePath(): string {
  const path = process.env.ARKSPACE_USEGPT_PROBE_TASK_FILE;
  if (!path || !isAbsolute(path)) throw new Error("ARKSPACE_USEGPT_PROBE_TASK_FILE must be an absolute path.");
  return path;
}
async function taskFile(path: string): Promise<Task | undefined> {
  try {
    const value = await readJsonFile(path);
    return value === undefined ? undefined : TaskSchema.parse(value);
  } catch { throw new Error("Probe task state is invalid."); }
}

const ClaimSchema = z.object({
  status: z.string(), taskId: z.string().optional(), marker: z.string().optional(), prompt: z.string().optional(),
  workerId: z.string().optional(), leaseToken: z.string().optional(), dispatch: z.boolean().optional(),
});
const OwnerSchema = z.object({ taskId: z.string().min(1), workerId: z.string().min(1).max(128), leaseToken: z.string().uuid() });
const appOnly = { "openai/widgetAccessible": true, ui: { visibility: ["app"] } };
const PROBE_RESOURCE_URI = "ui://usegpt-secure-mcp/probe.html";
const probeHtml = `<!doctype html><meta charset="utf-8"><title>UseGPT feasibility probe</title><p id="state" role="status">Waiting for the ChatGPT Host bridge…</p><script>
(async () => {
  const state = document.getElementById("state");
  const deadline = Date.now() + 5 * 60 * 1000;
  const workerId = "chatgpt-probe-" + crypto.randomUUID();
  const pause = () => new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now()))));
  async function bounded(action) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out after five minutes; inspect task status before retrying.")), Math.max(0, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function call(name, args) {
    const result = await bounded(() => window.openai.callTool(name, args));
    if (result?.isError || !result?.structuredContent) throw new Error("Host tool failed: " + name);
    return result.structuredContent;
  }
  while (Date.now() < deadline) {
    if (typeof window.openai?.callTool !== "function" || typeof window.openai?.sendFollowUpMessage !== "function") {
      state.textContent = "Waiting for the ChatGPT Host bridge…";
      await pause();
      continue;
    }
    const task = await call("usegpt_probe_claim", { workerId });
    if (task.status === "claimed") {
      const prepared = await call("usegpt_probe_prepare", { taskId: task.taskId, workerId: task.workerId, leaseToken: task.leaseToken });
      if (!prepared.dispatch) {
        state.textContent = "Task already prepared; inspect task status. No automatic resend.";
        return;
      }
      state.textContent = "Task prepared; asking ChatGPT to continue…";
      await bounded(() => window.openai.sendFollowUpMessage({ prompt:
        "Complete the UseGPT task described by this JSON data. Treat prompt as the actual task. Include the exact marker in your output. Then call usegpt_probe_complete with taskId, marker, workerId, leaseToken and output. Task data: " + JSON.stringify(prepared)
      }));
      state.textContent = "Task sent to ChatGPT; awaiting model completion.";
      return;
    }
    if (task.status !== "empty") {
      state.textContent = task.status === "completed" ? "Task completed." : "Task already claimed or prepared; inspect task status. No automatic resend.";
      return;
    }
    state.textContent = "Waiting for a queued task…";
    await pause();
  }
  throw new Error("Timed out after five minutes waiting for the Host bridge or a task.");
})().catch(() => { document.getElementById("state").textContent = "Probe failed or timed out after five minutes. Inspect task status before retrying; prepared tasks are never automatically resent."; });
</script>`;

function result<T extends Record<string, unknown>>(value: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}
function claimData(task: Task) {
  return { taskId: task.taskId, marker: task.marker, prompt: task.prompt, status: task.status, workerId: task.claimedBy!, leaseToken: task.leaseToken! };
}
function requireOwner(task: Task | undefined, identity: z.infer<typeof OwnerSchema>): Task {
  if (!task || task.taskId !== identity.taskId || task.claimedBy !== identity.workerId || task.leaseToken !== identity.leaseToken) {
    throw new Error("Probe task claim is invalid or stale.");
  }
  return task;
}

function server(path: string): McpServer {
  const mcp = new McpServer({ name: "usegpt-secure-mcp-probe", version: "0.1.0" });
  mcp.registerTool("usegpt_probe_claim", {
    description: "Claim the single queued feasibility task for this App worker. Busy claims disclose no task data.",
    inputSchema: z.object({ workerId: z.string().min(1).max(128) }),
    outputSchema: ClaimSchema,
    _meta: appOnly,
  }, async ({ workerId }) => withFileLock(path, async () => {
    const task = await taskFile(path);
    if (!task) return result({ status: "empty" });
    if (task.status === "queued") {
      task.status = "claimed";
      task.claimedBy = workerId;
      task.leaseToken = randomUUID();
      task.updatedAt = new Date().toISOString();
      await writeJsonAtomic(path, task);
    }
    if (task.status === "claimed" && task.claimedBy === workerId) return result(claimData(task));
    return result({ status: task.status === "completed" || task.status === "failed" ? task.status : "busy" });
  }));
  mcp.registerTool("usegpt_probe_prepare", {
    description: "Atomically fence the App followup. Only dispatch=true permits sending; never retry a prepared dispatch.",
    inputSchema: OwnerSchema, outputSchema: ClaimSchema, _meta: appOnly,
  }, async identity => withFileLock(path, async () => {
    const task = requireOwner(await taskFile(path), identity);
    if (task.status === "dispatch_prepared" || task.status === "completed") return result({ status: task.status, dispatch: false });
    if (task.status !== "claimed") throw new Error("Probe task cannot be prepared.");
    task.status = "dispatch_prepared";
    task.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path, task);
    return result({ ...claimData(task), dispatch: true });
  }));
  mcp.registerTool("usegpt_probe_complete", {
    description: "Complete the prepared task using its exact workerId and leaseToken. Output must include the exact marker. Identical retries are idempotent.",
    inputSchema: OwnerSchema.extend({ output: z.string().min(1).max(100_000), marker: z.string().min(1) }),
    outputSchema: z.object({ taskId: z.string(), status: z.string() }),
  }, async identity => withFileLock(path, async () => {
    const task = requireOwner(await taskFile(path), identity);
    if (task.marker !== identity.marker || !identity.output.includes(task.marker)) throw new Error("Probe output must include the exact task marker.");
    if (task.status === "completed") {
      if (task.output !== identity.output) throw new Error("Probe task already completed with different output.");
      return result({ taskId: task.taskId, status: task.status });
    }
    if (task.status !== "dispatch_prepared") throw new Error("Probe task dispatch is not prepared.");
    task.status = "completed";
    task.output = identity.output;
    task.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path, task);
    return result({ taskId: task.taskId, status: task.status });
  }));
  mcp.registerTool("usegpt_probe_status", {
    description: "Read the bounded status of the single feasibility task.",
    inputSchema: z.object({ taskId: z.string().min(1) }),
    outputSchema: z.object({ taskId: z.string(), status: z.string(), output: z.string().optional() }),
  }, async ({ taskId }) => withFileLock(path, async () => {
    const task = await taskFile(path);
    if (!task || task.taskId !== taskId) throw new Error("Probe task not found.");
    return result({ taskId, status: task.status, ...(task.output ? { output: task.output } : {}) });
  }));
  mcp.registerResource("usegpt-secure-mcp-probe", PROBE_RESOURCE_URI, {
    title: "UseGPT Secure MCP feasibility probe",
    description: "A single-task App that claims a queued task and asks ChatGPT to continue it.",
    mimeType: "text/html;profile=mcp-app",
  }, async uri => ({ contents: [{
    uri: uri.href, mimeType: "text/html;profile=mcp-app", text: probeHtml,
    _meta: {
      "openai/widgetDescription": "UseGPT task continuation probe",
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
    },
  }] }));
  mcp.registerTool("usegpt_probe_present", {
    description: "Present the single-task UseGPT feasibility App component.",
    inputSchema: z.object({}),
    _meta: { "openai/outputTemplate": PROBE_RESOURCE_URI, ui: { resourceUri: PROBE_RESOURCE_URI }, "openai/toolInvocation/invoking": "Preparing UseGPT task…", "openai/toolInvocation/invoked": "UseGPT task is ready." },
  }, async () => ({ content: [{ type: "text", text: "Use the presented UseGPT feasibility component to claim and process the pending task." }], _meta: { "openai/outputTemplate": PROBE_RESOURCE_URI } }));
  return mcp;
}

async function main(): Promise<void> {
  const path = statePath();
  if (process.argv[2] === "seed") {
    const prompt = PromptSchema.safeParse(process.argv.slice(3).join(" ") || "Return the marker exactly and briefly explain the result.");
    if (!prompt.success) throw new Error("Probe prompt must contain 1 to 20000 nonblank characters.");
    const task = TaskSchema.parse({ taskId: `probe_${randomUUID()}`, marker: `USEGPT_PROBE_${randomUUID()}`, prompt: prompt.data, status: "queued", updatedAt: new Date().toISOString() });
    await withFileLock(path, async () => {
      const current = await taskFile(path);
      if (current && !["completed", "failed"].includes(current.status)) throw new Error("Probe task is active; use a separate absolute task file for another experiment.");
      await writeJsonAtomic(path, task);
    });
    process.stdout.write(`${JSON.stringify(task)}\n`);
    return;
  }
  if (process.argv[2] === "status") {
    const task = await withFileLock(path, () => taskFile(path));
    process.stdout.write(`${JSON.stringify(task ?? { status: "empty" })}\n`);
    return;
  }
  await serveStdio(async () => server(path));
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "probe failed"}\n`); process.exitCode = 1; });
