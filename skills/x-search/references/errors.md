# Failures

A failed envelope has `ok: false` and `error.kind`.

| kind | Meaning | Next step |
| --- | --- | --- |
| `invalid-request` | Input failed validation or `confirmed` is not true | Fix the request; do not retry unchanged |
| `config` | No usable Nitter connection, or only half the external pair | Ask the user to run `arks setup nitter` |
| `auth` | The instance rejected the token | Ask the user to fix the token in their terminal |
| `permission` | The instance refused the request origin or policy | Report it |
| `rate-limit` | X sessions are limited | Wait `retryAfterSeconds`, then at most one retry |
| `transient` | Instance or X is briefly unavailable | One retry later; then report |
| `upstream-error` | X returned an error | Report; a retry rarely helps |
| `not-found` | Tweet or account does not exist | Report as missing |
| `protected-account`, `user-suspended` | Account state | Report; stop |
| `invalid-response` | Reply was not the expected JSON | Report; suspect the wrong URL or a proxy |
| `timeout`, `network`, `cancelled` | Transport outcomes | Report; retry once only if the user wants |

Never retry in a loop, and never switch to another source to hide a failure; say what failed.
