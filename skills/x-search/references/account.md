# Accounts

Profile:

```json
{"protocolVersion":1,"capability":"x.user","input":{"confirmed":true,"username":"jack","includeAbout":false}}
```

`includeAbout` adds location and account-origin details; request it only when needed. Stats can be `null` (not reported).

Timeline:

```json
{"protocolVersion":1,"capability":"x.timeline","input":{"confirmed":true,"username":"jack","tab":"posts","limit":20}}
```

`tab` is `posts` (default), `replies`, `media` or `articles`. `limit` is 1–50, a minimum, because pages are whole. Page with `cursor` only when the user needs older posts.

A protected or suspended account returns `protected-account` or `user-suspended`. Those describe the account, not a broken connection: report them and stop.
