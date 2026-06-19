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

- **2026-06-19** **v1.1.0 — app-wide loading UX (dev + prod, frontend only).** Enhanced the shared `LoadingSpinner` (`src/components/LoadingSpinner.tsx`) with a gold progress bar + percentage and rotating playful messages ("Fluttering…", "Bamboozling…", …); md/lg show the bar + messages, `size="sm"` stays a bare mini-spinner (no forced 60vh) for inline/modal use. Reworked the app to **load-all-then-render**: every page now ORs its primary-data `isLoading` flags into one gate so tables/cards render fully formed instead of popping in — safe because TanStack Query reports `isLoading=false` for disabled queries. Touched ~30 files incl. the scheduling AdminDashboard (waits on teams + intra-club games), Home, Absences, the app-boot spinner in `useAuth`, JoinPage, and a parallel sweep of teams/games/scorer/trainings/forms/messaging/events/calendar/fines/spielplanung pages; converted remaining bespoke text loaders to `<LoadingSpinner />`. Bump `1.0.0` → `1.1.0` + CHANGELOG/ChangelogPage. Build green, no new lint errors. **dev**: commits `b34ce1ba`+`70bb8415` pushed. **prod**: cherry-picked as `5bfd4272`+`baf96b9d` pushed (dev↔prod are parallel histories — cherry-pick, not merge). CF Pages auto-deploys both apps (main + scheduling). No backend/schema change.

- **2026-06-19** **v1.0.0 baseline.** Consolidated the entire pre-1.0 development history (wiedisync had reached internal v5.2.0) into a single official **v1.0.0** release: `CHANGELOG.md` + the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`, `APP_VERSION` → `1.0.0`) collapsed to one launch entry grouped by feature area, `package.json` bumped `5.2.0` → `1.0.0`, and this DEVLOG reset to a fresh baseline with the prior dated entries moved verbatim to [`DEVLOG-archive.md`](DEVLOG-archive.md). The companion `kscw-website` was re-baselined to `1.0.0` in the same pass. No code/schema/runtime change — docs + version metadata only. Not yet committed/deployed at the time of writing.
