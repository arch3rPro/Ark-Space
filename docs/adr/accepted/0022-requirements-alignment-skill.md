# Requirements alignment Skill

- **Status:** accepted
- **Class:** Skill boundary

Canonical guidance lives at `skills/askme/SKILL.md`. It owns consequential requirement clarification, preservation of agreed constraints across turns, and recovery from execution drift. Explicit invocation and implicit selection are supported; clear tasks continue without an interview or universal approval gate. The recovery branch loads a Skill-local reference for distinguishing fact corrections, challenges, hypotheticals, preferences, and actual requirement changes.

This is a guidance-only Skill with conversational follow-up and optional host read/search tools. It requires no `arks` capability, sibling Skill, network, credential, script, or persistent state. Domain Skills retain their own operations, acceptance checks, and side-effect authorization. No existing Skill is changed to depend on `askme`; the canonical plugin directory discovers it directly and version metadata is unchanged.

A mandatory interview before every task would obstruct clear authorized work. A general decision or learning Skill would broaden the agreed scope. Instead, clarification stops when the outcome, consequential constraints, acceptance evidence, and next action are sufficiently clear. Agent metadata enables implicit invocation on supporting hosts; guidance and fixture validation do not prove reliable automatic selection or cross-turn behavior on every model.
