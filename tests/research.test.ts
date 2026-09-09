import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeResearch } from "../src/capabilities/research.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveResearchInput } from "../src/protocol/schema.js";
import type { ResearchJobId } from "../src/protocol/types.js";
import type { ResearchProvider } from "../src/providers/contracts.js";

const directories: string[] = [];
const prompt = "Compare current API lifecycle contracts";

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("research.run capability", () => {
  it("falls back after Exa confirms remote cancellation", async () => {
    const statePath = await temporaryStatePath();
    const jobId = "agent_run_cancelled" as ResearchJobId;
    const exa: ResearchProvider = {
      id: "exa",
      async research() {
        throw new ProviderError("Exa polling failed.", {
          kind: "transient",
          cleanup: { resource: "research-job", jobId, attempted: true, ok: true },
          remoteJob: { resource: "research-job", jobId, state: "cancelled" },
        });
      },
    };
    const tavily: ResearchProvider = {
      id: "tavily",
      async research() {
        return {
          prompt,
          report: "A cited report.",
          sources: [{ url: "https://docs.example.com/research", title: "Research API" }],
          status: "completed",
          jobId: "tavily-completed" as ResearchJobId,
        };
      },
    };

    const result = await executeResearch(resolveResearchInput({ prompt }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([
        ["exa", exa],
        ["tavily", tavily],
      ]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "tavily",
      attempts: [
        {
          provider: "exa",
          ok: false,
          cleanup: { resource: "research-job", ok: true },
          remoteJob: { state: "cancelled" },
        },
        { provider: "tavily", ok: true },
      ],
      warnings: ["Remote Research job agent_run_cancelled reached a confirmed terminal state before fallback."],
    });
    expect(JSON.stringify(result)).not.toMatch(/exa-secret|tavily-secret/);
  });

  it("does not rotate keys or fall back for a possibly-running Tavily Job", async () => {
    const statePath = await temporaryStatePath();
    let calls = 0;
    const jobId = "tavily-running" as ResearchJobId;
    const tavily: ResearchProvider = {
      id: "tavily",
      async research() {
        calls += 1;
        throw new ProviderError("Tavily polling failed.", {
          kind: "transient",
          remoteJob: { resource: "research-job", jobId, state: "possibly-running" },
        });
      },
    };
    const config = defaultConfig();
    config.providerOrder = ["tavily", "exa", "firecrawl"];
    config.providers.tavily!.keyRefs = ["env:TAVILY_ONE", "env:TAVILY_TWO"];

    const result = await executeResearch(resolveResearchInput({ prompt }), {
      config,
      statePath,
      providers: new Map([["tavily", tavily]]),
      environment: {
        TAVILY_ONE: "first-secret",
        TAVILY_TWO: "second-secret",
        EXA_API_KEY: "unused-secret",
      },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: {
        retryable: false,
        correction: "Inspect the reported remote Research Job ID; do not submit a duplicate run.",
      },
      attempts: [{ provider: "tavily", safeToRetry: false, remoteJob: { jobId: "tavily-running" } }],
      warnings: ["Remote Research job tavily-running may still be running."],
    });
    expect(JSON.stringify(result)).not.toMatch(/first-secret|second-secret|unused-secret/);
  });

  it("reports unknown submission acceptance and suppresses duplicate work", async () => {
    const statePath = await temporaryStatePath();
    let calls = 0;
    const exa: ResearchProvider = {
      id: "exa",
      async research() {
        calls += 1;
        throw new ProviderError("Exa submission response was lost.", {
          kind: "network",
          submission: { resource: "research-job", state: "acceptance-unknown" },
        });
      },
    };
    const config = defaultConfig();
    config.providers.exa!.keyRefs = ["env:EXA_ONE", "env:EXA_TWO"];

    const result = await executeResearch(resolveResearchInput({ prompt }), {
      config,
      statePath,
      providers: new Map([["exa", exa]]),
      environment: { EXA_ONE: "first-secret", EXA_TWO: "second-secret", TAVILY_API_KEY: "unused-secret" },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: {
        retryable: false,
        correction: "Check the Provider dashboard for a newly accepted Research job before submitting again.",
      },
      attempts: [{ submission: { state: "acceptance-unknown" }, safeToRetry: false }],
      warnings: ["Provider acceptance of the Research submission is unknown; retrying may create duplicate work."],
    });
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-research-"));
  directories.push(directory);
  return join(directory, "state.json");
}
