# Live scoring — Directus setup

Operational reference for the live-scoring backend. The LedBox board publishes its
state to a Directus `live_scores` item; the wiedisync `/live` page reads it (~3s
poll + optional realtime). No Cloudflare Worker, no Durable Object, no paid plan —
just the club's existing Directus.

Design rationale: `../../../.planning/live-scoring-DESIGN.md`.
Board publisher code: `ledbox-bridge/src/livePush.proposal.js` (standalone).

**Status:** LIVE on **dev and prod** (2026-08-03, v1.60.0) — collection, public
read, publisher policy and a service token per environment. Each environment has
its **own** token; they are not interchangeable.

---

## 1. The `live_scores` collection

Created by **migration `directus/scripts/272-live-scores.sql`** (table + Directus
registration + the seeded `kscw` row). Apply it with `npm run db:migrate:dev` /
`:prod` — do **not** hand-build the collection in the admin UI, or dev and prod
drift and a fresh install from `SCHEMA.sql` misses it.

The primary key IS the channel (`kscw`) — a manual string, not a serial. One
physical scoreboard → one row it keeps overwriting.

| Field | Directus type | DB type | Notes |
|---|---|---|---|
| `channel` | String (**primary key**, manual) | `varchar` | e.g. `kscw` |
| `sport` | String (dropdown) | `varchar` | `volleyball` \| `beach` \| `basketball` |
| `status` | String (dropdown) | `varchar` | `live` \| `idle` \| `final` |
| `event` | String (nullable) | `varchar` | `set-end` \| `match-end` \| `switch-8` \| empty |
| `ts` | Big Integer | `bigint` | ms epoch of the change; app ordering/seq key |
| `over` | Boolean | `boolean` | the firmware's match-over flag — a hint; `status` wins |
| `period` | Integer | `integer` | basketball `1..4` = Q1–Q4, `5+` = OT. Volleyball may send the set number |
| `side_a` | String | `varchar` | always `left` (getState projects A→left) |
| `team_a_name` | String | `varchar` | beach: the pair, e.g. `Müller / Meier` |
| `team_a_short` | String | `varchar` | |
| `team_a_color` | String (Color interface) | `varchar` | hex, e.g. `#4A55A2` |
| `team_b_name` | String | `varchar` | |
| `team_b_short` | String | `varchar` | |
| `team_b_color` | String (Color interface) | `varchar` | hex, e.g. `#FFC832` |
| `points_a` | Integer | `integer` | volleyball: current set · basketball: running score |
| `points_b` | Integer | `integer` | |
| `sets_won_a` | Integer | `integer` | volleyball / beach only |
| `sets_won_b` | Integer | `integer` | |
| `timeouts_a` | Integer | `integer` | this set / period |
| `timeouts_b` | Integer | `integer` | |
| `subs_a` | Integer | `integer` | volleyball only — beach has no substitutions |
| `subs_b` | Integer | `integer` | |
| `fouls_a` | Integer | `integer` | basketball team fouls **this period**; 5+ puts the opponent in the bonus |
| `fouls_b` | Integer | `integer` | |
| `serving_team` | String (nullable) | `varchar` | `left` \| `right`; basketball reuses it as the **possession arrow** |
| `set_results` | JSON | `jsonb` | `[{ "a": 25, "b": 20 }, …]` completed sets |
| `date_updated` | Timestamp (system, "Date Updated") | `timestamptz` | auto |

`CHECK` constraints pin `sport`, `status` and `serving_team` to the values above —
a typo from the board is rejected rather than silently mis-rendered. The push is
best-effort on the board side, so a rejected write stalls `/live`, never scoring.

### One row, three sports

The board publishes a superset; `/live` renders only what the sport uses:

| | volleyball | beach | basketball |
|---|---|---|---|
| big number | points in the current set | same | running score |
| middle column | sets won + current set | same | period (Q1–Q4/OT) + possession arrow |
| per-team meta | timeouts, substitutions | timeouts | team fouls, timeouts |
| extras | set history chips, serve dot | set history, serve dot, pair names stacked | bonus badge |

Basketball reuses `serving_team` for possession because the left/right semantics
are identical — it needs no column of its own.

---

## 2. Public read (so the `/live` page works for anyone)

The scoreboard is a public spectator page and most viewers aren't logged in, so
the **Public** policy has read on `live_scores`. It is declared in
`directus/scripts/setup-permissions.mjs` §5 (the single source of truth per
`CLAUDE.md` — never a permission row in a migration):

```js
await setPermRead(PUBLIC_POLICY, 'live_scores')
```

The row holds nothing but a score, two team names and their colours, so it is
public in full (no field scoping).

---

## 3. Publisher token (so the board may write)

The board writes with a Directus **static token** scoped to `live_scores` only.
Declared in `setup-permissions.mjs` §5b:

```js
const LEDBOX_POLICY = await findOrCreatePolicy('KSCW LedBox Publisher', { icon: 'scoreboard', app_access: false })
await clearPolicyPermissions(LEDBOX_POLICY, 'LedBox Publisher')
await setPerm(LEDBOX_POLICY, 'live_scores', 'create')   // self-heals a missing row
await setPerm(LEDBOX_POLICY, 'live_scores', 'read')     // PATCH reads the row back
await setPerm(LEDBOX_POLICY, 'live_scores', 'update')   // every score change
```

No delete, no app access, and no *granted* permission outside `live_scores`.
Verified on both: `DELETE /items/live_scores/kscw` → 403.

