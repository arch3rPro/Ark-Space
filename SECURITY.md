# Security Policy

## Project Status

ArkSpace is in a pre-release design stage. Security reports should target the current repository state and clearly identify whether the issue affects documentation, a future contract, or implemented code.

## Reporting a Vulnerability

Do not publish sensitive vulnerability details in a public issue.

Use the most appropriate private maintainer contact available for the repository. If none is available, open a minimal public issue requesting a private contact path and omit exploits, credentials, private URLs, and user data.

Include:

- affected files, commands, or capability;
- impact and likely severity;
- safe reproduction steps or proof of concept;
- affected operating systems or hosts;
- suggested mitigation, if available.

## Security-Sensitive Areas

- CLI installation and update paths;
- Provider HTTP clients and response parsing;
- API key references, key pools, cooldown state, and redaction;
- config and state file permissions;
- subprocess environment and temporary files;
- browser interaction and persistent monitoring;
- Skill instructions that install software or cause external side effects;
- untrusted web content and prompt-injection boundaries.

## Required Guarantees

- Raw credentials do not enter committed files, persisted state, logs, diagnostics, fixtures, or telemetry.
- Installation uses an official source with version and integrity verification where artifacts are downloaded directly.
- Material environment changes and external side effects require user consent.
- Provider failures are classified without exposing secrets.
- Browser sessions and monitors have explicit owners and verified cleanup or deletion.

Maintainers should acknowledge reports when practical, investigate scope, prepare a mitigation, and disclose details only after affected users have a safe path forward.
