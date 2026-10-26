import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const TaskSchema = z.object({
  taskId: z.string().min(1),
  marker: z.string().min(1),
  prompt: z.string().min(1).max(20_000),
  status: z.enum(["queued", "claimed", "completed", "failed"]),
  claimedBy: z.string().min(1).optional(),
  output: z.string().max(100_000).optional(),
  error: z.string().max(2_000).optional(),
  updatedAt: z.string(),
}).strict();
type Task = z.infer<typeof TaskSchema>;

const statePath = process.env.ARKSPACE_USEGPT_PROBE_TASK_FILE ?? join(process.cwd(), ".scratch", "usegpt-secure-mcp", "task.json");
const taskFile = async (): Promise<Task | undefined> => {
  try { return TaskSchema.parse(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw new Error("Probe task state is invalid."); }
};
const saveTask = async (task: Task): Promise<void> => {
  await mkdir(dirname(statePath));
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(task), { mode: 0o600 });
  await rename(temporary, statePath);
};
const mkdir = async (path: string): Promise<void> => { const { mkdir } = await import("node:fs/promises"); await mkdir(path, { recursive: true, mode: 0o700 }); };

const PROBE_RESOURCE_URI = "ui://usegpt-secure-mcp/probe.html";
const probeHtml = `<!doctype html><meta charset="utf-8"><title>UseGPT feasibility probe</title><p id="state">Waiting for a task…</p><script>
(async () => {
  const state = document.getElementById("state");
  const workerId = "chatgpt-probe-" + crypto.randomUUID();
  for (;;) {
    const result = await window.openai.callTool("usegpt_probe_claim", { workerId });
    const task = result?.structuredContent;
    if (task?.status === "claimed") {
      state.textContent = "Task claimed; asking ChatGPT to continue…";
      await window.openai.sendFollowUpMessage({ prompt: "Process the claimed UseGPT task. Return the requested result and call usegpt_probe_complete with the exact taskId and marker." });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
})().catch(error => { document.getElementById("state").textContent = "Probe failed: " + String(error?.message || "unknown"); });
</script>`;

function server(): McpServer {
  const mcp = new McpServer({ name: "usegpt-secure-mcp-probe", version: "0.1.0" });
  mcp.registerTool("usegpt_probe_claim", {
    description: "Claim the one pending UseGPT feasibility task. Return the task prompt and marker; do not claim a task already claimed or completed.",
    inputSchema: z.object({ workerId: z.string().min(1).max(128) }),
    outputSchema: z.object({ taskId: z.string(), marker: z.string(), prompt: z.string(), status: z.string() }),
  }, async ({ workerId }) => {
    const task = await taskFile();
    if (!task) return { content: [{ type: "text", text: JSON.stringify({ status: "empty" }) }], structuredContent: { taskId: "", marker: "", prompt: "", status: "empty" } };
    if (task.status === "queued") {
      task.status = "claimed"; task.claimedBy = workerId; task.updatedAt = new Date().toISOString(); await saveTask(task);
    }
    const result = { taskId: task.taskId, marker: task.marker, prompt: task.prompt, status: task.status };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  mcp.registerTool("usegpt_probe_complete", {
    description: "Complete the claimed UseGPT feasibility task with the ChatGPT result. The marker must be included in the result.",
    inputSchema: z.object({ taskId: z.string().min(1), output: z.string().min(1).max(100_000), marker: z.string().min(1) }),
    outputSchema: z.object({ taskId: z.string(), status: z.string() }),
  }, async ({ taskId, output, marker }) => {
    const task = await taskFile();
    if (!task || task.taskId !== taskId) throw new Error("Probe task not found.");
    if (task.marker !== marker || task.status !== "claimed") throw new Error("Probe task claim is invalid or stale.");
    task.status = "completed"; task.output = output; task.updatedAt = new Date().toISOString(); await saveTask(task);
    const result = { taskId, status: task.status };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  mcp.registerTool("usegpt_probe_status", {
    description: "Read the bounded status of the UseGPT feasibility task.",
    inputSchema: z.object({ taskId: z.string().min(1) }),
    outputSchema: z.object({ taskId: z.string(), status: z.string(), output: z.string().optional() }),
  }, async ({ taskId }) => {
    const task = await taskFile();
    if (!task || task.taskId !== taskId) throw new Error("Probe task not found.");
    const result = { taskId, status: task.status, ...(task.output ? { output: task.output } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  mcp.registerResource("usegpt-secure-mcp-probe", PROBE_RESOURCE_URI, {
    title: "UseGPT Secure MCP feasibility probe",
    description: "A minimal App component that claims a queued task and asks ChatGPT to continue it.",
    mimeType: "text/html;profile=mcp-app",
    _meta: {
      "openai/widgetDescription": "UseGPT task continuation probe",
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": { connect_domains: [] },
    },
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: probeHtml }] }));
  mcp.registerTool("usegpt_probe_present", {
    description: "Present the UseGPT feasibility App component. The component claims one queued task and asks ChatGPT to continue it.",
    inputSchema: z.object({}),
    _meta: { "openai/outputTemplate": PROBE_RESOURCE_URI, "openai/toolInvocation/invoking": "Preparing UseGPT task…", "openai/toolInvocation/invoked": "UseGPT task is ready." },
  }, async () => ({ content: [{ type: "text", text: "Use the presented UseGPT feasibility component to claim and process the pending task." }], _meta: { "openai/outputTemplate": PROBE_RESOURCE_URI } }));
  return mcp;
}

async function main(): Promise<void> {
  if (process.argv[2] === "seed") {
    const task: Task = { taskId: `probe_${randomUUID()}`, marker: `USEGPT_PROBE_${randomUUID()}`, prompt: process.argv.slice(3).join(" ") || "Return the marker exactly and briefly explain the result.", status: "queued", updatedAt: new Date().toISOString() };
    await saveTask(task); process.stdout.write(`${JSON.stringify(task)}\n`); return;
  }
  if (process.argv[2] === "status") {
    const task = await taskFile(); process.stdout.write(`${JSON.stringify(task ?? { status: "empty" })}\n`); return;
  }
  await serveStdio(async () => server());
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "probe failed"}\n`); process.exitCode = 1; });
