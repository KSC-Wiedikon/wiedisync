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

- **2026-06-19** **Data Health page rework (dev + prod, frontend only).** Reworked the super-admin Data Health page (`/admin/data-health`). **Fixed a data-loss bug**: date-less games were offered as a one-click (and bulk "Fix all") delete on the false assumption they were placeholders — but the Swiss Volley sync legitimately inserts real future fixtures with a pending date, so deleting them destroyed genuine games (incl. duty/scorer assignments) and the next sync just re-created them. Now a non-fixable **warning for manual review**; `checkGames` skips cancelled games for date/time checks (uses the previously-fetched-but-unused `status`). Also: auto-run the read-only scan on mount with the Wiedikon `LoadingSpinner` (load-then-render) + dim cards on rescan (matches InfraHealthPage/HomePage); issues now render in a `<Table>` (per "lists → tables") sorted issues-first with an errors-vs-warnings summary rollup (`aria-live`); a11y pass (`aria-expanded`/`aria-controls`/`aria-busy`, clean header as non-interactive `div`, decorative icons `aria-hidden`); i18n completed — added the full `dh*` block to **fr + it** (were English fallback) and localized the issue labels themselves via a stable `issueKey` (were hardcoded English in ALL locales), fixed Title-Case "Run Scan" → "Run scan", de-CH timestamp via `formatTimeZurich`; hardened `dataHealthChecks` (dropped the silent `.catch(()=>[])` on the coach/TR junction fetches that could false-flag the whole roster; `autoFixAll` now `Promise.allSettled` + reports which records failed). Build (`tsc -b`) + eslint green. **No version bump / ChangelogPage entry** — super-admin-only, not end-user-facing. **dev**: `7426e18e` pushed. **prod**: cherry-picked as `6d82205b` pushed (dev↔prod are parallel histories — cherry-pick, not merge). CF Pages auto-deploys both. No backend/schema change.

- **2026-06-19** **v1.1.0 — app-wide loading UX (dev + prod, frontend only).** Enhanced the shared `LoadingSpinner` (`src/components/LoadingSpinner.tsx`) with a gold progress bar + percentage and rotating playful messages ("Fluttering…", "Bamboozling…", …); md/lg show the bar + messages, `size="sm"` stays a bare mini-spinner (no forced 60vh) for inline/modal use. Reworked the app to **load-all-then-render**: every page now ORs its primary-data `isLoading` flags into one gate so tables/cards render fully formed instead of popping in — safe because TanStack Query reports `isLoading=false` for disabled queries. Touched ~30 files incl. the scheduling AdminDashboard (waits on teams + intra-club games), Home, Absences, the app-boot spinner in `useAuth`, JoinPage, and a parallel sweep of teams/games/scorer/trainings/forms/messaging/events/calendar/fines/spielplanung pages; converted remaining bespoke text loaders to `<LoadingSpinner />`. Bump `1.0.0` → `1.1.0` + CHANGELOG/ChangelogPage. Build green, no new lint errors. **dev**: commits `b34ce1ba`+`70bb8415` pushed. **prod**: cherry-picked as `5bfd4272`+`baf96b9d` pushed (dev↔prod are parallel histories — cherry-pick, not merge). CF Pages auto-deploys both apps (main + scheduling). No backend/schema change.

- **2026-06-19** **v1.0.0 baseline.** Consolidated the entire pre-1.0 development history (wiedisync had reached internal v5.2.0) into a single official **v1.0.0** release: `CHANGELOG.md` + the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`, `APP_VERSION` → `1.0.0`) collapsed to one launch entry grouped by feature area, `package.json` bumped `5.2.0` → `1.0.0`, and this DEVLOG reset to a fresh baseline with the prior dated entries moved verbatim to [`DEVLOG-archive.md`](DEVLOG-archive.md). The companion `kscw-website` was re-baselined to `1.0.0` in the same pass. No code/schema/runtime change — docs + version metadata only. Not yet committed/deployed at the time of writing.
