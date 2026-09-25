# Fetch

Use `web.fetch` to retrieve content from exact, credential-free HTTP(S) URLs. Remote Providers accept 1–20 URLs. The guarded local Provider accepts exactly one URL and must be explicitly selected and enabled.

```json
{
  "protocolVersion": 1,
  "capability": "web.fetch",
  "input": {
    "urls": ["https://example.com/page"],
    "onlyMainContent": true,
    "maxCharacters": 20000
  }
}
```

Run `arks invoke web.fetch --input <temporary-json-file>`. Add `provider`, `mode` (`raw` or `readable`), or `timeoutMs` only when required. `provider: "local"` is for explicitly enabled local fetching and does not support `answer` or binary media.

Present content with its source URL. Completion requires every `failedUrls` entry and warning to remain visible beside successful pages.
