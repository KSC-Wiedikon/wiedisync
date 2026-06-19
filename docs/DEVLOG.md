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

- **2026-06-19** **v1.0.0 baseline.** Consolidated the entire pre-1.0 development history (wiedisync had reached internal v5.2.0) into a single official **v1.0.0** release: `CHANGELOG.md` + the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`, `APP_VERSION` → `1.0.0`) collapsed to one launch entry grouped by feature area, `package.json` bumped `5.2.0` → `1.0.0`, and this DEVLOG reset to a fresh baseline with the prior dated entries moved verbatim to [`DEVLOG-archive.md`](DEVLOG-archive.md). The companion `kscw-website` was re-baselined to `1.0.0` in the same pass. No code/schema/runtime change — docs + version metadata only. Not yet committed/deployed at the time of writing.
