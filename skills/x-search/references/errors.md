# Failures

A failed envelope has `ok: false` and `error.kind`; `error.reason` is optional. When present, `reason` is one of `input-unreadable`, `input-json`, `request-schema`, `confirmation-required`, `capability-disabled`, or `response-schema`. Treat these as fixed safe classifications: report the kind/reason and the documented next step, never expose raw error text, paths, or credentials.

| kind | Meaning | Next step |
| --- | --- | --- |
| `invalid-request` | Local input, confirmation, enablement, or upstream argument failure | Use `error.reason` below when present; do not retry unchanged |
| `config` | No usable Nitter connection, or only half the external pair | Ask the user to run `arks setup nitter` |
| `auth` | The instance rejected the token | Ask the user to fix the token in their terminal |
| `permission` | The instance refused the request origin or policy | Report it |
| `rate-limit` | X sessions are limited | Wait `retryAfterSeconds`, then at most one retry |
| `transient` | Instance or X is briefly unavailable | One retry later; then report |
| `upstream-error` | X returned an error | Report; a retry rarely helps |
| `not-found` | Tweet or account does not exist | Report as missing |
| `protected-account`, `user-suspended` | Account state | Report; stop |
| `invalid-response` | Reply was not the expected JSON or fields | For `response-schema`, report instance compatibility; otherwise check the URL or proxy |
| `timeout`, `network`, `cancelled` | Transport outcomes | Report; retry once only if the user wants |

| reason | Next step |
| --- | --- |
| `input-unreadable` | Check that the input file or stdin exists and is readable |
| `input-json` | Correct the JSON syntax |
| `request-schema` | Check the capability fields, types, and limits |
| `confirmation-required` | Obtain consent before setting `confirmed: true` |
| `capability-disabled` | Ask the user to review local capability enablement; do not silently enable it |
| `response-schema` | Report an incompatible instance response; do not treat it as empty or complete results |

Never retry in a loop, and never switch to another source to hide a failure; say what failed.
