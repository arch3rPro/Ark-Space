# Notices

ArkSpace is a greenfield successor to the existing ArkSpace project. The design may reuse behavior, fixtures, or adapted source from external projects only after the applicable license and attribution are recorded.

## Current Project License

See `LICENSE`. Preserve its copyright notice when copying or substantially adapting covered material.

## Migration Sources

The first implementation slice is expected to consult or adapt material from:

- Exa API documentation for search, contents, answers, similar links, and code context.
- `tavily-ai/skills` and Tavily documentation for search, extract, map, crawl, and research behavior.
- `firecrawl/cli`, Firecrawl Agent Skills, and Firecrawl documentation for search, scrape, map, crawl, extract, browser interaction, and monitoring behavior.
- Brave Search API documentation.
- Jina Reader documentation.
- SearXNG Search API documentation.
- arXiv API documentation and terms of use.
- DuckDuckGo public HTML search behavior.

This list is an implementation warning, not a claim that source code has already been imported. Before migration, record the upstream URL, exact revision or documentation date, license, imported surface, and local modifications. Reference-only research does not grant permission to copy source.

## Setup TUI design reference

- Upstream: <https://github.com/SaladDay/cc-switch-cli>
- Inspected revision: `b563ce17fdcc5316701ee8ba00368bdeb24b929a`
- License: MIT; copyright 2025 Jason Young and 2025 saladday (CLI fork contributions).
- Consulted surface: `src-tauri/src/cli/tui/` navigation, page frames, Provider tables, forms, contextual help, and repository screenshots.
- Imported surface: none. ArkSpace independently implements the interaction and visual patterns in Node/TypeScript; no Rust source, assets, dependencies, configuration handling, or Provider-switching behavior is copied.
- Adaptation: retains ArkSpace's six setup destinations, axis-specific navigation, default-Cancel action confirmations, masked input, explicit saved-key disclosure, and existing backend/security guards. Reference-only source inspection and screenshots are not evidence of running or qualifying the reference application.

## Skill UI artwork

- Catalog: <https://thesvg.org/>; source repository: <https://github.com/GLINCKER/thesvg>.
- Imported revision: `a7c5ddd3f529accdf86519cc8fb96cb76cef4efd`.
- Imported surface: `public/icons/chrome/default.svg` (browser), `public/icons/github/light.svg` and `dark.svg` (gh-repo), `public/icons/azure-network-watcher/default.svg` (monitor), `public/icons/azure-cognitive-search/default.svg` (research), `public/icons/azure-website-staging/default.svg` (web), and `public/icons/knowledgebase/default.svg` (weknora).
- License: the live catalog labels Azure and Chrome assets MIT, and GitHub and KnowledgeBase assets CC0-1.0. These are catalog declarations, not independently verified owner licenses, and do not waive trademark restrictions. See each owning Skill's `assets/NOTICE.md` for the source and owner-policy links. This artwork is not relicensed under ArkSpace's MIT license.
- Adaptation: imported SVG geometry, colors, and aspect ratios remain unchanged. Any GitHub theme presentation is documented in its Skill-local notice. The assets identify the selected UI artwork, not Azure, Chrome, or KnowledgeBase integrations or endorsement.
- Each Skill includes its own icon, Codex metadata, and attribution so an isolated installation does not depend on a sibling Skill or repository-root asset.

## Existing ArkSpace Lineage

The existing project records additional lineage including `kepano/obsidian-skills`, `kepano/defuddle-cli`, and `obra/superpowers`. Carry those notices into this repository only when the corresponding material is migrated.
