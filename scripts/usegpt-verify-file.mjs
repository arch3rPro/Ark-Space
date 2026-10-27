#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { resolveArkSpacePaths } from "../dist/config/paths.js";
import { loadConfig } from "../dist/config/store.js";

let directory;
try {
  const { values } = parseArgs({ options: {
    "artifact-id": { type: "string" }, revision: { type: "string" },
    "output-dir": { type: "string", default: tmpdir() },
  } });
  if (!values["artifact-id"] || !/^\d+$/.test(values.revision ?? "") || !Number.isSafeInteger(Number(values.revision)) || Number(values.revision) < 1) {
    throw new Error("invalid-input");
  }
  const config = await loadConfig(resolveArkSpacePaths().config);
  const connection = config.connections?.usegpt;
  if (!connection?.enabled || !connection.dataDir) throw new Error("config");
  const { UseGptHubStore } = await import("../dist/usegpt/hub-store.js");
  const store = await UseGptHubStore.open(connection.dataDir);
  try {
    const { artifact, stream } = await store.exportArtifact({ artifactId: values["artifact-id"], revision: Number(values.revision) });
    try {
      directory = await mkdtemp(join(resolve(values["output-dir"]), "usegpt-export-"));
      await chmod(directory, 0o700);
      const outputPath = join(directory, "content.bin");
      const digest = createHash("sha256");
      let sizeBytes = 0;
      const meter = new Transform({ transform(chunk, _encoding, done) {
        sizeBytes += chunk.length;
        digest.update(chunk);
        done(null, chunk);
      } });
      await pipeline(stream, meter, createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
      const sha256 = digest.digest("hex");
      if (sha256 !== artifact.sha256 || sizeBytes !== artifact.sizeBytes) throw new Error("integrity");
      process.stdout.write(`${JSON.stringify({ ok: true, artifactId: artifact.id, revision: artifact.revision, name: artifact.name, mediaType: artifact.mediaType, sizeBytes, sha256, verified: true, outputPath })}\n`);
    } finally { stream.destroy(); }
  } finally { await store.close(); }
} catch {
  if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "Cannot export and verify the fixed revision. Check configuration, artifact ID, revision, output directory, and Node.js 22.13+ runtime." })}\n`);
  process.exitCode = 1;
}
