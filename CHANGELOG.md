# Changelog

Notable released changes to ArkSpace will be recorded here.

## 0.1.0 - 2026-09-09

- Established the greenfield product, architecture, and migration boundaries.
- Added the first Node.js and TypeScript `arks` CLI implementation.
- Added committed protocol version 1 request and response JSON Schemas for every capability.
- Added Search and Fetch adapters for Exa, Tavily, and Firecrawl.
- Added `web.map` through Tavily and Firecrawl with normalized links and Provider fallback.
- Added bounded `web.crawl` through Tavily and Firecrawl, including Firecrawl polling, safe pagination, timeout cancellation, and cleanup evidence.
- Added Exa `web.related` and `code.context` retrieval.
- Added Firecrawl `web.extract` with bounded JSON Schema input, local output validation, and duplicate-safe remote Job evidence.
- Added attached `research.run` through Exa Agent and Tavily Research with normalized sources, Exa grounding, bounded quality controls, polling, and terminal completion semantics.
- Added Exa Research cancellation settlement and unsafe-retry evidence for Tavily or ambiguous submissions.
- Prevented fallback when Firecrawl Crawl cancellation cannot be confirmed.
- Added owned Firecrawl Browser sessions with bounded structured actions, key pinning, explicit status and close, authority-URL redaction, and cleanup evidence.
- Added recurring Exa Monitors with key-pinned lifecycle operations, explicit mutation confirmation, run history, and private one-time webhook-secret storage.
- Added the official MCP TypeScript SDK v2 stdio transport over the shared Protocol v1 dispatcher.
- Added a separate owned Firecrawl Site Monitor lifecycle with typed scrape, crawl, and search targets, schedule and retention controls, judging, credit estimates, check history, cancellation, and page-level results.
- Added environment-reference credentials, transactional key rotation, cooldown, disable, and Provider fallback behavior.
- Added canonical `web`, `research`, `browser`, and `monitor` Skills plus direct-source Claude Code and Codex plugin manifests.
- Added sanitized Provider fixtures, real-entry tests, and migration evidence.
- Added cross-platform CI, installed-host checks, and opt-in credentialed Provider E2E as post-release qualification paths for the initial 0.1 line.
