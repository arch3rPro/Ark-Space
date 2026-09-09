# Node/TypeScript `arks` CLI as the shared execution boundary

- **Status:** proposed
- **Class:** architecture

## Problem

ArkSpace needs centralized execution for capabilities that share provider credentials, multiple API key rotation, cooldown, fallback, and durable state. Skills must not depend on repository-relative scripts or import runtime code from sibling skill directories. The execution tool must also be installable on Windows, macOS, and Linux without reproducing the existing Python environment problems.

## Proposal

Implement a standalone ArkSpace CLI in Node.js and TypeScript. Publish it under a scoped npm package and expose the single public command `arks`.

Skills that require shared execution call a versioned machine interface:

```bash
arks invoke <capability> --input <json-file>
```

Requests and responses use versioned JSON contracts. Human-oriented subcommands are convenience clients over the same capability handlers. Skills never import CLI source or rely on the repository layout.

MCP is not required for the first release. A future MCP transport may reuse the same handlers if a supported host needs it.

The implementation remains one package initially. Provider contracts are narrow per operation; dynamic provider plugins are deferred until a third-party provider implementation exists.

The proposal is conditional on a packaging spike proving npm and at least one dependable cross-platform installation path. The spike also evaluates Node SEA or Bun compilation without making a standalone binary an initial requirement.

## Alternatives considered

**Skill-local scripts for every provider capability.** This maximizes individual Skill portability but duplicates key-pool, cooldown, credential, redaction, and fallback behavior. Separate `web` and `research` installations would maintain inconsistent state for the same provider keys.

**MCP-first runtime.** MCP gives a structured tool transport but adds host configuration and a long-running process before local coding agents need either. It remains an optional adapter rather than the core boundary.

**Python runtime.** Existing behavior could be moved more quickly, but interpreter versions, package installation, virtual environments, and platform differences are part of the problem being removed.

**Rust CLI.** Rust provides strong cross-platform binaries and robust concurrency. It loses to Node/TypeScript for the first implementation because provider and AI integration iteration speed is the current priority. Reconsider it if the Node packaging spike cannot provide reliable installation or state persistence.

**Go CLI.** Go also provides straightforward binaries, but it offers no decisive advantage over Rust for distribution or Node/TypeScript for the targeted ecosystem and development workflow.

## Acceptance criteria

1. `arks` installs and runs on Windows, macOS, and Linux through a documented path.
2. Skills communicate exclusively through versioned JSON and public commands.
3. Human and machine commands share capability implementations.
4. Multiple CLI processes update key-pool state safely.
5. stdout remains valid machine output; diagnostics use stderr.
6. Secrets never appear in persisted state or emitted results.
7. Missing and incompatible CLI versions produce actionable Skill instructions.
8. No first-release feature requires MCP.

## Risks

- npm installation still depends on an available compatible Node runtime unless a bundled executable is shipped.
- Native SQLite or keychain dependencies can complicate cross-platform distribution.
- A public process protocol requires compatibility discipline earlier than an internal library.
- Central execution can become a new monolith if capability handlers, provider adapters, installation tooling, and unrelated future Skills are not kept separate.
