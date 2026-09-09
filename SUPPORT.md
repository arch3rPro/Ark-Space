# Support

ArkSpace is currently in architecture and migration planning. There is no supported replacement release or stable CLI contract yet.

## Design Questions

A useful design report includes:

- the user task or capability involved;
- the proposed behavior and completion condition;
- whether it changes a Skill, `arks`, a provider adapter, installation, or persistent state;
- affected hosts and operating systems;
- a concrete example rather than only a preferred implementation.

## Future Runtime Issues

Once implementation begins, include:

- `arks version --json` output;
- operating system, architecture, shell, and Node version;
- exact command and redacted output;
- capability and Provider involved;
- whether multiple API keys, fallback, browser state, or monitoring is active;
- the smallest safe reproduction.

Never include API keys, private endpoints, authentication headers, or sensitive page content.

## Boundaries

ArkSpace can support its own Skills, CLI, installation path, and Provider adapters. Provider outages, account policy, and unrelated host configuration remain upstream concerns unless ArkSpace misreports or mishandles them.
