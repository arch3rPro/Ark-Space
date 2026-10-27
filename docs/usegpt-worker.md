# UseGPT worker and file acceptance

The worker is a POSIX-only executable adapter. It requires Node 22.13+, a running Hub daemon, and an owner-controlled configuration file with mode 0600. It is not a bundled AI model. The operator chooses an installed executable; no Agent CLI was installed during verification.

Start the daemon for the same `dataDir`, then run:

```bash
arks usegpt daemon start --data-dir /absolute/private/hub
arks usegpt worker once --config /absolute/private/worker.json
# Poll for later handoffs until interrupted:
arks usegpt worker run --config /absolute/private/worker.json
```

Configuration:

```json
{
  "executable": "/absolute/path/to/executable",
  "args": ["/absolute/path/to/adapter.mjs"],
  "cwd": "/absolute/private/workspace",
  "projectId": "project_REPLACE_WITH_ACTUAL_UUID",
  "recipient": "agent:next",
  "dataDir": "/absolute/private/hub",
  "timeoutMs": 300000,
  "pollMs": 1000
}
```

The executable must be a regular file without group/world write permissions. The working directory and Hub directory must belong to the operator and have private permissions. Arguments are passed directly with `shell: false`. Child environment contains PATH, HOME, LANG and the two file paths below; provider and control-plane keys are not forwarded by default. This is a trusted executable boundary, not an OS sandbox: the executable still has the user's filesystem access.

The child reads `ARKS_USEGPT_INPUT_FILE` and writes `ARKS_USEGPT_RESULT_FILE` as a regular mode-0600 file. Input contains the task, instruction, claim fence and fixed text revisions. Binary input packaging is not supported by the worker yet; such a claim requires manual reconciliation rather than automatic replay. Output follows this contract:

```json
{
  "protocolVersion": 1,
  "handoffId": "handoff_REPLACE_WITH_INPUT_ID",
  "generation": 1,
  "outcome": "completed",
  "artifacts": [{"name": "result.md", "content": "Delivered content", "mediaType": "text/markdown"}]
}
```

The ID and generation must match the input. `completed` requires at least one artifact. A zero exit code alone never completes a handoff. The parent validates the result, publishes artifacts with stable idempotency keys and settles the handoff. It does not automatically complete the whole Task. A `partial` result retains its delivered artifacts and keeps the handoff for reconciliation. Runtime timeout/cancellation and missing or invalid results leave durable recovery records; existing attempts are not automatically replayed. Inspect `dataDir/.worker/<handoffId>/` and Hub state before intervening. Recovery files and logs may contain task content and must remain private.

## Actual Host file acceptance

Ask ChatGPT to generate a small CSV and PNG and call `usegpt_artifact_publish_file` with a native file reference in the existing test project. Do not copy signed download URLs into chat or Git. A file-ID-only reference without `download_url` is currently unsupported.

For each successful receipt, run from this checkout:

```bash
node scripts/usegpt-verify-file.mjs --artifact-id <artifact-id> --revision 1 --output-dir /tmp
```

The script reads the configured Hub, exports exactly that revision into a new private directory and independently computes size and SHA-256. `verified: true` must match the receipt. Binary data is exported as `content.bin`; the original name remains metadata. This is a source-checkout utility, not a published CLI command.

## Evidence

- Real ChatGPT Markdown: artifact `artifact_b2cde6a7-38b3-4058-a79b-fc2c3f392e79`, revision 1, 375 bytes, SHA-256 `081301b60247ed1edd1f2b6abb56cb332edd639ec45ce2c292572832f47bb94e`.
- Local independent read, Agent pull/report writeback, and two owned daemon start/read/stop cycles passed without modifying the source revision.
- Binary export and worker tests use deterministic local fixtures. They establish contracts, not actual ChatGPT image/file generation or execution by a real AI Agent.
- Real Host PNG/document import and an installed AI executable remain separate acceptance steps.
