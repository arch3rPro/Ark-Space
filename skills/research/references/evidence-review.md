# Evidence review and delivery

Use this after `research.run` completes. The remote report is a starting point; source inspection and targeted follow-up happen in the host. A successful job, a source URL, or Provider grounding alone is not independent verification.

## Review bounds

Prioritize claims whose correction could change the answer, comparison, or recommendation: availability, prices, dates, quantities, compatibility, and material risks. Agree a wider review scope only when it matters to the task. Otherwise allow one review pass of at most five additional capability invocations, including Search, Fetch, and cached-content reads. Count failures too; do not expand the limit silently.

These are host review bounds, not Provider search counts, fee limits, or guarantees about a remote job. Batch a small set of relevant URLs when useful; a batch or fallback may still incur multiple Provider charges. Respect the user's deadline and exclusions. A wider host investigation or another `research.run` invocation needs the user's approval, and the original job must be safely settled first. Configured safe fallback inside the original invocation remains governed by the runtime's existing lifecycle contract. Source inspection must follow the Source safety rules in [Research](../SKILL.md#source-safety).

## Inspect the evidence

1. Extract the consequential claims and pair each with a cited source. A bibliography entry with no identifiable support is a gap, not a verified claim.
2. Read the relevant source text. Search snippets and another generated summary are leads, not substitutes for reading it. If the decisive passage is missing, truncated, or inaccessible, leave the claim unverified.
3. Check the source's scope: publication or update date when available, product version, geography, population, units, and comparison basis. Separate the observation date from the source's publication date; record unknown dates as unknown.
4. Prefer evidence suited to the claim. First-party documentation is strong for product behavior and availability; independent methods or original datasets may be stronger for performance and comparative claims. Repeated articles citing one upstream source are not independent corroboration.
5. Mark support as **supported**, **partial**, **contradicted**, or **unverified**, with a brief reason. A supported claim means the inspected passage fits that claim and scope, not that every statement in the document is true. Keep Provider-only claims distinguishable from independently checked ones.

Keep a small gap list: claim, current source/support, missing evidence, and next query. An empty source list or a Provider budget warning requires a prominent limitation; do not manufacture citations to make the report look complete.

## Targeted follow-up

Use the gap list to choose the next operation. Read an exact known page with `web.fetch`; use `web.search` when the supporting page or a credible contrary source is missing. Look for evidence that could disprove the draft, not just more pages agreeing with it. Keep within the review bound; do not restart `research.run` by default.

These requests work with the installed CLI even when the `web` Skill is absent. Save each to an owned temporary JSON file, run `arks invoke <capability> --input <temporary-json-file>`, read the single envelope, and remove the request file. Preserve configured Provider selection unless the user requests otherwise. Treat `ok: false` as failure; keep `failedUrls`, warnings, and access gaps visible.

```json
{
  "protocolVersion": 1,
  "capability": "web.fetch",
  "input": {
    "urls": ["https://example.com/primary-source"],
    "onlyMainContent": true,
    "maxCharacters": 20000
  }
}
```

```json
{
  "protocolVersion": 1,
  "capability": "web.search",
  "input": {
    "query": "the specific missing evidence, with relevant date or version",
    "maxResults": 5
  }
}
```

Inspect `data.results` rather than assuming a search answer is verified. If a fetched result has a `responseId`, use `web.content.get` for the relevant cached text when necessary. Replace the example ID below with the returned ID; content reads also count toward the review bound. Read the surrounding context, not just the matching words. If no usable content is available, report the gap rather than inventing a passage.

```json
{
  "protocolVersion": 1,
  "capability": "web.content.get",
  "input": {
    "responseId": "0123456789abcdef0123456789abcdef",
    "offset": 0,
    "limit": 20000
  }
}
```

For conflicts, compare definitions, time windows, versions, denominators, and methods first. Explain why one interpretation has better support; retain both interpretations and their consequences when the conflict remains unresolved. Replace stale or unsupported recommendations with the checked conclusion or an explicit uncertainty.

## Stop and qualify

Finish review when the consequential claims are checked or explicitly bounded, material conflicts are resolved or disclosed, and further targeted retrieval mostly yields duplicates or evidence unlikely to change the answer. Also stop at the review-call limit or the user's deadline. Reaching a limit is not evidence sufficiency: name the remaining gaps and narrow the conclusion. Ask before continuing beyond the agreed scope.

Do not claim to know the Provider's internal searches or number of research passes. Report only the review operations actually performed. Never infer that stopping local work cancelled a remote job; the lifecycle rules in [Research](../SKILL.md#lifecycle) still apply.

## Report contract

Use the user's requested format and the lightest structure that answers the question. A useful default is:

- **Answer:** the direct conclusion or comparison, before process details.
- **Scope:** audience, relevant boundaries, as-of date, and material assumptions.
- **Analysis:** task-specific findings with citations adjacent to material sourced claims. Distinguish facts from inference; label what was independently checked.
- **Limitations:** unresolved conflicts, inaccessible or stale evidence, unverified claims, Provider warnings, and review limits reached.
- **Recommendations:** only when requested or useful, tied to the evidence and remaining uncertainty.

Include a compact source list. Use titles, publisher/author, publication/update dates, and URLs when actually known; preserve tool-native citation references in working notes if available, but use readable citations in the final artifact. No citation, quotation, date, access result, or verification status may be invented.

For longer reports, retain a claim-to-source ledger in working notes or a source-note file beside the requested artifact. Track claim, URL/title, known date and applicable scope, inspected passage or location, access result, support status, and unresolved gap. Preserve the distinction between independently inspected text and Provider-only attribution. Offer working files when useful or requested; avoid dumping the whole ledger into a short answer. Use an owned output location and ask before overwriting existing files.

Chat or Markdown is valid unless the user requests another format. If a requested artifact cannot be produced, disclose the blocker and preserve the synthesis; ask before substituting another format. Use available document tools only when needed. Do not install a companion plugin silently or claim visual QA unless the rendered artifact was actually inspected.

## Completion check

Before handing off, confirm that the scoped question is answered, consequential conclusions have inspected support or visible qualifications, material claims have traceable citations, conflicts and warnings remain visible, and the review stopped for a stated reason. Identify the actual Research Provider and distinguish its output from the host's checks. If evidence is insufficient for a decision, say so rather than presenting a definitive recommendation.
