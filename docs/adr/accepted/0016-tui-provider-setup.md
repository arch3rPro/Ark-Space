# Native terminal UI for Provider setup

- **Status:** accepted; interaction superseded by [ADR 0017](0017-workbench-modal-setup.md)
- **Class:** security
- **Supersedes:** the interaction design in [ADR 0015](0015-menu-based-provider-setup.md); its security, language, storage, routing, and ownership protections remain in force

## Context and decision

The user rejected the numeric-menu design: verbose homepage status cards obscured the available actions, an extra **Manage selected key/instance** picker buried entries, and old pages accumulated on screen. Merely shortening that output does not satisfy the request for an actual terminal UI.

The original decision below records the intermediate page-based TUI, not the current workbench contract. ADR 0017 replaces its homepage, continuous-entry, and confirmation interaction; it does not revoke the trusted-terminal or resource-ownership protections.

`arks setup [provider]` uses native Node terminal input and rendering, without a new dependency or general-purpose UI framework. Arrow keys select a menu entry, Enter opens it, Esc returns from a menu, and Ctrl-C exits. Setup owns a bounded alternate-screen session, clears the previous page on every screen/form transition, and restores terminal screen, cursor, and raw-input state on completion, cancellation, or handled failure. Non-TTY execution does not enter the alternate screen or ask for secrets.

The homepage is a minimal list of Exa, Tavily, Firecrawl, and SearXNG plus language, automatic-order, and local-check actions—not statistics cards or a table. Each Provider page lists its keys or instances directly alongside Provider actions. Selecting an entry opens its actions without an intermediate Manage selector. Detailed non-secret metadata stays in Provider/entry pages; configured or locally available never means live-verified. Direct `setup exa|tavily|firecrawl|searxng` opens the same Provider page.

## Retained protections

- Real secrets are entered by the human only in a trusted local terminal through hidden input, never in Agent conversation, command arguments, or captured Agent input. Explicit confirmation for replacement/removal remains required; ADR 0017 replaces continuous addition with one item per modal Save.
- Credentials remain in the user-level plaintext `credentials.json`, configuration stores references, and state stores non-secret metadata. Original process environment overrides remain external. Environment-managed key values cannot be replaced, but references may be unlinked without changing external values; shared-reference unlinking preserves credentials. Independently configured local and environment references may share a key pool. Owned-resource cleanup remains protected. No credential migration or new storage format is introduced.
- English/Chinese setup language keeps the existing precedence: session-only `--lang en|zh`, saved `setupLanguage`, first nonempty `LC_ALL`/`LC_MESSAGES`/`LANG`, then English. Explicit menu selection saves the preference; switching language alone does not change credentials, health, network activity, other CLI output, or Protocol v1.
- Provider enabling and automatic order remain separate. SearXNG instances keep explicit per-instance network permissions and have no per-instance enable toggle. First local creation defaults the backend to enabled; appending preserves existing disabled state. Neither automatically adds SearXNG to order, but explicit inclusion permits automatic routing. Local instances override rather than pool with the read-only environment endpoint. Privacy-sensitive hosted-fallback order changes require consent.
- Opening setup does not rewrite existing configuration or reconcile order. Saves remain incremental; cancellation does not roll back saved entries. No lock spans user input or network activity.
- Local checks do not use the network; ADR 0017 removes the local-check setup menu in favor of the separate `doctor` command. Live tests still require consent for fees/logging and route strictly to the selected Provider through the shared search dispatcher. Evidence covers actual attempts, not every key or instance.

## Consequences and limits

This replaces only human setup interaction, not Protocol v1, Provider execution, pool behavior, or the trusted credential boundary. The earlier rejection of arrow-key/fullscreen interaction is superseded; avoiding a terminal dependency is retained. Terminal behavior requires fixture and installed-entry verification, not an assumption of hosted Windows/macOS qualification. The credential file is not an OS keychain, and POSIX modes do not establish Windows ACL protection.

The TUI is an unreleased source change accessed through the built `node dist/cli/main.js setup` entry. The pinned npm release and source package version remain `0.1.2`; this decision neither publishes a release nor changes global installations or personal configuration.
