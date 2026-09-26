# Install ArkSpace

ArkSpace has two installable surfaces:

1. **Agent Skills** provide operation guidance for `web`, `research`, `browser`, `monitor`, and `weknora`.
2. **`arks` CLI** provides shared Provider execution, credential handling, owned resources, and MCP stdio.

Provider-backed Skills need both surfaces. `weknora` is an external-tool Skill: it needs neither, and instead requires its own `WEKNORA_BASE_URL` and `WEKNORA_API_KEY`. Node.js 20 or newer is required.

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

Install the pinned release:

```bash
npm install --global @arkspace/cli@0.1.2
arks --version
```

Expected version: `0.1.2`.

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

The wizard:

- links to the official Exa, Tavily, and Firecrawl key pages;
- lets the human opt into each Provider;
- accepts API keys through hidden terminal input;
- stores them in the user-level ArkSpace credential file, separate from `config.json` and `state.json`;
- preserves explicit environment variables as higher-priority overrides.

The credential file contains plaintext secrets protected by local filesystem access controls; it is not an operating-system keychain. Its default location is:

- macOS/Linux: `${XDG_CONFIG_HOME:-~/.config}/arkspace/credentials.json`
- Windows: `%APPDATA%\ArkSpace\credentials.json`
- override for isolated environments: `$ARKSPACE_HOME/credentials.json`

CI and externally managed environments may continue to provide `EXA_API_KEY`, `TAVILY_API_KEY`, or `FIRECRAWL_API_KEY` without writing the local credential file.

## Verify

```bash
arks --version
arks doctor --json
arks provider list
npx skills@latest list
```

Installation is ready when:

- `arks --version` reports `0.1.2`;
- at least one required Provider is ready in `arks doctor --json`;
- the target Agent discovers the selected ArkSpace Skills.

Optional MCP registration uses the same CLI:

```bash
claude mcp add --scope user arkspace -- arks mcp serve
codex mcp add arkspace -- arks mcp serve
```

Register MCP only for hosts that need it; Skills can execute `arks` directly.

## Update

Update within the 0.1 release line only after reviewing the target version:

```bash
npm install --global @arkspace/cli@0.1.2
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

Contributors should use the source workflow in [CONTRIBUTING.md](CONTRIBUTING.md). Release and cross-platform qualification rules are documented in [Maintenance](docs/maintenance.md) and [Platform Support](docs/platform-support.md).
