# Local credential setup outside Agent conversations

- **Status:** accepted
- **Class:** security

## Problem

Provider-backed Skills need API keys, but an Agent conversation is not a credential-entry surface. Environment-variable-only setup also leaves users to discover Provider dashboards, choose variable names, persist shell configuration, and diagnose readiness without a guided path.

## Decision

`arks setup` is the human credential-onboarding boundary. In an interactive terminal it identifies each supported Provider, links to the Provider's key page, obtains explicit opt-in, and accepts the key through hidden terminal input. Non-interactive execution creates configuration but never requests a secret.

The wizard writes raw keys only to the user-level `credentials.json` file under the resolved ArkSpace home. Atomic writes create the directory and file with owner-only modes where the operating system supports POSIX permissions. `config.json` continues to contain `env:` references, and `state.json` continues to contain anonymous key metadata rather than secret values.

At process startup, stored values supply missing environment variables. Explicit process environment values take precedence, preserving CI and externally managed credentials. Commands and diagnostics report only variable names, counts, and file paths.

Skills direct the human to run setup in a trusted local terminal. Agents never ask users to paste API keys into chat, place keys in command arguments, or execute the interactive wizard through captured Agent input.

## Alternatives considered

**Environment variables only.** This keeps the runtime simple and works well in CI, but it leaves first-time setup fragmented across Provider dashboards and shell-specific persistence. It remains the override path rather than the only path.

**Operating-system keychains.** Keychains provide stronger at-rest protection, but macOS, Windows, Linux desktop, headless Linux, and CI expose materially different APIs and consent behavior. A keychain source can supersede the local file after it has cross-platform installed-entry evidence.

**Store raw keys in `config.json`.** This reduces file count but mixes shareable configuration with secrets and makes accidental disclosure more likely. Configuration remains reference-only.

**Ask for keys in an Agent conversation.** This is convenient but exposes secrets to conversation history, model providers, logs, and tool traces. ArkSpace designates the local terminal as the only interactive secret-entry surface.

## Consequences

The setup path is guided, repeatable, and usable without editing shell profiles. Environment variables still support CI, keychain wrappers, and operators who do not want local persistence. The local credential file contains plaintext secrets, so filesystem account security remains part of the trust boundary; the wizard discloses its location and does not claim keychain-grade protection. Windows ACL qualification remains part of platform evidence because POSIX mode bits do not establish Windows access control.
