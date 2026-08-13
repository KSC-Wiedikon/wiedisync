-- Migration 315: which Kantonsschule a member attends, on the member
--
-- KSC Wiedikon is Kantonsschule Wiedikon's club, so "is this person at a Zurich
-- Mittelschule, and which one" is a membership fact — it decides who the club
-- exists for and is the first thing asked when the school wants numbers.
--
-- The signup form has asked it since it shipped (kscw-website
-- `weiteres/anmeldung.astro`: a Nein / KS Wiedikon / Andere Kantonsschule
-- select, plus a second "which one" select of 24 schools when Andere is
-- picked, merged client-side into one value). It has only ever been stored on
-- `registrations.kantonsschule` — a row about an APPLICATION, not about a
-- member. So the answer was:
--   • invisible in the member explorer, unfilterable, unexportable;
--   • stranded once the registration was approved;
--   • absent entirely for everybody who joined before the form existed or came
--     in through ClubDesk (prod 2026-08-13: 31 registrations carry a value,
--     30 of them linked to a member — against ~711 members).
--
-- This adds the column to `members` and backfills those 30 from their
-- registration. The other ~680 stay NULL, which is the honest answer: nobody
-- has ever been asked.
--
-- ── Why no CHECK constraint ─────────────────────────────────────────────────
-- Deliberately none, and this is the opposite call from `register_status`
-- (migration 302) and `licence_status` (301), both of which are CHECK-pinned.
-- The difference is who owns the list. Those two are picklists of OURS, changed
-- by a migration. This one mirrors a list on the public website that grows
-- whenever a Zurich school is added, renamed or split — 'KS Rämibühl' is
-- already three entries there ('(Literargymnasium)', '(MN-Gymnasium)',
-- '(Realgymnasium)') while prod still holds one row spelled the old way. A
-- CHECK would mean the next website edit silently rejects registrations at the
-- database layer, hours after somebody edits an Astro file and with nothing
-- connecting the two. The Directus dropdown below carries the current list as
-- SUGGESTIONS; the explorer's SelectEditor keeps an off-list value selected and
-- selectable, so legacy spellings stay visible and editable rather than
-- becoming uneditable rows.
--
-- ⚠ 'Nein' is a real stored value, not an empty one. "Asked, and not at a
-- Kantonsschule" and "never asked" are different facts and must not collapse —
-- the same distinction `federation_of_origin` draws between NONE and NULL.
--
-- ⚠ NOT a ClubDesk column. The register has no field for it, so it is never
-- pushed and never overwritten by the Saturday sync-down. wiedisync owns it
-- outright, which makes it one of the few member columns with no sync contract
-- to reason about.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- is NOT required — admins and sport admins read `members` with fields='*' and
-- so pick the column up automatically, and it is deliberately absent from
-- MEMBER_VISIBLE_FIELDS: which school somebody attends is not something the
-- club publishes to other members.

BEGIN;

-- ── 1. The column ───────────────────────────────────────────────────────────
-- varchar(64): the longest value the website can produce is
-- 'KS Rämibühl (Literargymnasium)' at 30 characters, with room for the next
-- school to be longer without another migration.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS kantonsschule varchar(64);

COMMENT ON COLUMN members.kantonsschule IS
  'Which Zurich Kantonsschule this member attends. ''Nein'' = asked and not at one; NULL = never asked. Mirrors the signup form''s list (kscw-website weiteres/anmeldung.astro); intentionally unconstrained — see migration 315.';

-- ── 2. Backfill from the registration that created each member ──────────────
-- DISTINCT ON (member) ORDER BY id DESC — a member can have more than one
-- registration (a re-application, or one per sport), and the newest answer is
-- the current one. `registrations` has no date_created, so the serial id is the
-- ordering; it is monotonic per insert, which is all this needs.
--
-- `WHERE members.kantonsschule IS NULL` makes the backfill re-runnable without
-- ever overwriting an answer given here later — the migration runner refuses to
-- re-apply anyway, but a hand-run on prod must not undo an admin's edit.
UPDATE members m
   SET kantonsschule = r.kantonsschule
  FROM (
    SELECT DISTINCT ON (member) member, kantonsschule
      FROM registrations
     WHERE member IS NOT NULL
       AND coalesce(kantonsschule, '') <> ''
     ORDER BY member, id DESC
  ) r
 WHERE m.id = r.member
   AND m.kantonsschule IS NULL;

