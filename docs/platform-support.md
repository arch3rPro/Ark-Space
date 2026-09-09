# Platform Support

## Initial target

The first ArkSpace release targets local coding-agent environments that can:

- discover Agent Skills from the filesystem;
- execute local commands;
- access configured Provider endpoints;
- persist user-level configuration and state;
- request approval before installing software or causing material side effects.

Claude Code and Codex CLI are intended targets through both portable Skill installation and native plugin installation, but support is not claimed until installed-entry tests pass.

## Operating systems

The `arks` distribution and state model must pass on:

| Platform | Required evidence |
| --- | --- |
| macOS arm64 and x64 | CI on `macos-14` arm64 and `macos-15-intel`; release evidence still needs install, PATH, config/state, subprocess, network, and uninstall |
| Linux x64 and arm64 | CI on `ubuntu-latest` and `ubuntu-24.04-arm`; release evidence still needs install, XDG paths, permissions, signals, network, and uninstall |
| Windows x64 | CI on `windows-latest`; release evidence still needs install, PATH, AppData paths, locking, cancellation, network, and uninstall |

## Node runtime

ArkSpace requires a preinstalled Node.js runtime at version 20 or newer. CI exercises Node.js 20, 22, and 24 on Linux, with Node.js 22 as the cross-operating-system baseline. npm and `npx` must expose identical machine-protocol behavior; no standalone executable is currently distributed.

## Hosted and restricted environments

A local CLI dependency does not work unchanged in hosts without shell execution, network access, persistent state, or runtime installation. ArkSpace does not claim those environments in the first release. A future connector, hosted API, or MCP transport requires its own security and lifecycle design.

## Plugin installation

Claude Code and Codex manifests reference canonical Skills directly. Routine development loads repository source and requires no Codex plugin build. A versioned release tests installation from the exact tag or source revision that the marketplace will expose. Repository CI is necessary evidence but does not by itself establish installed-host support.

Host support requires evidence for discovery, CLI availability, Skill invocation, upgrade, and uninstall. Manifest validation alone is insufficient.

## Skill portability

Guidance-only and self-contained Skills may support more hosts than `arks`-dependent Skills. Each Skill declares its own compatibility instead of inheriting a project-wide claim.