⚠️ **What the token can nonetheless read.** Directus policies are additive and the
**Public** policy applies to authenticated requests too, so the board token also
gets every public grant. On prod that means `members` limited to
`id, first_name, last_name, photo` — the public team-page set. It is **not**
identical to what an anonymous visitor sees: the website name-privacy hook
(`kscw-hooks/src/index.js`, migration 116) abbreviates the surname only when
`!currentUser`, so an anonymous reader gets `Oscar B.` while any token-bearing
request gets `Oscar Bizard`. Phone, email, birthdate and AHV stay hidden either
way (those gates don't depend on the caller being anonymous).

So a leaked board token exposes full member surnames + photos — data every
logged-in member already sees, but more than the public site publishes. There is
no way to subtract it from the publisher policy (Directus has no deny rule); the
fix, if wanted, is to make that hook minimise for any user with no linked
`members` row rather than only for anonymous ones. That is a change to a shared
security hook affecting every service account, so it is deliberately **not** bundled
into this feature. Treat the token as a password and rotate it if the board is lost.

The policy is held by one service user, **`ledbox-board@kscw.ch`**, via
`directus_access` (never attached to a role). Its static token lives on
`directus_users.token`; rotate by generating a new one on that user (User
Directory → the user → Token → Generate → Save).

---

## 4. Realtime — instant push for logged-in members

**Already enabled on dev and prod** (`WEBSOCKETS_ENABLED=true`, present in both
`/opt/directus-kscw*/.env` and the running containers — verified 2026-08-03 by
opening `wss://directus{,-dev}.kscw.ch/websocket` from a real browser: both
connect). Nothing to do.

⚠️ Probing that endpoint with **curl returns 404** even though it works — the
prod/dev hosts sit behind a Cloudflare firewall that rejects non-browser clients
(see `INFRA.md` → scripted calls need a browser User-Agent). Direct to the
container, `curl` gets the expected `101 Switching Protocols`. Don't chase that
404; test realtime from a browser.

Polling (~3s) remains the baseline and works for everyone. The app's shared client subscribes to
`live_scores` automatically; it authenticates over the session cookie
(handshake), so realtime accelerates the page only for authenticated members —
anonymous spectators keep getting the 3s poll. No CSP change is needed: both
`https://directus*.kscw.ch` and `wss://directus*.kscw.ch` are already in the
`connect-src` allowlist in `public/_headers`.

---

## 5. Board environment (LedBox bridge)

Set these on the board (`ledbox-bridge/.env` or the systemd `EnvironmentFile`) —
distinct from the LAN relay vars, so they can't clobber `RELAY_URL`:

```
DIRECTUS_URL=https://directus.kscw.ch        # dev: https://directus-dev.kscw.ch
LIVE_PUBLISH_TOKEN=<the static token from §3>
LIVE_CHANNEL=kscw
```

`livePush.proposal.js` is a no-op until both `DIRECTUS_URL` and
`LIVE_PUBLISH_TOKEN` are set. It stays standalone — wiring it into the bridge is a
separate, later step (see the roadmap); nothing imports it today.

⚠️ It must also publish `sport` (and `period` / `fouls_*` for basketball), or the
page renders every match as volleyball.

---

## 6. Verify

```bash
# Public read (no auth) — should return the row:
curl "$DIRECTUS_URL/items/live_scores?filter[channel][_eq]=kscw&limit=1"

# Board write (with the publisher token) — should 200:
curl -X PATCH "$DIRECTUS_URL/items/live_scores/kscw" \
  -H "Authorization: Bearer $LIVE_PUBLISH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"sport":"volleyball","status":"live","team_a_short":"KSCW","team_b_short":"VZ","points_a":23,"points_b":21,"sets_won_a":1,"sets_won_b":1,"serving_team":"left","set_results":[{"a":25,"b":20}],"ts":'"$(date +%s000)"'}'

# Basketball:
curl -X PATCH "$DIRECTUS_URL/items/live_scores/kscw" \
  -H "Authorization: Bearer $LIVE_PUBLISH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"sport":"basketball","status":"live","team_a_short":"KSCW","team_b_short":"BCZN","points_a":64,"points_b":58,"period":3,"fouls_a":5,"fouls_b":3,"timeouts_a":2,"timeouts_b":1,"serving_team":"right","ts":'"$(date +%s000)"'}'

# Back to the empty state:
curl -X PATCH "$DIRECTUS_URL/items/live_scores/kscw" \
  -H "Authorization: Bearer $LIVE_PUBLISH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"idle","ts":'"$(date +%s000)"'}'
```

Then open `/live` and watch it update within ~3s.

---

## 7. Environment notes

Both environments are done (2026-08-03). Two things to remember:

- ⚠️ The dev DB is overwritten nightly by a scrubbed prod clone (03:00 UTC).
  `live_scores` now survives that (it exists on prod), but the **dev publisher
  token does not** — the clone brings prod's `directus_users` across, so after a
  refresh the board's dev config needs the token re-pinned (or just re-run the
  `ledbox-board@kscw.ch` token generation on dev).
- **Prod has had a full `npm run db:setup-perms:prod` reconcile** (2026-08-03,
  535 grants / 0 errors, `directus_permissions` row count unchanged at 572 before
  and after), so the declarative blocks in §2/§3 are verified to reproduce exactly
  this state. **Dev** was done with a targeted script only — it still fails the
  full run on the keyless licence — but the same blocks apply there on the next
  licensed run.

---

## Data flow summary

```
LedBox board bridge                       Directus (existing, free)         wiedisync /live
────────────────────                      ─────────────────────────         ───────────────
manualSource.getState()  ── PATCH ───▶     live_scores/kscw  (1 row)
  + lastEvent               Bearer token   sport/status/event/ts + flat fields
                                                   │
                                    GET ?filter[channel]=kscw  (public)  ◀── ~3s poll (all viewers)
                                    WS subscribe live_scores   (session) ◀── realtime (members, optional)
```
