## 1. Generic, deduped error mappers (cognitoAuth.ts)

- [x] 1.1 Extract `cognitoErrorCode(err)` and `cognitoMessage(err, fallback)` helpers (dedup)
- [x] 1.2 `mapLoginError`: generic "Invalid email or password." for credential failures; distinct code-step and network messages; generic default (no raw upstream message)
- [x] 1.3 Export `mapLoginError`/`mapRefreshError` for unit testing

## 2. Keyed challenge store (src/ui/pendingSessions.ts)

- [x] 2.1 `PendingSessions`: `create(client) -> id` (opaque), `get(id) -> client | undefined` (peek, expiry-checked) + `remove(id)`, injectable `now`, TTL default ~10 min
- [x] 2.2 Sweep/expire stale entries

## 3. Wire UI (server.js + index.html)

- [x] 3.1 `server.js`: use `PendingSessions`; `/login` returns `sessionId` on code_required; `/submit-code` takes `{ sessionId, code }` and rejects missing/expired
- [x] 3.2 `server.js`: relay only the mapped (safe) error messages
- [x] 3.3 `index.html`: store the `sessionId` from `/login` and send it with `/submit-code`

## 4. Tests

- [x] 4.1 `mapLoginError`/`mapRefreshError`: credential failures → generic AuthError; code/network distinct; refresh default → NeedsReauth
- [x] 4.2 `PendingSessions`: create→get round-trips; get after remove returns undefined; expired entry returns undefined; distinct ids isolate concurrent flows

## 5. Verify & ship

- [x] 5.1 `npm run build` + `npm run lint` + `npm test` green
- [x] 5.2 Adversarial review panel scoped to the changed modules; address regressions
- [x] 5.3 Archive (sync spec) and open the stacked PR (no merge)
