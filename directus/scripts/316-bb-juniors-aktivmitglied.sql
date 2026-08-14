-- 316 — the 17 basketball juniors who were billed as members while the register
-- called them 'Kein Mitglied'. User decision 2026-08-14: they are Aktivmitglieder.
--
-- WHAT WAS WRONG. Found by the fee/membership consistency sweep of 2026-08-14.
-- All 17 are CORE (not guest) players on ACTIVE basketball teams — HU16 and
-- H-Classics 1LR — every one of them carries 'BB Jugend Meisterschaft' at
-- CHF 320 in the register, and not one has an Austritt date. So the club bills
-- them as members and classifies them as non-members at the same time. It
-- cannot be both, and the user resolved it in favour of the fee: they are
-- members.
--
-- WHY NOBODY NOTICED. The existing "left ClubDesk" check (/clubdesk-departed)
-- requires a departed status AND an Austritt date, precisely so that volunteer
-- coaches marked 'Kein Mitglied' and not-yet-activated signups are not
-- false-flagged. These 17 have no Austritt, so they fell through it for as long
-- as they have existed. The new /clubdesk-fee-rules check does not catch them
-- either — their amount matches their category exactly. The contradiction is
-- only visible when you join status against the roster.
--
-- WHY THE PUSH FLAG IS THE POINT, not an afterthought. `register_status` is one
-- of the three ClubDesk-OWNED register cells (migration 302). buildPushCsv sends
-- it through registerCell(), which takes wiedisync's value ONLY when the
-- member's pending push NAMES the field — otherwise ClubDesk's own value echoes
-- back verbatim. Set the column without the flag and the register would keep
-- saying 'Kein Mitglied' forever, and the next sync-DOWN would quietly restore
-- it here too. The flag does double duty: it licenses the push, and it makes the
-- sync-down SKIP these rows until the push lands (migration 302's contract).
--
-- ⚠ AUSTRITT IS NOT TOUCHED. All 17 have austritt NULL, which is what makes an
-- active status legal at all: members_austritt_needs_departed_status refuses an
-- exit date next to an active status, and buildPushCsv deliberately pairs the
-- two cells so the register can never read "active, left on <date>". Nothing
-- here needs to change, and nothing here may.
--
-- ⚠ Eintritt is likewise untouched — every one of the 17 already carries one
-- (2018-11-19 through 2025-12-04), so the register's own joining dates stand.
--
-- Data-only. Idempotent: the status update is a no-op once applied, and the
-- change entry replaces any earlier entry for the same field.

UPDATE members m
SET register_status = 'Aktivmitglied',
    clubdesk_push_pending = true,
    clubdesk_push_changes = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' IS DISTINCT FROM 'register_status'
    ) || jsonb_build_array(jsonb_build_object(
      'field', 'register_status',
      'old_value', 'Kein Mitglied',
      'new_value', 'Aktivmitglied'
    ))
FROM (VALUES
  (119),  -- Kiano Arnet
  (134),  -- Yves Binswanger
  (173),  -- Raul De Faveri
  (200),  -- Matej Fernandez
  (213),  -- Ion Gautschi
  (231),  -- Omer Gül
  (254),  -- Jonas Ikonomou
  (268),  -- Niclas Lian Kämmer
  (280),  -- Maximilien Klemenz
  (285),  -- Matthias Kremer
  (297),  -- Ruben Liebert
  (317),  -- Tibor Minder
  (338),  -- Nino Oswald
  (350),  -- Linus Pilz
  (352),  -- Matteo Pitton
  (387),  -- Diego Schmid
  (391)   -- David Schölly
) AS v(member_id)
WHERE m.id = v.member_id
  -- Never flag an unlinked member: an UPDATE row is keyed on [Id], and a contact
  -- that does not exist in ClubDesk has nothing to correct. (All 17 are linked
  -- as of 2026-08-14; this is the same guard migration 307 carries.)
  AND NULLIF(BTRIM(COALESCE(m.clubdesk_id, '')), '') IS NOT NULL
  -- Only promote the cohort this migration was written for. A member somebody
  -- has since moved OUT of 'Kein Mitglied' by hand must not be dragged back
  -- through a re-run, and one already promoted needs no second change entry.
  AND m.register_status = 'Kein Mitglied';
