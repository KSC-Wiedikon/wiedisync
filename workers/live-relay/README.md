# kscw-live-relay

Cloudflare **Worker + Durable Object** that relays the LedBox scoreboard's live
state to the wiedisync **Live** page.

```
LedBox board bridge  --POST /publish/:channel-->  Worker  -->  LiveMatchRelay (DO)
                                                                     |  holds current
                                                                     |  match + history
wiedisync Live page  <--SSE  GET /subscribe/:channel--  Worker  <----+  fans out
```

> **Status: scaffold. Not deployed, not committed.** This directory sits next to
> the repo's other Workers (`../push`, `../sentry-tunnel`) but is inert until the
> steps in `../../.planning/live-scoring-ROADMAP.md` are done.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/subscribe/:channel` | public | SSE stream (`snapshot` then `update` events) |
| `POST` | `/publish/:channel` | `Bearer RELAY_TOKEN` | push one board snapshot |
| `GET` | `/state/:channel` | public | current envelope as JSON (poll/debug) |
| `GET` | `/history/:channel` | public | completed matches, newest first |
| `POST` | `/reset/:channel` | `Bearer RELAY_TOKEN` | clear current match → idle |
| `GET` | `/healthz` | public | liveness |

`:channel` defaults to `DEFAULT_CHANNEL` (`kscw`) — one physical board, one channel,
one Durable Object instance.

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars   # set RELAY_TOKEN
npm run dev                      # wrangler dev, prints a localhost URL

# watch a channel
curl -N http://localhost:8787/subscribe/kscw

# push a snapshot (another terminal)
curl -X POST http://localhost:8787/publish/kscw \
  -H "Authorization: Bearer $(grep RELAY_TOKEN .dev.vars | cut -d= -f2)" \
  -H 'Content-Type: application/json' \
  -d '{"state":{"side_a":"left","team_a_name":"KSC Wiedikon","team_a_short":"KSCW","team_a_color":"#4A55A2","team_b_name":"Volley Züri","team_b_short":"VZ","team_b_color":"#FFC832","points_a":23,"points_b":21,"sets_won_a":1,"sets_won_b":1,"timeouts_a":1,"timeouts_b":0,"subs_a":2,"subs_b":3,"serving_team":"left","set_results":[{"a":25,"b":20},{"a":22,"b":25}]},"event":null}'
```

## Deploy (needs the user — see ROADMAP)

```bash
npx wrangler secret put RELAY_TOKEN   # same value the board bridge will send
npm run deploy
```

Durable Objects require a **paid Workers plan**. First deploy also runs the `v1`
SQLite migration in `wrangler.jsonc`.

## Design

Full architecture, message shapes and the SSE-vs-WebSocket rationale:
`../../.planning/live-scoring-DESIGN.md`.
