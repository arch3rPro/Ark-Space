# Code Context

Use `code.context` for implementation-oriented examples, library usage, and API syntax from Exa Code. Inspect the local repository first; remote context supplements local evidence.

```json
{
  "protocolVersion": 1,
  "capability": "code.context",
  "input": {
    "query": "TypeScript example using the current library API",
    "tokens": "dynamic"
  }
}
```

Run `arks invoke code.context --input <temporary-json-file>`. `tokens` may instead be an integer from 1000 to 50000. Exa is the only Provider.

Completion requires identifying the query and Provider, preserving any source URLs in the returned context, and verifying version-sensitive guidance against primary documentation or the target repository.
