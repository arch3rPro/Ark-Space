---
name: web
description: Retrieve bounded public-web evidence through ArkSpace. Use for Web Search, pages related to a known URL, URL fetching, site mapping or crawling, schema-bound structured extraction, and implementation-oriented Code Context. Use a research workflow when the requested outcome is a synthesized report.
compatibility: Requires a local filesystem-based host with shell and network access, Node.js 20+, the arks CLI, and applicable Exa, Tavily, or Firecrawl credentials; intended for Claude Code and Codex CLI on macOS, Linux, and Windows.
---

# Web

Use the installed `arks` CLI. This Skill never resolves scripts relative to the repository.

## Readiness

1. Run `arks --version`. If unavailable, explain that ArkSpace CLI is required and ask before changing the user's environment.
2. Run `arks doctor --json` when Provider readiness is unknown. Show reported corrections and ask before changing configuration or key references.
3. Force a Provider only when the user requests one or the operation requires it. Otherwise preserve key rotation and fallback.

## Route

Choose the smallest operation that completes the task. Search discovers sources; Related starts from one known page; Fetch reads exact URLs; Map discovers site links; Crawl collects bounded multi-page content; Extract returns schema-bound JSON from exact URLs; Code Context retrieves implementation examples. Use `research` for synthesis across sources and `browser` for dynamic page state.

Load exactly the reference matching the requested outcome:

- Search by query or find pages related to a known URL: [Search and Related](references/search.md)
- Read one or more exact URLs: [Fetch](references/fetch.md)
- Discover site structure or collect multiple pages: [Map and Crawl](references/site.md)
- Extract JSON matching a supplied schema: [Structured Extract](references/extract.md)
- Retrieve implementation examples and API context: [Code Context](references/code-context.md)

## Result handling

Read the single JSON envelope from stdout. Treat `ok: false` as failure and follow `error.correction`. Attempts are evidence, not completed results. Attribute every result to its URL, disclose warnings and partial failures, and remove temporary request files.

Use only the result fields needed for the requested deliverable. Return a cited answer or write the requested artifact instead of pasting the raw envelope or full Provider payload into the conversation.
