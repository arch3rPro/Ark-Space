# Fetch

Use `web.fetch` to retrieve content from 1–20 exact, credential-free HTTP(S) URLs.

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

Run `arks invoke web.fetch --input <temporary-json-file>`. Add `provider` or `timeoutMs` only when required.

Present content with its source URL. Completion requires every `failedUrls` entry and warning to remain visible beside successful pages.
