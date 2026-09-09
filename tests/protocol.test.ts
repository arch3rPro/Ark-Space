import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { classifyHttpFailure, correctionFor } from "../src/errors/provider-error.js";
import {
  CodeContextEnvelopeSchema,
  ResearchEnvelopeSchema,
  WebCrawlEnvelopeSchema,
  WebExtractEnvelopeSchema,
  WebFetchEnvelopeSchema,
  WebMapEnvelopeSchema,
  WebRelatedEnvelopeSchema,
  WebSearchEnvelopeSchema,
  ResourceEnvelopeSchemas,
} from "../src/protocol/envelope-schema.js";
import {
  CodeContextRequestSchema,
  parseCodeContextRequest,
  parseResearchRequest,
  parseWebCrawlRequest,
  parseWebExtractRequest,
  parseWebFetchRequest,
  parseWebMapRequest,
  parseWebRelatedRequest,
  parseWebSearchRequest,
  ResearchRequestSchema,
  WebCrawlRequestSchema,
  WebExtractRequestSchema,
  WebFetchRequestSchema,
  WebMapRequestSchema,
  WebRelatedRequestSchema,
  WebSearchRequestSchema,
} from "../src/protocol/schema.js";
import { parseBrowserInteractRequest, parseBrowserOpenRequest, parseMonitorCreateRequest, ResourceRequestSchemas } from "../src/protocol/resource-schema.js";
import { SiteMonitorRequestSchemas } from "../src/protocol/site-monitor-schema.js";

