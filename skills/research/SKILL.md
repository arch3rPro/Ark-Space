---
name: research
description: Produce a bounded, cited synthesis across multiple public sources through ArkSpace. Use when the requested outcome is a research report, comparison, landscape, or decision-ready answer rather than source discovery or retrieval of known pages.
compatibility: Requires a local filesystem-based host with shell and network access, Node.js 20+, the arks CLI, and Exa or Tavily credentials; intended for Claude Code and Codex CLI on macOS, Linux, and Windows.
---

# Research

Use the installed `arks` CLI for long-running, Provider-backed synthesis. Use `research.run` for multi-source conclusions, comparisons, and decision-ready reports. Use the `web` Skill for source discovery, exact-page retrieval, site collection, or structured extraction; do not reproduce a Research run with an ad hoc chain of Search calls.

## Readiness

1. Run `arks --version`. If unavailable, explain that ArkSpace CLI is required and ask before changing the user's environment.
2. Run `arks doctor --json` when Provider readiness is unknown. If credentials are missing, direct the human to run `arks setup` in a trusted local terminal. Never ask for an API key in conversation or place one in a command argument.
3. Ask before changing configuration or the user's environment. Force Exa or Tavily only when the user requests it; otherwise preserve configured key handling and safe fallback.

## Scope

Write a concrete prompt that states:

- the question and intended decision;
- date, geography, or entity boundaries;
- required comparisons and exclusions;
- preference for first-party sources and the evidence needed for important claims;
- the desired report structure.

Choose `concise` for a narrow answer, `standard` for an ordinary multi-source report, and `deep` only when broader coverage justifies higher latency and Provider cost. ArkSpace does not expose a common hard budget in Protocol v1.

## Run

Create a temporary Protocol v1 request:

```json
{
  "protocolVersion": 1,
  "capability": "research.run",
  "input": {
    "prompt": "Compare the current authentication models of these APIs. Prefer official documentation, cite material claims, and identify unresolved differences.",
    "depth": "standard",
    "timeoutMs": 600000
  }
}
```

Run:

```bash
arks invoke research.run --input <temporary-json-file>
```

For an explicitly requested Provider, add `"provider": "exa"` or `"provider": "tavily"`. Remove the temporary request file after reading the single JSON envelope.

## Evidence handling

Treat `data.report` as generated synthesis, not as authority. Use `data.sources` as the machine-readable source list. Exa may also return `data.grounding` that associates output fields with source URLs; Tavily's source list does not claim passage-level grounding.

Before presenting consequential conclusions:

1. verify that important claims are supported by the cited URLs;
2. prefer primary sources over summaries and disclose material source conflicts;
3. preserve uncertainty when evidence is missing or time-sensitive;
4. report `warnings`, including completion without source evidence or budget-limited output;
5. identify the actual Provider and do not describe fallback attempts as completed research.

Return the requested synthesis and a compact source list, or write the requested report artifact. Do not paste the raw Protocol envelope or entire Provider report when a bounded answer or artifact satisfies the request.

## Lifecycle

ArkSpace remains attached while the remote Research Job runs. Exa supports cancellation; ArkSpace waits for confirmed terminal settlement before considering fallback safe. Tavily documents polling but no cancellation endpoint.

If failure evidence says submission acceptance is unknown, check the Provider dashboard before retrying. If a remote Job is `possibly-running`, report its Job ID and do not submit a duplicate. Stopping local polling is never proof that Provider-side work stopped.
