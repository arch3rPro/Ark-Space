# Install ArkSpace

ArkSpace has two installable surfaces:

1. **Agent Skills** provide operation guidance for `web`, `research`, `browser`, `monitor`, and `weknora`.
2. **`arks` CLI** provides shared Provider execution, credential handling, owned resources, and MCP stdio.

Provider-backed Skills need both surfaces. `weknora` can run independently with `WEKNORA_BASE_URL` and `WEKNORA_API_KEY`, without the CLI. The prepared 0.1.4 release candidate additionally offers an optional managed connection for supported retrieval operations; it is not yet published. Node.js 20 or newer is required for the CLI and the Skill's SSE script.

## Give this to your Agent

Copy this prompt into a coding Agent:

```text
Install ArkSpace from https://github.com/arch3rPro/Ark-Space by following the repository's INSTALL.md. Ask before changing my global packages, Agent configuration, or MCP configuration. Never ask me to paste an API key into this conversation or include one in a command argument. When credentials are required, stop and ask me to run `arks setup` myself in a trusted local terminal, then continue only after I confirm completion. Verify the CLI, installed Skills, and Provider readiness before declaring success.
```

## Agent installation contract

An Agent performing the installation must:

1. Check `node --version`, `arks --version`, and the target host before changing anything.
2. Explain the selected installation scope and request consent for global package, Skill, plugin, or MCP changes.
3. Run only the documented commands below. Do not clone and execute an unreviewed installer.
4. Keep credentials in the human setup boundary: never request a key in conversation, echo it, place it in command arguments, or run the interactive setup through captured Agent input.
5. Ask the human to run `arks setup` in a separate trusted terminal. Resume after the human confirms completion.
6. Run the verification steps and report any failed check with its correction.

## Install the CLI

See [0.1.4 release candidate notes](release/0.1.4.md) for features, verification evidence, and qualification limits. The following pinned installation is available only after publication:

```bash
npm install --global @arkspace/cli@0.1.4
arks --version
```

Expected version after publication: `0.1.4`.

## Install the Skills

### Portable installation

Use the Agent Skills installer for Codex, Claude Code, Cursor, and other compatible hosts:

```bash
npx skills@latest add arch3rPro/Ark-Space
```

Choose the target Agent and the `web`, `research`, `browser`, `monitor`, and `weknora` Skills. For a non-interactive installation, name the host explicitly:

```bash
npx skills@latest add arch3rPro/Ark-Space --agent <agent> --skill web research browser monitor weknora -y
```

Use `-g` only after the user approves a user-wide installation.

### Claude Code plugin

The repository also exposes its canonical Skills through a Claude Code marketplace manifest:

```bash
claude plugin marketplace add arch3rPro/Ark-Space
claude plugin install arkspace@arkspace-dev --scope user
```

The marketplace identifier is `arkspace-dev`. Plugin installation references the canonical `skills/` directory; it does not create generated Skill copies.

## Configure Providers safely

The human runs this command directly in a trusted local terminal:

```bash
arks setup
```

### Terminal UI setup (0.1.3)

