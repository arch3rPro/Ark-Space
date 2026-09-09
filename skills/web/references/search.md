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
