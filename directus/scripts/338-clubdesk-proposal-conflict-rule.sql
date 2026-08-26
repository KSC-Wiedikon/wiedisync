-- Migration 338: a fifth proposal rule — `conflict`.
--
-- Until now a both-sides-hold-a-different-value disagreement reached the
-- superadmin through TWO surfaces with two different verbs:
--
--   * the five register columns (beitragskategorie, sektion, register_status,
--     eintritt, austritt) were staged here as `overwrite` — decidable, with a
--     tombstone, Accept or Refuse; and
--   * everything else (email, phone, address, birthdate, sex, iban, anrede,
--     nationality, AHV, federation, trainer licences) surfaced ONLY as a `drift`
--     row in Data Health's "Needs syncing" list, which offers "Keep ours" and
--     nothing else — there has never been a way to take ClubDesk's value for
--     those columns at all.
--
-- The second surface also cannot remember a decision: it is recomputed from
-- `members` vs `clubdesk_export` on every read, so the same disagreement returns
-- forever until a push happens to resolve it. This rule moves those decisions
-- into the queue that already has the durable answer (proposals_refused_uq).
--
-- ⚠ Detection for this rule deliberately does NOT live in the sync-down's SQL
-- pass alongside the other four. The drift comparison is JS —
-- computeClubdeskDrift() folds accents, normalises phone numbers, resolves
-- country names through country_name_aliases, compares AHV digits-only and
-- matches an email against EITHER of ClubDesk's two address columns. Restating
-- that in SQL would create a third opinion that disagrees with both existing
-- ones (measured on prod: 3 of 8 non-name conflicts were "Vereinigte Staaten"
-- vs "USA", a pair only the alias table resolves). Staging therefore runs in
-- kscw-endpoints off the SAME function that renders the finding.
--
-- ⚠ Names are never staged. The push CSV is deliberately name-less
-- (CD_PUSH_CONTACT_HEADERS), so a name disagreement is not decidable in either
-- direction and stays a `name_drift` STATUS — it is also how a mis-link
-- surfaces, which is the reason it must remain visible.
--
-- Schema-only + idempotent (CLAUDE.md rule 2). No permission rows: this table is
-- read and written only by kscw-endpoints over raw knex.

ALTER TABLE clubdesk_sync_proposals
  DROP CONSTRAINT IF EXISTS clubdesk_sync_proposals_rule_chk;

ALTER TABLE clubdesk_sync_proposals
  ADD CONSTRAINT clubdesk_sync_proposals_rule_chk
  CHECK (rule IN ('fill', 'overwrite', 'set_true', 'create', 'conflict'));
