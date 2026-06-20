# Wiedisync — Dev / Deploy Log

Operator-facing history of backend, deploy, and migration work on the wiedisync platform.
Newest first.

This is the dev/ops narrative (migration numbers, dev + prod deploy status, internal IDs,
file paths, root-cause notes). It is deliberately distinct from:

- **CHANGELOG.md** — curated, user-facing release notes (English, semver), mirrored in `src/modules/changelog/ChangelogPage.tsx`.
- **git log** — the full commit-level detail.

At the end of a substantive backend/deploy session, append a dated entry here (one line per entry).
`CLAUDE.md → Recent dev log` keeps only the last few entries for at-a-glance context.

The full pre-1.0 operator/deploy history is preserved in [`DEVLOG-archive.md`](DEVLOG-archive.md).

---

- **2026-06-20** **v1.2.0 — rankings season selector + multi-season archive (prod).** Promoted the rankings season feature to prod via isolated worktree (cherry-pick of dev `cca7e90e` home dropdown + `f44d7bd4` release): season `<Select>` on the Games rankings tab + Home widget (default = latest season with data; current season offered as a "Data to be shared later by Swiss Volley" placeholder). Backend (already applied to prod earlier this session): `sv-sync`/`bp-sync` ranking upserts now key on `(team_id, league, season)` with per-group season derived from `league.season`; **migration 121** unique index on the triple; 2024/25 backfilled (78→203 rows) via `backfill-rankings-history.mjs`. Bump `1.1.0` → `1.2.0`. dev↔prod are parallel histories — cherry-pick, not merge. See the dev DEVLOG entry for full root-cause detail.

- **2026-06-19** **v1.0.0 baseline (prod).** Consolidated the entire pre-1.0 development history (wiedisync had reached internal v5.2.0) into a single official **v1.0.0** release: `CHANGELOG.md` + the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`, `APP_VERSION` → `1.0.0`) collapsed to one launch entry grouped by feature area, `package.json` `5.2.0` → `1.0.0`, and this DEVLOG reset to a fresh baseline with the prior dated entries moved verbatim to [`DEVLOG-archive.md`](DEVLOG-archive.md). Promoted to prod via isolated worktree (cherry-pick-not-merge of the dev consolidation `7c4ad27a`), leaving the main-tree WIP untouched. Docs + version metadata only — no code/schema/runtime change.
