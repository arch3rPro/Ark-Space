# Adding Skills

## Choose the execution model

Classify the Skill before creating files:

| Model | Choose it when |
| --- | --- |
| Guidance only | The host already has the tools and the Skill mainly supplies judgment or workflow |
| Skill-local script | Deterministic behavior is self-contained and does not coordinate shared state |
| ArkSpace capability | Credentials, Provider fallback, quotas, or durable state must be shared |
| External tool | A domain application already owns the operation |

A new Skill does not use `arks` merely because it belongs to ArkSpace.

## Define the boundary

Write down:

1. representative user prompts that should activate the Skill;
2. prompts that should activate a neighboring Skill instead;
3. the output and completion condition;
4. external side effects and required confirmation;
5. required tools, system packages, network access, and supported hosts.

Split a Skill when activation, lifecycle, safety, or completion semantics differ. Merge operations when users express one intent and the same instructions govern the result. Provider implementation boundaries do not determine Skill boundaries.

## Directory shape

```text
skills/<skill-name>/
├── SKILL.md
├── scripts/       # optional deterministic code
├── references/    # optional branch-specific guidance
└── assets/        # optional templates or resources
```

Use the open Agent Skills frontmatter requirements. Put specific environment requirements in `compatibility`. Keep the description focused on what the Skill does and when it should activate.

## Tool dependencies

If a required tool may be missing:

1. detect it and verify a compatible version;
2. explain why the operation needs it;
3. ask before modifying the environment;
4. install only from an official, verifiable source;
5. run a focused doctor or smoke check;
6. resume the original task.

Installation guidance is valid Skill behavior, but it is not portable to hosts without shell, network, or package-install access. State that limitation honestly.

## Shared capabilities

A Skill using ArkSpace shared execution calls the machine protocol:

```bash
arks invoke <capability> --input <json-file>
```

It does not import `src/`, inspect internal Provider modules, or parse human-oriented CLI output. Declare the minimum protocol and capability version it needs.

## Verification

- Test representative activation and non-activation prompts.
- Copy the Skill into an isolated temporary host layout.
- Remove access to sibling Skills and the source repository.
- Exercise the documented entry path.
- Verify the external result rather than only trusting command success.
