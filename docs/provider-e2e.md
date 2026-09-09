# Credentialed Provider E2E

Fixture tests are the default and never require Provider credentials. To configure disposable keys, the protected GitHub environment, the public test webhook, and release identity through hidden prompts, run:

```bash
./scripts/setup-release-e2e.sh
```

The wizard asks separately before incurring charges. To configure or run manually before a release candidate:

```bash
export EXA_API_KEY='...'
export TAVILY_API_KEY='...'
export FIRECRAWL_API_KEY='...'
export ARKSPACE_E2E_WEBHOOK_URL='https://test-receiver.example/arkspace'
export ARKSPACE_E2E_CONFIRM='I_ACCEPT_REMOTE_CHARGES_AND_PERSISTENT_RESOURCES'
npm run test:e2e
```

The same suite is available as the manually dispatched `Provider E2E` workflow. Configure a protected `provider-e2e` GitHub environment with the four named secrets and required reviewer approval; the workflow is never triggered by push or pull request and does not cancel an in-progress run.

The webhook receiver must be public HTTPS, isolated from production, and able to discard test deliveries. Do not put any of these values in repository files, shell history shared with others, CI logs, or issue text. Prefer a secret manager that injects environment variables into one process.

## Scope

The suite exercises every Exa, Tavily, and Firecrawl Provider family through the built `arks invoke` entry. It covers retrieval, crawl/extract jobs, both research adapters, Browser open/snapshot/status/close, the complete Exa Monitor mutation and history path, and the Firecrawl Site Monitor mutation and check path.

The suite uses `example.com`, minimal result/page limits, concise research, one-hour Exa cadence, weekly Firecrawl cadence, and one-day Firecrawl retention to bound cost and risk. It prints capability names only; it does not print Provider results, raw keys, or webhook secrets.

## Safety

The exact confirmation string is mandatory because the suite creates paid and persistent remote resources. Every received Browser or Monitor ID is registered for cleanup immediately. Normal failure, SIGINT, and SIGTERM paths attempt close or deletion before removing temporary local state.

A create operation can still end in `acceptance-unknown` before ArkSpace receives an ID. A process can also be killed without running cleanup. After every interrupted or failed live run, inspect all three Provider dashboards and delete any resource with the `ArkSpace release E2E` name before retrying.

A passing live run is time-bound evidence, not a permanent guarantee. Record the date, CLI commit, Node/OS, Provider API versions where exposed, and redacted account identifiers in the release checklist; never commit credentials or response payloads.
