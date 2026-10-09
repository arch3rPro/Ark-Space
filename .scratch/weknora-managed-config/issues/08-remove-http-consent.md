# Remove the extra WeKnora HTTP confirmation

Type: task
Status: resolved

## User correction

The configured HTTP endpoint and an explicit request to use it do not need another protocol-specific permission question. The extra gate was an ArkSpace client policy, not a WeKnora prerequisite. Do not add speculative fee warnings to the authenticated connection test.

## Scope

- Remove the HTTP-specific Setup confirmation and runtime rejection.
- Keep HTTP plaintext information non-blocking; do not add remembered grants, configuration, or replacement confirmation flows.
- An explicit user request supplies network consent for that operation. Preserve the machine `confirmed: true` boundary.
- Keep unrelated Web/SearXNG rules, validation, fixed routes, DNS pinning, TLS validation, credential redaction, timeouts and cancellation unchanged.
- Preserve accepted request shapes where possible; any existing `allowHttp` field is compatibility-only, not permission.
- Synchronize canonical guidance and the already authorized installed CLI/WeKnora Skill after regression checks.

## Completion

HTTP verification/retrieval works without `allowHttp`; Setup has no second HTTP confirmation; canonical and installed guidance do not demand one. Applicable source, installed-entry and Setup regression checks pass.

## Answer

Removed the HTTP-only runtime rejection and Setup modal. Kept the existing network-test action and machine `confirmed: true` boundary. Legacy `allowHttp` input is accepted but ignored, with explicit compatibility-only schema descriptions. Existing plaintext information is non-blocking. No fee warning, setting, grant, or replacement confirmation flow was added.

Qualification: `npm run check` passed (608 tests / 41 files); focused WeKnora runtime/Setup checks passed (142 tests); Skill guidance passed (4 tests); `npm run test:setup` passed (84 source + 84 offline installed Linux real-PTY checks); actual updated global CLI/MCP entries passed 54 tests / 2 files using synthetic HTTP services. Active primary LSP probes covered 9 paths with zero errors. An initial unrelated SearXNG timeout passed on isolated rerun and subsequent full qualification.

Updated the already authorized global CLI and installed managed Skill reference. Protected configuration/credential file metadata is unchanged; no new request to the real service occurred. Hosted Windows/macOS TTY and human UX acceptance remain unverified.
