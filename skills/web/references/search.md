# Search and Related

## Search

Use `web.search` to discover sources from a query.

```json
{
  "protocolVersion": 1,
  "capability": "web.search",
  "input": {
    "query": "the search query",
    "maxResults": 5
  }
}
```

Run `arks invoke web.search --input <temporary-json-file>`. Add `provider`, domain filters, or `timeoutMs` only when required. Provider snippets are discovery material, not independently verified page content.

### SearXNG instances

When the user chooses SearXNG, use explicit `provider: "searxng"`. An unconfigured instance list is a setup blocker, not permission to choose a public endpoint. Direct the human to run `arks setup` in a trusted terminal to append their chosen instances and instance-specific CIDR exceptions. The earlier `arks provider configure searxng --base-url <HTTP(S)-base-url>` command explicitly replaces the list with one endpoint; private self-hosting needs a narrow explicit `--allow-range <CIDR>`. These permissions do not enable unrelated local fetching.

Persisted configuration takes precedence over `SEARXNG_URL`, then `SEARXNG_BASE_URL`. SearXNG needs JSON output enabled, but no key. `arks doctor` checks configuration only. Multiple instances rotate across invocations and may fail over after classified safe failures, with independent cooldowns. Successful empty results stay empty; cancellation or the shared deadline stops attempts. Configuration does not add SearXNG to the default Provider order; explicitly selected searches can switch instances but never switch Provider.

Use machine input `options.searxng` only with explicit SearXNG selection: `categories`/`engines` arrays, `language`, `page`, `safesearch`, or `timeRange`. Categories are strict; an empty result is not broadened automatically. Time ranges depend on the instance's engines. Domain filters are applied locally; publication dates and engine/category source metadata are discovery evidence, not verification. No auth headers or proxy are supported.

## Related

Use `web.related` when one known page is the semantic starting point.

```json
{
  "protocolVersion": 1,
  "capability": "web.related",
  "input": {
    "url": "https://example.com/reference",
    "maxResults": 5
  }
}
```

Run `arks invoke web.related --input <temporary-json-file>`. Exa is the only Provider for this operation. Add domain filters or `timeoutMs` only when required.

Completion requires relevant results with URLs. Fetch underlying pages before presenting snippets as verified content.
