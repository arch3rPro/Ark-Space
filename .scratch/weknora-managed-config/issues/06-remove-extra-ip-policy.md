# Remove the extra WeKnora IP policy and correct table allocation

Status: resolved

## User decision

The user rejected shrinking the left menu to address crowded right-hand URL/source/status columns. Restore the original 19-cell menu and full English Configuration label. Allocate right-hand resource columns explicit shares rather than giving URL/reference all leftover space; keep unrelated layouts and controls unchanged.

The user explicitly removed the WeKnora-only nonpublic-address restriction and its private-server/CIDR configuration. This was an ArkSpace client policy borrowed from public-web retrieval, not an upstream WeKnora API prerequisite. A user-selected connection must work with its configured public, private or loopback host without an extra IP grant.

## Boundary

- Only fixed authenticated WeKnora verify/list/detail/search routes receive the changed address policy.
- No public bypass option is added to generic local HTTP, web fetch or SearXNG; their existing private-address rules remain intact.
- Retain original-environment pair resolution, exact validated API origin/path, valid IP/DNS records and pinned lookup, TLS certificate checks, no redirects or ambient proxies, HTTP risk/network consent, deadlines/cancellation, bounded responses, and secret redaction.
- Remove the WeKnora network-access action and grant prompts. Accept valid legacy allowRanges data for loading compatibility, ignore it as a WeKnora authorization requirement, and clear it on new saves.
- Do not connect to the user's actual endpoint or access real credentials during implementation.

## Evidence

Implemented the WeKnora-only policy change, removed private-access/CIDR UI and consent requirements, restored the original menu and fixed right-hand three-column shares at approximately 50/25/25. Accepted ADR, consumer docs, bilingual READMEs and self-contained managed Skill guidance are synchronized. Prior reports of the extra grant policy/menu compaction are historical and superseded by this user decision.

- `npm run check`: 602 tests in 41 files, validation/typecheck/build passed.
- `npm run test:setup`: 84 source + 84 offline-installed Linux real-PTY checks passed.
- Fresh offline temporary npm installation with lifecycle scripts denied, using installed entries through `ARKSPACE_VERIFY_ENTRY` and `ARKSPACE_RETRIEVAL_ENTRY`: 48 verification/retrieval tests passed, including CLI/MCP.
- `npm run verify:package`: 210 files, 272189 packed bytes, no runtime install scripts.
- Focused real HTTP fixtures prove configured loopback/private hosts work without grants, malformed DNS records still fail before requests, valid chosen records are pinned, legacy ranges are ignored, external pairs do not borrow stored keys/preferences, and generic Web/SearXNG address restrictions remain intact. TLS rejection, redirects, proxies, limits and cancellation regressions remain green.

No real user keys, actual user endpoint/DNS, global installations, versions, tags or releases were changed. Human UX and hosted Windows/macOS TTY remain unverified.
