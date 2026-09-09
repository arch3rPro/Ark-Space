# Map and Crawl

## Map

Use Map to discover links on a known site before fetching selected pages.

```json
{
  "protocolVersion": 1,
  "capability": "web.map",
  "input": {
    "url": "https://docs.example.com",
    "query": "API reference",
    "maxResults": 100
  }
}
```

Run `arks invoke web.map --input <temporary-json-file>`. `query` is optional. Tavily and Firecrawl support mapping. Mapped links are discovery results, not verified page content.

## Crawl

Use Crawl only for multi-page content on a known site. Prefer Map followed by selected Fetch requests when sufficient. Crawl consumes Provider credits and Firecrawl creates a remote job.

1. State the site scope, page limit, depth, and path filters.
2. Submit a bounded request:

   ```json
   {
     "protocolVersion": 1,
     "capability": "web.crawl",
     "input": {
       "url": "https://docs.example.com",
       "query": "API reference",
       "maxPages": 20,
       "maxDepth": 2,
       "includePaths": ["/docs/.*"]
     }
   }
   ```

3. Run `arks invoke web.crawl --input <temporary-json-file>`.
4. Attribute every page and disclose failed URLs. If cancellation is unconfirmed, report that the remote job may remain active.

Tavily and Firecrawl support crawling. Requests are limited to 100 pages and depth 5. The Firecrawl adapter keeps external-link crawling disabled.