Build the checkout as described in [Source development](#source-development); use the built entry without replacing your global installation:

```bash
node dist/cli/main.js setup
node dist/cli/main.js setup exa
# Choose a language for this session only:
node dist/cli/main.js setup --lang zh
node dist/cli/main.js setup exa --lang en
# Direct Provider menus also accept tavily, firecrawl, or searxng.
```

The reference-driven Setup TUI rebuild is included in 0.1.3. Automated Linux source and offline installed-entry PTY qualification passed; human UX acceptance remains pending. It has three primary focus regions: Top (Exa/Tavily/Firecrawl/SearXNG provider context), Menu (Providers/Configuration/Settings/Exit), and Content. Tab/Shift-Tab cycles the three regions. Top Left/Right switches provider; `[`/`]` remain advertised alternates, and Down/Enter enters Content. Menu Up/Down selects a function, Enter opens it, and Right enters Content; Content Left returns to Menu. A primary resource table/list drives page-local actions; non-focusable hints wrap below the table. There are no legacy stacked toolbars or nested button-bar subfocus. Enter/`e` edits, `a` adds, `i` shows details, `p` opens secure preview, and `d` removes. Editing a stored local key preloads it into a masked draft; Esc restores the field, and Ctrl-S validates before explicit overwrite consent. Add starts blank; unchanged saves close without a write or replacement consent. Space toggles selected-key enablement; `V`/`v` toggles provider enablement; `t` opens a Cancel-default choice between one normal round-robin pool test (five seconds total) and sequential tests of every configured local key reference (one request per reference, five seconds per key). The all-keys mode requires consent for request logging, uses isolated temporary state, skips missing/unusable values without requests, reports only references and classified outcomes, and does not mutate global cursor, health, or configuration or fall back to another key/provider. Esc stops it. SearXNG remains keyless and retains its instance-pool test. Global order and language are independent: `u`/`d` reorder, Delete removes, `I` includes with confirmation, Ctrl-S saves order; language is a plain list applied with Enter. Draft editing and guarded save behavior are retained. Selected-key details include source (local, environment, or environment override), disabled state, health-failure reason, and remaining cooldown snapshot (not a live countdown while the modal is open); shared-provider status is explicit. Resource summaries group counts by kind and provide actionable cleanup guidance without authority-bearing URLs or secrets. The all-keys diagnostic shows current reference details, completed count, and recent session-only results; each result has numeric timestamp and duration. Switching provider context retains results, but cached rows are historical and do not validate the currently effective credential. Read-only navigation, preview, and details refreshes retain history; removed references are pruned. An attempted managed write (including other configuration operations) or a normal pool test clears it conservatively, and editing/removing a credential invalidates its diagnostic. History is memory-only and is never global health, cursor, or configuration. No credential values or fingerprints are kept, so external credential changes cannot be detected or reliably invalidate history. Linux PTY qualification uses standard-library Python 3 as a development-only prerequisite, not an end-user CLI dependency. Qualification evidence and caveats are tracked in the [priority-one workbench report](.scratch/setup-priority-one/report.md); human usability, real-service behavior, and Windows/macOS terminal acceptance remain unclaimed. See [ADR 0017](docs/adr/accepted/0017-workbench-modal-setup.md) and reference provenance in [NOTICE.md](NOTICE.md).

Existing contracts remain: session-only `--lang en|zh` overrides saved `setupLanguage`; environment keys cannot be replaced, and unlinking references never changes external values; ownership/shared-reference guards, independent SearXNG enablement/order, narrow per-instance CIDR consent, explicit live-test consent, cancellation, and terminal restoration are preserved. Preview remains read-only and ephemeral, distinguishing stored from effective environment values without network or file writes. No-color rendering is supported. Every provider label uses constant `[Name]` brackets, three-space gaps, classic centered placement, and a distinct provider accent; these are presentation changes, not new backends.

Keys are stored in the user-level credential file; `config.json` stores references and `state.json` stores non-secret health/lifecycle metadata. Original process environment values remain higher-priority overrides even when startup loads local credentials. [ADR 0015](docs/adr/accepted/0015-menu-based-provider-setup.md) remains historical, with security protections retained.

The credential file contains plaintext secrets protected by local filesystem access controls; it is not an operating-system keychain. Restrictive POSIX modes apply where supported, but do not establish Windows ACL protection; hosted Windows/macOS qualification remains unclaimed. Its default location is:

- macOS/Linux: `${XDG_CONFIG_HOME:-~/.config}/arkspace/credentials.json`
- Windows: `%APPDATA%\ArkSpace\credentials.json`
- override for isolated environments: `$ARKSPACE_HOME/credentials.json`

CI and externally managed environments may continue to provide `EXA_API_KEY`, `TAVILY_API_KEY`, or `FIRECRAWL_API_KEY` without writing the local credential file. For multiple externally managed keys, set the variables in your own trusted environment and register their names (not their values):

```bash
arks key add exa --env EXA_API_KEY_1
arks key add exa --env EXA_API_KEY_2
arks provider list
```

`arks key add` stores references only. In the workbench, open a new right-pane **Add** form for each additional key to append without deleting or replacing existing entries. If reference registration fails after a key is saved, the credential remains stored and the diagnostic identifies its reference without displaying the key. Do not paste keys into an Agent chat.

## WeKnora optional managed connection (0.1.4 release candidate)

This optional feature is prepared for 0.1.4, which is not yet published. Build this checkout using [Source development](#source-development); the pinned npm installation above is not available until publication. The human opens its configuration page in a trusted terminal:

```bash
node dist/cli/main.js setup weknora
```

Enter the exact `/api/v1` API root, a masked API key, and optional default knowledge-base ID. Saving stays offline. An explicit request to read the configured instance authorizes network access; HTTP is supported and carries an informational plaintext credential-transport warning. Valid localhost, private, and public destinations are supported without CIDR exceptions; address-format/original environment-pair validation, DNS pinning, verified TLS, refused redirects, no proxy, operation deadlines, and response bounds remain enforced. Legacy `allowRanges` values are ignored; new managed saves write an empty array. Removing the connection removes only local configuration, never remote content. Configuration stores the dedicated `env:ARKSPACE_WEKNORA_API_KEY` reference; raw keys stay in the existing private credential file, with the same plaintext-at-rest limits described above.

Supported optional managed operations are connection verification, knowledge-base list/detail, and single-base search. They use `arks invoke` or the equivalent MCP tools; see [the capability reference](docs/capabilities.md#optional-weknora-connection-verification) and the Skill's [managed guide](skills/weknora/references/managed.md). WeKnora does not join Web search order, key rotation, or fallback.

Manual environment configuration remains independent and takes precedence when both public variables are supplied. Supply them in your own trusted environment without pasting keys into chat or shell arguments. An incomplete/empty pair fails rather than combining a local key with an external address. A complete external pair is used as supplied and does not inherit a managed connection's default knowledge base. The Skill's environment path does not require installing `arks`; imports, document/chunk operations, multi-base search, and streamed chat continue using that path. Managed credentials are never exported to enable unsupported operations.

## SearXNG (0.1.3)

SearXNG is keyless and connects only to user-chosen instances; ArkSpace does not deploy or discover public instances. The authorized setup contract keeps environment-only endpoints read-only and separate from locally added instances, requires explicit narrow per-instance CIDR authorization for private addresses, and separates backend enablement from automatic order. Local instances override rather than pool with the environment endpoint; automatic routing requires explicit inclusion in order. The redesigned setup interaction has fresh source and offline isolated-entry Linux synthetic verification; real-service and hosted cross-platform qualification are not claimed. Consult [ADR 0017](docs/adr/accepted/0017-workbench-modal-setup.md) for interaction details.

The setup and search commands are:

```bash
arks setup searxng
arks web search "agent skills" --provider searxng --json
```

URL validation, private-network safeguards, and failover behavior remain in force.

For a single endpoint, the earlier command remains available and explicitly replaces the SearXNG configuration:

```bash
arks provider configure searxng --base-url "https://search.example.org"
# Append without replacing the existing list:
arks provider configure searxng --base-url "https://another-search.example.org" --append
```

Alternatively, supply `SEARXNG_URL` or `SEARXNG_BASE_URL` in the process environment when no persisted SearXNG configuration exists. Persisted configuration takes precedence; `SEARXNG_URL` takes precedence over `SEARXNG_BASE_URL`. Setup treats an environment-only endpoint as external/read-only: it does not silently save, edit, or remove it. Add a local instance explicitly if you want locally managed configuration.

Private and loopback addresses are blocked unless explicitly permitted with narrow CIDRs during configuration. For a local instance, for example:

```bash
arks provider configure searxng --base-url "http://127.0.0.1:8080" --allow-range 127.0.0.1/32
```

Use the smallest range that covers each instance, not an unrestricted network range. Exceptions belong to that instance and are never reused for another. Multiple instances rotate across CLI invocations; classified network, rate-limit, and server failures can try the next eligible instance, while failed instances cool down. Empty successful results do not trigger failover. Invalid requests/configuration, private-address denial, authentication/permission failures, and malformed responses remain terminal by default. Cancellation and the shared operation deadline stop further attempts.

Configuring instances does not add SearXNG to the automatic Provider order; explicit `--provider searxng` permits switching among your configured SearXNG instances but does not fall back to a hosted Provider. Authentication headers, proxies, public-instance discovery, and deployment are not included.

### Readiness and optional live tests

Use `arks doctor --json` outside setup for local configuration evidence; it makes no live Provider request and does not prove valid API keys or instance reachability. The workbench has no local-check sidebar action. Opening setup alone does not authorize network activity.

A Provider's **Test connection** action requires separate explicit consent covering possible fees and request logging. The chooser defaults to Cancel and offers two modes. **One pool test** sends the fixed public query `Agent Skills documentation` through the shared search dispatcher, with strict selected-Provider routing, at most one result, and a five-second total operation timeout. It retains normal shared round-robin key/instance selection, fallback within that Provider, and health/cooldown behavior; it does not try every key. **Test all keys individually** is available for keyed Providers: it tests each configured UI key reference sequentially, with one request per reference and a five-second timeout per key (up to N requests for N references). It never falls back to another key or Provider and does not mutate global cursor, health, or configuration. The Provider itself must be enabled, but disabled or cooling key references are included; missing or unusable values are skipped without an API request. This diagnostic uses isolated temporary state with restrictive directory permissions and cleanup. Progress is sequential; Esc stops the run and reports partial succeeded, failed, unavailable, cancelled, and not-tested outcomes using references and classified kinds only—not payloads or secrets. Ctrl-C retains its existing whole-setup exit behavior. SearXNG is keyless and continues to use the existing instance-pool test rather than this all-keys mode. Pool-test success is evidence only for actual attempts, not every configured key/instance. Neither mode prints returned snippets or raw Provider error bodies, nor qualifies Browser/Monitor capabilities.

## Verify

```bash
arks --version
arks doctor --json
arks provider list
npx skills@latest list
```

Installation is ready when:

- `arks --version` reports the version installed (the 0.1.4 pin is usable only after publication);
- at least one required Provider is ready in `arks doctor --json`;
- the target Agent discovers the selected ArkSpace Skills.

Optional MCP registration uses the same CLI:

```bash
claude mcp add --scope user arkspace -- arks mcp serve
codex mcp add arkspace -- arks mcp serve
```

Register MCP only for hosts that need it; Skills can execute `arks` directly.

## Update

Update within the 0.1 release line only after publication and reviewing the target version:

```bash
npm install --global @arkspace/cli@0.1.4
npx skills@latest update
```

Plugin metadata changes only during an explicit ArkSpace release.

## Uninstall

Remove only the surfaces that were installed:

```bash
npm uninstall --global @arkspace/cli
npx skills@latest remove web research browser monitor
claude plugin uninstall arkspace@arkspace-dev
claude plugin marketplace remove arkspace-dev
claude mcp remove arkspace
codex mcp remove arkspace
```

Uninstalling does not delete local credentials or owned remote browser/monitor resources. Close or delete owned resources first, then remove the ArkSpace home only after the user explicitly approves deleting its credential and state files.

## Source development

Contributors should use the source workflow in [CONTRIBUTING.md](CONTRIBUTING.md). To try the current source without replacing a global installation:

```bash
npm run build
node dist/cli/main.js setup
node dist/cli/main.js setup exa
node dist/cli/main.js setup searxng
node dist/cli/main.js provider configure searxng --base-url "https://search.example.org"
node dist/cli/main.js web search "agent skills" --provider searxng --json
```

Terminal UI setup and keyless SearXNG are included in 0.1.3. Automated verification does not establish human UX, real-service, or hosted Windows/macOS terminal qualification. These commands use the normal user-level ArkSpace configuration and credential paths; set `ARKSPACE_HOME` to a separate directory if you want isolation. When developing from source, substitute this built entry for `arks` in the earlier examples.

With explicit permission to replace a global installation, build the reviewed checkout and pack it to a temporary directory:

```bash
npm pack --ignore-scripts --pack-destination /path/to/temporary-directory
npm install --global --ignore-scripts /path/to/temporary-directory/arkspace-cli-0.1.4.tgz
```

Synchronize the installed WeKnora Skill from the same checkout, preserving unrelated user files, and reload the Agent's Skills. This installs a local 0.1.4 release-candidate artifact without publishing; do not infer registry availability from its version string. Updating only the CLI or only the Skill leaves managed execution unavailable. Existing connection and credential files need no changes. Release and cross-platform qualification rules are documented in [Maintenance](docs/maintenance.md) and [Platform Support](docs/platform-support.md).
