import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

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
  ResearchRequestSchema,
  WebCrawlRequestSchema,
  WebExtractRequestSchema,
  WebFetchRequestSchema,
  WebMapRequestSchema,
  WebRelatedRequestSchema,
  WebSearchRequestSchema,
} from "../src/protocol/schema.js";
import { ResourceRequestSchemas } from "../src/protocol/resource-schema.js";
import { SiteMonitorRequestSchemas } from "../src/protocol/site-monitor-schema.js";

const outputDirectory = resolve("schemas/protocol/v1");
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  writeSchema("web-search-request.schema.json", WebSearchRequestSchema),
  writeSchema("web-search-response.schema.json", WebSearchEnvelopeSchema),
  writeSchema("web-fetch-request.schema.json", WebFetchRequestSchema),
  writeSchema("web-fetch-response.schema.json", WebFetchEnvelopeSchema),
  writeSchema("web-map-request.schema.json", WebMapRequestSchema),
  writeSchema("web-map-response.schema.json", WebMapEnvelopeSchema),
  writeSchema("web-crawl-request.schema.json", WebCrawlRequestSchema),
  writeSchema("web-crawl-response.schema.json", WebCrawlEnvelopeSchema),
  writeSchema("web-related-request.schema.json", WebRelatedRequestSchema),
  writeSchema("web-related-response.schema.json", WebRelatedEnvelopeSchema),
  writeSchema("code-context-request.schema.json", CodeContextRequestSchema),
  writeSchema("code-context-response.schema.json", CodeContextEnvelopeSchema),
  writeSchema("web-extract-request.schema.json", WebExtractRequestSchema),
  writeSchema("web-extract-response.schema.json", WebExtractEnvelopeSchema),
  writeSchema("research-request.schema.json", ResearchRequestSchema),
  writeSchema("research-response.schema.json", ResearchEnvelopeSchema),
  ...Object.entries({ ...ResourceRequestSchemas, ...SiteMonitorRequestSchemas }).map(([capability, schema]) => writeSchema(`${capability.replaceAll(".", "-")}-request.schema.json`, schema)),
  ...Object.entries(ResourceEnvelopeSchemas).map(([capability, schema]) => writeSchema(`${capability.replaceAll(".", "-")}-response.schema.json`, schema)),
]);

async function writeSchema(name: string, schema: z.ZodType): Promise<void> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  await writeFile(resolve(outputDirectory, name), `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
}