describe("protocol v1", () => {
  it("resolves explicit defaults at the untrusted JSON boundary", () => {
    const request = parseWebSearchRequest({
      protocolVersion: 1,
      capability: "web.search",
      input: { query: "agent skills" },
    });

    expect(request.input).toEqual({
      query: "agent skills",
      maxResults: 5,
      timeoutMs: 30_000,
      includeDomains: [],
      excludeDomains: [],
    });
  });

  it("resolves web.fetch defaults and accepts only credential-free HTTP URLs", () => {
    const request = parseWebFetchRequest({
      protocolVersion: 1,
      capability: "web.fetch",
      input: { urls: ["https://example.com/docs"] },
    });

    expect(request.input).toEqual({
      urls: ["https://example.com/docs"],
      timeoutMs: 30_000,
      onlyMainContent: true,
      maxCharacters: 20_000,
    });
    expect(() =>
      parseWebFetchRequest({
        protocolVersion: 1,
        capability: "web.fetch",
        input: { urls: ["https://user:password@example.com"] },
      }),
    ).toThrow(/must not contain credentials/);
  });

  it("resolves web.map defaults and limits it to mapping Providers", () => {
    const request = parseWebMapRequest({
      protocolVersion: 1,
      capability: "web.map",
      input: { url: "https://docs.example.com" },
    });

    expect(request.input).toEqual({
      url: "https://docs.example.com",
      maxResults: 100,
      timeoutMs: 60_000,
    });
    expect(() =>
      parseWebMapRequest({
        protocolVersion: 1,
        capability: "web.map",
        input: { url: "https://docs.example.com", provider: "exa" },
      }),
    ).toThrow();
  });

  it("resolves bounded web.crawl defaults", () => {
    const request = parseWebCrawlRequest({
      protocolVersion: 1,
      capability: "web.crawl",
      input: { url: "https://docs.example.com" },
    });

    expect(request.input).toEqual({
      url: "https://docs.example.com",
      maxPages: 20,
      maxDepth: 2,
      timeoutMs: 120_000,
      maxCharacters: 20_000,
      onlyMainContent: true,
      includePaths: [],
      excludePaths: [],
    });
  });

  it("resolves web.related and code.context defaults", () => {
    expect(
      parseWebRelatedRequest({
        protocolVersion: 1,
        capability: "web.related",
        input: { url: "https://example.com/reference" },
      }).input,
    ).toEqual({
      url: "https://example.com/reference",
      maxResults: 5,
      timeoutMs: 30_000,
      includeDomains: [],
      excludeDomains: [],
    });
    expect(
      parseCodeContextRequest({
        protocolVersion: 1,
        capability: "code.context",
        input: { query: "SDK usage" },
      }).input,
    ).toEqual({ query: "SDK usage", tokens: "dynamic", timeoutMs: 60_000 });
  });

  it("resolves bounded Research defaults", () => {
    expect(
      parseResearchRequest({
        protocolVersion: 1,
        capability: "research.run",
        input: { prompt: "Compare current API lifecycle contracts" },
      }).input,
    ).toEqual({
      prompt: "Compare current API lifecycle contracts",
      depth: "standard",
      timeoutMs: 600_000,
    });
    expect(() =>
      parseResearchRequest({
        protocolVersion: 1,
        capability: "research.run",
        input: { prompt: "Research", depth: "unbounded" },
      }),
    ).toThrow();
  });

  it("bounds structured extraction schemas at the untrusted boundary", () => {
    const request = parseWebExtractRequest({
      protocolVersion: 1,
      capability: "web.extract",
      input: {
        urls: ["https://example.com/pricing"],
        prompt: "Extract plans",
        schema: { type: "object", properties: { plans: { type: "array" } } },
      },
    });
    expect(request.input.timeoutMs).toBe(300_000);
    expect(request.input.onlyMainContent).toBe(true);

    expect(() =>
      parseWebExtractRequest({
        protocolVersion: 1,
        capability: "web.extract",
        input: {
          urls: ["https://example.com/pricing"],
          prompt: "Extract plans",
          schema: { type: "object", properties: { plans: { $ref: "https://attacker.example/schema" } } },
        },
      }),
    ).toThrow(/must not contain \$ref/);
    expect(() =>
      parseWebExtractRequest({
        protocolVersion: 1,
        capability: "web.extract",
        input: {
          urls: ["https://example.com/pricing"],
          prompt: "Extract plans",
          schema: { type: "object", properties: { name: { type: "string", pattern: "(a+)+$" } } },
        },
      }),
    ).toThrow(/must not contain regular expressions/);
    expect(() =>
      parseWebExtractRequest({
        protocolVersion: 1,
        capability: "web.extract",
        input: {
          urls: ["https://example.com/pricing"],
          prompt: "Extract plans",
          schema: { type: "array" },
        },
      }),
    ).toThrow(/type: object/);
  });

  it("bounds Browser actions and requires explicit side-effect confirmation", () => {
    expect(parseBrowserOpenRequest({ protocolVersion: 1, capability: "browser.open", input: { url: "https://example.com" } })).toMatchObject({ ttlSeconds: 600, activityTtlSeconds: 300 });
    expect(() => parseBrowserInteractRequest({ protocolVersion: 1, capability: "browser.interact", input: { sessionId: "session", action: { type: "click", ref: "@e1" }, confirmed: false } })).toThrow();
    expect(() => parseBrowserInteractRequest({ protocolVersion: 1, capability: "browser.interact", input: { sessionId: "session", action: { type: "click", ref: "button" }, confirmed: true } })).toThrow();
  });

  it("requires bounded Monitor schedules, HTTPS webhooks, and confirmation", () => {
    const request = parseMonitorCreateRequest({ protocolVersion: 1, capability: "monitor.create", input: { query: "agent updates", period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: "/tmp/secret", confirmed: true } });
    expect(request).toMatchObject({ numResults: 10, timeoutMs: 30_000 });
    expect(() => parseMonitorCreateRequest({ protocolVersion: 1, capability: "monitor.create", input: { query: "agent updates", period: "30m", webhookUrl: "http://example.com/hook", webhookSecretPath: "/tmp/secret", confirmed: true } })).toThrow();
  });

  it("rejects unknown fields and unsupported protocol versions", () => {
    expect(() =>
      parseWebSearchRequest({
        protocolVersion: 2,
        capability: "web.search",
        input: { query: "agent skills", unknown: true },
      }),
    ).toThrow();
  });

  it("keeps committed JSON Schemas aligned with runtime schemas", async () => {
    const pairs = [
      ["web-search-request.schema.json", WebSearchRequestSchema],
      ["web-search-response.schema.json", WebSearchEnvelopeSchema],
      ["web-fetch-request.schema.json", WebFetchRequestSchema],
      ["web-fetch-response.schema.json", WebFetchEnvelopeSchema],
      ["web-map-request.schema.json", WebMapRequestSchema],
      ["web-map-response.schema.json", WebMapEnvelopeSchema],
      ["web-crawl-request.schema.json", WebCrawlRequestSchema],
      ["web-crawl-response.schema.json", WebCrawlEnvelopeSchema],
      ["web-related-request.schema.json", WebRelatedRequestSchema],
      ["web-related-response.schema.json", WebRelatedEnvelopeSchema],
      ["code-context-request.schema.json", CodeContextRequestSchema],
      ["code-context-response.schema.json", CodeContextEnvelopeSchema],
      ["web-extract-request.schema.json", WebExtractRequestSchema],
      ["web-extract-response.schema.json", WebExtractEnvelopeSchema],
      ["research-request.schema.json", ResearchRequestSchema],
      ["research-response.schema.json", ResearchEnvelopeSchema],
      ...Object.entries({ ...ResourceRequestSchemas, ...SiteMonitorRequestSchemas }).map(([capability, schema]) => [`${capability.replaceAll(".", "-")}-request.schema.json`, schema] as const),
      ...Object.entries(ResourceEnvelopeSchemas).map(([capability, schema]) => [`${capability.replaceAll(".", "-")}-response.schema.json`, schema] as const),
    ] as const;
    for (const [name, schema] of pairs) {
      const committed = JSON.parse(await readFile(resolve("schemas/protocol/v1", name), "utf8"));
      expect(committed).toEqual(z.toJSONSchema(schema, { target: "draft-7" }));
    }
  });
});

describe("provider error taxonomy", () => {
  it.each([
    [401, "", "auth"],
    [403, "", "permission"],
    [429, "rate limited", "rate-limit"],
    [429, "usage limit exceeded", "quota"],
    [402, "credits exhausted", "quota"],
    [432, "", "quota"],
    [433, "", "quota"],
    [500, "", "transient"],
    [422, "", "invalid-request"],
  ] as const)("classifies HTTP %i as %s", (status, body, expected) => {
    expect(classifyHttpFailure(status, body)).toBe(expected);
  });

  it("gives actionable corrections for operator-resolvable failures", () => {
    expect(correctionFor("auth")).toMatch(/Replace/);
    expect(correctionFor("config")).toContain("arks setup");
  });
});
