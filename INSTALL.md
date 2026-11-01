# Install ArkSpace

ArkSpace has two installable surfaces:

1. **Agent Skills** provide operation guidance for `askme`, `notes`, `web`, `research`, `browser`, `monitor`, `weknora`, `usegpt`, and `gh-repo`.
2. **`arks` CLI** provides shared Provider execution, credential handling, owned resources, and MCP stdio.

Provider-backed Skills need both surfaces. `weknora` can run independently with `WEKNORA_BASE_URL` and `WEKNORA_API_KEY`, without the CLI. Node.js 22.19.0 or newer is required by the current CLI package and its `pi-tui` dependency.

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

See [0.1.5 release notes](release/0.1.5.md) for features, verification evidence, and qualification limits. Install the current published CLI:

```bash
npm install --global @arkspace/cli@latest
arks --version
```

At preparation time, the published version is 0.1.4; the 0.1.5 release-candidate source is not a claim that 0.1.5 is available from npm.

## Install the Skills

### Portable installation

Use the Agent Skills installer for Codex, Claude Code, Cursor, and other compatible hosts:

```bash
npx skills@latest add arch3rPro/Ark-Space
```

Choose the target Agent and the canonical Skills you need, such as `askme`, `notes`, `web`, `research`, `browser`, `monitor`, `weknora`, `usegpt`, and `gh-repo`. For a non-interactive installation, name the host explicitly:

```bash
npx skills@latest add arch3rPro/Ark-Space --agent <agent> --skill askme notes web research browser monitor weknora usegpt gh-repo -y
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
# Any of the six contexts also accepts weknora or usegpt.
```

The Setup workbench (rebuilt in 0.1.3, running on a differential-rendering engine since 0.1.5) keeps three focus regions — Top, Menu, Content — cycled with Tab/Shift-Tab, and its Top strip spans six contexts (Exa, Tavily, Firecrawl, SearXNG, WeKnora, UseGPT); `arks setup <context>` deep-links into any page. Keys: `a` add, `e`/Enter edit, `i` details, `p` secure preview (`r` reveals; cleared on leave), `d` remove, Space toggles the selected key, `v` toggles the provider, `t` opens the Cancel-default test chooser (one pool round-robin test, or isolated per-key tests with Esc to stop), `u`/`d` reorder, Delete removes, `I` includes with confirmation, Ctrl-S saves drafts; connection pages act on rows with Enter as labeled. Secret entry is always masked, destructive or billable actions require a Cancel-default confirmation, SearXNG private-CIDR authorization is per-instance and never migrates between endpoints, environment-managed values stay read-only, opening setup issues no network request, non-TTY runs print one plain line without entering the alternate screen, and the terminal is always restored on exit. Automated Linux PTY qualification (`npm run test:setup`) covers all six contexts on the source build and an offline-installed entry; it uses standard-library Python 3 as a development-only prerequisite, not an end-user CLI dependency. Human usability, real services, and hosted Windows/macOS terminals remain unqualified. See [ADR 0016](docs/adr/accepted/0016-tui-provider-setup.md), [ADR 0017](docs/adr/accepted/0017-workbench-modal-setup.md), [ADR 0023](docs/adr/accepted/0023-pi-tui-setup-engine.md), [ADR 0024](docs/adr/accepted/0024-workbench-presentation-contract.md), and reference provenance in [NOTICE.md](NOTICE.md).

Existing contracts remain: session-only `--lang en|zh` overrides saved `setupLanguage`; environment keys cannot be replaced, and unlinking references never changes external values; ownership/shared-reference guards, independent SearXNG enablement/order, narrow per-instance CIDR consent, explicit live-test consent, cancellation, and terminal restoration are preserved. Preview remains read-only and ephemeral, distinguishing stored from effective environment values without network or file writes. No-color rendering is supported.

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

## WeKnora optional managed connection (0.1.4)

The human opens its configuration page in a trusted terminal:

```bash
arks setup weknora
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

- `arks --version` reports the version currently published on npm (0.1.4 during 0.1.5 release-candidate preparation);
- at least one required Provider is ready in `arks doctor --json`;
- the target Agent discovers the selected ArkSpace Skills.

Optional MCP registration uses the same CLI:

```bash
claude mcp add --scope user arkspace -- arks mcp serve
codex mcp add arkspace -- arks mcp serve
```

Register MCP only for hosts that need it; Skills can execute `arks` directly.

## Update

The manual npm updater is introduced in the 0.1.5 release candidate. Published `@arkspace/cli@0.1.4` does not include `arks update`. Until a release containing it is published, update the CLI to the current stable npm version and update Skills separately:

```bash
npm install --global @arkspace/cli@latest
npx skills@latest check
npx skills@latest update
```

The release-candidate implementation supports `arks update --check` for a read-only check, `arks update --check --json` for one CLI-specific JSON result, and `arks update` for an interactive install prompt. The prompt accepts Y/N (case-insensitive), with empty input defaulting to no; non-interactive use never installs. Skills still use their separate check/update commands.

In a source checkout, build and run the development-only, read-only check:

```bash
npm run build
node dist/cli/main.js update --check
```

A source checkout cannot self-update. When released, `arks update --check` will check for a newer stable npm version without installing; `arks update` will display the verified global npm target and ask `[y/N]` interactively (Y/N, case-insensitive; empty means no). There is no `--confirm` option, and non-interactive use never installs. `--json` emits one CLI-specific JSON object on stdout; prompts and diagnostics stay on stderr.

Only a verified, unlinked npm-global installation owned by the available npm can be updated. Source, local, linked, missing, and mismatched installs must be updated manually. Installation targets the exact newer stable version checked, uses engine checks and `--ignore-scripts`, and never elevates privileges. It does not alter ArkSpace configuration or credentials, invoke Skill/plugin installers, or change host registrations. Files bundled in the npm package, including canonical Skills and plugin manifests, change with that package; separately installed Skills/plugins do not. Failed or interrupted npm installation may have partially changed files; no rollback is promised. No other command performs startup update checks. Plugin metadata changes only during an explicit ArkSpace release.

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

A source checkout remains check-only; use the manual `@latest` npm install above (and update Skills separately) when an update is needed. With explicit permission to replace a global installation, build the reviewed checkout and pack it to a temporary directory:

```bash
npm pack --ignore-scripts --pack-destination /path/to/temporary-directory
npm install --global --ignore-scripts /path/to/temporary-directory/arkspace-cli-0.1.5.tgz
```

Synchronize the installed WeKnora Skill from the same checkout, preserving unrelated user files, and reload the Agent's Skills. This installs a local 0.1.5 source artifact without publishing; do not infer registry availability from its version string. Updating only the CLI or only the Skill leaves managed execution unavailable. Existing connection and credential files need no changes. Release and cross-platform qualification rules are documented in [Maintenance](docs/maintenance.md) and [Platform Support](docs/platform-support.md).
