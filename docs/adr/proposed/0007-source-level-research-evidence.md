# Source-level Research evidence

- **Status:** proposed
- **Class:** architecture

## Decision

`research.run` adds a conservative `evidenceArtifact` containing deterministic source IDs, source URLs, and optional titles. Its status is `source-level-only` and `passageEvidenceAvailable` is always `false`.

The source ID is a SHA-256-derived identifier over canonical metadata (`url` and title), not a hash of downloaded content. `contentHash` is therefore omitted until ArkSpace actually fetches and hashes source content. This artifact contains no passages, offsets, extraction spans, or claims, and must not be presented as claim-level citation proof.

## Scope and consequences

Providers continue to return their native report and source list. The capability layer normalizes the source list into the artifact. Existing provider adapters do not fetch additional pages. Consumers can correlate stable source metadata without mistaking it for fetched evidence.

Passage evidence, offsets, and claim support are explicitly deferred until the text representation and extraction ownership are defined.
