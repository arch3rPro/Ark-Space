# UseGPT native file acceptance

## Evidence and limits

The user reported that ChatGPT created a task in the existing test project and called `usegpt_artifact_publish_file` twice with native file references, without `publish_inline`. Local verification independently found both available revisions in the configured Hub, exported their bytes, validated their structure and compared independently computed hashes with stored metadata. No signed download URLs, credentials or file contents are recorded here. Local inspection establishes persisted bytes; the assertion about which tool ChatGPT invoked comes from the user's Host-side report.

Project: `project_ffa96a7b-1b1a-4ba5-970e-1f632261ef0b`.
Task: `task_d27ebeb5-8579-48b7-9fde-125341949435`.

| File | Artifact | Revision | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| usegpt-file-test.csv | artifact_782a5f10-c8fe-4dc0-b158-19be2b1cac13 | 1 | 37 | d345e7fecf831cb6c57b1fda6dd7cfd182ead9379cb7d34d814e39046ada1747 |
| usegpt-file-test.png | artifact_4dab01a9-f634-4f40-981c-8bd8e17c3d54 | 1 | 18061 | 55d1441463b55c241a775b3784c2e5486918c5c832e6f1ea0d16cbb027551a83 |

## Independent checks

- Exported each fixed revision using `scripts/usegpt-verify-file.mjs`; independently calculated byte counts and SHA-256 matched Hub metadata.
- CSV decoded as UTF-8 and parsed into four rows including the header, with two consistent columns.
- PNG signature, chunk boundaries, all chunk CRCs and IEND were valid, with no trailing bytes. IDAT decompressed successfully. IHDR dimensions were 723 by 360 pixels.
- Initially no daemon was running. Started an owned daemon against the actual data directory, described each fixed revision through IPC and exported/rehashed its bytes, then stopped it. Repeated the full cycle once. Both files passed both boots with identical revisions, sizes and hashes.
- Original artifacts and source task were left unchanged. The user-owned Tunnel/MCP processes were not stopped.

## Remaining acceptance

These samples verify CSV and PNG transport/storage. They do not establish every ChatGPT mode or file format, PDF support in the real Host, image-generation provenance, Windows support, binary worker input packaging, or execution by an installed AI Agent. The worker's deterministic child contract tests remain distinct from real AI execution.