-- ── 3. Directus field metadata ──────────────────────────────────────────────
-- ⚠ `directus_fields.options` is `json`; a bare NULL in a VALUES list types as
-- text and fails the INSERT (memory [[member-fee-overrides]], migration 299).
-- This row has real options so the cast is on a literal, but keep the pattern.
--
-- `allowOther: true` — the dropdown must not be a gate here, for the same
-- reason there is no CHECK above.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, note)
SELECT v.collection, v.field, v.interface, v.options::json,
       v.readonly, v.hidden, v.sort, v.width, v.note
FROM (VALUES
  ('members', 'kantonsschule', 'select-dropdown',
   '{"allowOther":true,"allowNone":true,"choices":[' ||
   '{"text":"Nein","value":"Nein"},' ||
   '{"text":"KS Wiedikon","value":"KS Wiedikon"},' ||
   '{"text":"KS Birch","value":"KS Birch"},' ||
   '{"text":"KS Büelrain","value":"KS Büelrain"},' ||
   '{"text":"KS Bülach","value":"KS Bülach"},' ||
   '{"text":"KS Dübendorf","value":"KS Dübendorf"},' ||
   '{"text":"KS Enge","value":"KS Enge"},' ||
   '{"text":"KS Freudenberg","value":"KS Freudenberg"},' ||
   '{"text":"KS Hohe Promenade","value":"KS Hohe Promenade"},' ||
   '{"text":"KS Hottingen","value":"KS Hottingen"},' ||
   '{"text":"KS Im Lee","value":"KS Im Lee"},' ||
   '{"text":"KS Küsnacht","value":"KS Küsnacht"},' ||
   '{"text":"KS Limmattal","value":"KS Limmattal"},' ||
   '{"text":"KS Oerlikon","value":"KS Oerlikon"},' ||
   '{"text":"KS Rämibühl (Literargymnasium)","value":"KS Rämibühl (Literargymnasium)"},' ||
   '{"text":"KS Rämibühl (MN-Gymnasium)","value":"KS Rämibühl (MN-Gymnasium)"},' ||
   '{"text":"KS Rämibühl (Realgymnasium)","value":"KS Rämibühl (Realgymnasium)"},' ||
   '{"text":"KS Riesbach","value":"KS Riesbach"},' ||
   '{"text":"KS Rychenberg","value":"KS Rychenberg"},' ||
   '{"text":"KS Stadelhofen","value":"KS Stadelhofen"},' ||
   '{"text":"KS Uetikon am See","value":"KS Uetikon am See"},' ||
   '{"text":"KS Uster","value":"KS Uster"},' ||
   '{"text":"KS Wetzikon","value":"KS Wetzikon"},' ||
   '{"text":"KS Zimmerberg","value":"KS Zimmerberg"},' ||
   '{"text":"KS Zürich Nord","value":"KS Zürich Nord"},' ||
   '{"text":"Liceo Artistico","value":"Liceo Artistico"},' ||
   '{"text":"Andere Kantonsschule","value":"Andere Kantonsschule"}]}',
   false, false, 20, 'half',
   'Which Zurich Kantonsschule this member attends. "Nein" = asked and not at one; empty = never asked. Not a ClubDesk field — wiedisync owns it.')
) AS v(collection, field, interface, options, readonly, hidden, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;

-- Verification (dev/prod):
--   SELECT coalesce(kantonsschule,'(never asked)') AS ks, count(*)
--     FROM members GROUP BY 1 ORDER BY 2 DESC;
--   -- Expect on prod: (never asked) ~681, Nein 18, KS Wiedikon 7,
--   -- Andere Kantonsschule 2, and one each of KS Rämibühl / KS Bülach /
--   -- KS Hohe Promenade / KS Zürich Nord.
--
--   -- Every backfilled member agrees with their newest registration:
--   SELECT count(*) FROM members m
--     JOIN (SELECT DISTINCT ON (member) member, kantonsschule FROM registrations
--            WHERE member IS NOT NULL AND coalesce(kantonsschule,'') <> ''
--            ORDER BY member, id DESC) r ON r.member = m.id
--    WHERE m.kantonsschule IS DISTINCT FROM r.kantonsschule;  -- → 0
