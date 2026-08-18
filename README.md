# Wiedisync

Internal platform for **KSC Wiedikon** — managing teams, games, trainings, and club operations for a volleyball and basketball club in Zurich, Switzerland.

**Live:** [wiedisync.kscw.ch](https://wiedisync.kscw.ch)

> See `CLAUDE.md` for conventions and `INFRA.md` for infra/deploy details.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Backend | [Directus](https://directus.io) (Postgres REST API + Realtime) |
| Auth | Google OAuth + email/password via Directus |
| Testing | Playwright (E2E), Vitest (unit) |
| Hosting | Cloudflare Pages (frontend), Hetzner VPS (backend) |
| i18n | i18next (DE / EN / FR / GSW / IT) |

## Features

- **Games** — Volleyball (Swiss Volley sync) and basketball (Basketplan sync) with scores, rankings, and participation tracking
- **Trainings** — Recurring schedules, RSVP, and email reminders
- **Hallenplan** — Hall booking overview with closures, slot claims, and Google Calendar sync
- **Schreibereinsaetze** — Scorer duty assignments with delegation and iCal export
- **Spielplanung** — Season scheduling with opponent invites and game booking (Terminplanung), conflict detection, VolleyManager push, and an embedded scheduling mailbox
- **Teams & Rosters** — Multi-sport roster management, player profiles, photos, and sponsor display
- **Messaging** — Team chat and direct messages with reactions, polls, and reports
- **News** — Club news (Vereinsnews) and broadcasts via email and push
- **Forms** — Internal form builder with team-scoped submissions
- **Fines** — Team fine rules and tracking (Bussenkasse)
- **Carpool** — Ride coordination for games and events
- **Polls** — In-app voting
- **Tasks** — Team task assignments
- **Notifications** — Web push (Cloudflare Workers), email reminders, activity alerts
- **Admin tools** — Native DB panel (SQL editor, table browser, schema viewer), ClubDesk CSV sync
- **Calendar** — Unified view with home/away colors and iCal feed generation
- **Feedback** — In-app feedback form with Turnstile CAPTCHA
- **Dark mode** — Full dark mode with semantic design tokens

## Project Structure

```
src/
  modules/        # Feature modules (games, trainings, teams, scorer, calendar, etc.)
  components/     # Shared UI components + shadcn/ui primitives
  hooks/          # React hooks (auth, queries, mutations, theme, etc.)
  utils/          # Helpers (dates, team colors, league tiers)
  i18n/           # Translation files
  lib/            # Library utilities
  data/           # Static data
  types/          # Shared TypeScript types
  assets/         # Static assets
directus/
  extensions/     # Directus custom endpoints + hooks
  scripts/        # DB setup, migrations & utility scripts
e2e/              # Playwright E2E tests
workers/          # Cloudflare Workers (push, sentry-tunnel)
```

## Getting Started

```bash
cp .env.example .env    # Configure Directus URL
npm install
npm run dev             # Dev server at localhost:1234
npm run build           # Production build → dist/
```

## Testing

```bash
npm test                # Playwright E2E
npm run test:unit       # Vitest unit tests
```

## Code graph

`npm run graph` builds a navigable knowledge graph of the repo into `graphify-out/`
(gitignored) — `graph.html` to browse, `GRAPH_REPORT.md` for the audit report,
`graph.json` for querying. Pure tree-sitter AST: deterministic, ~25s, zero LLM tokens.

One-time setup:

```bash
uv tool install graphifyy
uv pip install --python "$(uv tool run --from graphifyy python -c 'import sys; print(sys.executable)')" tree-sitter-sql
```

`tree-sitter-sql` is **required**, not optional — without it graphify silently drops
all 328 `.sql` files (SCHEMA.sql plus every migration). `npm run graph` hard-fails
with the exact install command rather than producing a graph that looks complete.
Do not `pip install` either package: system Python is PEP 668 externally-managed and
lacks `ensurepip`, so `pip install` and `python3 -m venv` both fail; and graphify's uv
tool venv has no `pip`, which is why the second command uses `uv pip --python`.

The script also patches two graphify gaps documented in its docstring: tsconfig
project `references` (this repo's `@/*` alias lives in `tsconfig.app.json`, which
graphify never reads) and a `queries` bridge from data-access call sites to the SQL
tables they name. Bridge edges are tagged `INFERRED`; for AST-only ground truth drop
`relation in {"queries", "indirect_call"}`.

## Deployment

All changes go through `dev` first.

- **Frontend:** Pushing to `dev` auto-deploys the preview at [wiedisync.pages.dev](https://wiedisync.pages.dev) (Cloudflare Pages). An approval-gated merge of `dev` → `prod` deploys to [wiedisync.kscw.ch](https://wiedisync.kscw.ch).
- **Backend:** Directus runs as plain Docker on Hetzner (not Coolify). Deploy extensions with `npm run ext:deploy:dev` / `npm run ext:deploy:prod` (rsync + container restart); apply DB migrations and permissions with `npm run db:deploy:dev` / `npm run db:deploy:prod`.

See `CLAUDE.md` (Branches & Dev-First Workflow) and `INFRA.md` for the full flow.

## Related

- [KSCW Website](https://github.com/Lucanepa/kscw-website) — Public club website
- [Directus API](https://directus.kscw.ch) — Backend API
