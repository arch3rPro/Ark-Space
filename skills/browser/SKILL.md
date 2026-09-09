---
name: browser
description: Navigate and interact with a website through an owned, bounded ArkSpace browser session. Use when a task requires dynamic page state, clicks, form filling, scrolling, pagination, or an accessibility snapshot rather than ordinary public-web retrieval.
---

# Browser

Use the installed `arks` CLI or ArkSpace MCP tools. Prefer the `web` Skill when Search or Fetch can produce the evidence without browser state.

## Readiness

1. Run `arks --version`. If unavailable, explain that ArkSpace CLI is required and ask before changing the user's environment.
2. Run `arks doctor --json` when Firecrawl readiness is unknown. Ask before changing configuration or key references.
3. Explain that an open Firecrawl browser session accrues credits until it is closed or expires.

## Session lifecycle

Open only the exact initial HTTP(S) URL needed:

```json
{
  "protocolVersion": 1,
  "capability": "browser.open",
  "input": {
    "url": "https://example.com",
    "ttlSeconds": 600,
    "activityTtlSeconds": 300,
    "timeoutMs": 30000
  }
}
```

Keep the returned `data.sessionId`. It is an opaque handle bound to the API key that created the session. Never substitute another account or Provider. ArkSpace intentionally does not return CDP or live-view authority URLs.

Use `browser.snapshot` before acting. Prefer `interactiveOnly: true`. The snapshot returns bounded `@eN` references for the current page state.

## Actions and confirmation

`browser.interact` performs exactly one structured action:

- `navigate` with an exact HTTP(S) URL;
- `click` with a current `@eN` reference;
- `fill` with a current `@eN` reference and text;
- `press` with an allowed key;
- `scroll` with direction and bounded pixels;
- `scrape` to read current page content.

Before each action, state the target and intended effect. Obtain explicit user approval before setting `"confirmed": true`. A click or key press can submit a form, purchase an item, publish content, change account state, or trigger another irreversible effect. Do not infer approval from an earlier request when the concrete target or effect has changed.

Refresh the snapshot after navigation or any action that materially changes the page. References are not stable across page states. Never send arbitrary JavaScript, Python, or shell code through Protocol v1.

For sensitive form values, disclose that the value will be sent to the remote browser Provider. Use a restrictive temporary request file, do not print its contents, remove it immediately, and proceed only with explicit approval.

## Cleanup and failure

Close the session as soon as the task completes:

```json
{
  "protocolVersion": 1,
  "capability": "browser.close",
  "input": { "sessionId": "<session-id>", "timeoutMs": 30000 }
}
```

TTL is a backstop, not normal cleanup. If an action fails with `safeToRetry: false`, report that its external effect is uncertain and do not repeat it automatically. If open reports failed cleanup, preserve and report the session ID because it may remain active and billable. Treat local timeout or process exit as neither proof of failure nor proof of closure.
