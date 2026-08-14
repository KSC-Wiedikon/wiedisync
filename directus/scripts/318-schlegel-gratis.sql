-- 318 — Livia Schlegel (#98): 'Kein Beitrag' → 'Gratis'. User decision
-- 2026-08-14 (pregnancy).
--
-- WHY IT MATTERS EVEN THOUGH BOTH BILL ZERO. The two categories are not synonyms:
-- 'Gratis' is a MEMBER who owes nothing (coach, staff, a waived season), while
-- 'Kein Beitrag' is the terminal NON-member bucket created 2026-07-30 for
-- 'Ehemaliges Mitglied' and 'Kein Mitglied' contacts — sponsors, parents, people
-- who left. She is an Aktivmitglied, so she was sitting in the bucket that says
-- "not one of us". Found by the consistency sweep of 2026-08-14.
--
-- The override also goes. `fee_base_override = 110` is migration 308's PURE-GUEST
-- shape: the engine subtracts the CHF 110 guest reduction, so a base of 110 is
-- how 308 made her emit 0 while she is a guest on D4 (volleyball). Under 'Gratis'
-- the base is already 0 and the reduction floors at 0, so today the two agree —
-- but the moment she holds a core roster row instead of a guest one, that stale
-- 110 would bill her CHF 110. Clearing it is the whole point of moving her to a
-- category that means what it says.
--
-- ⚠⚠ THIS CANNOT BE PUSHED TO CLUBDESK, AND NO FLAG IS WRITTEN ON PURPOSE.
-- Beitragskategorie is UNCONDITIONALLY fill-only in buildPushCsv —
-- `String(m.beitragskategorie_cd || '').trim() || mapKategorie(...)` — i.e.
-- ClubDesk's own cell echoes back verbatim whenever it is non-empty. There is no
-- registerCell() gate for it, unlike Status / Eintritt / Austritt /
-- Mitgliederbeitrag, so naming the field in `clubdesk_push_changes` would achieve
-- nothing except promise a push that cannot happen and pointlessly make the
-- sync-down skip her row. The register keeps 'Kein Beitrag' until somebody edits
-- ClubDesk BY HAND.
-- Consequences of leaving it: none for money — the register already holds CHF 0
-- for her and both categories derive 0, so nothing is mis-billed. And it will not
-- nag: beitragskategorie is not one of the fields computeClubdeskDrift compares,
-- so this deliberate divergence produces no permanent Data Health conflict.
--
-- ⚠ Her register_status is deliberately NOT changed. The club's own pattern for a
-- pregnancy pause is 'Zwischenjahr' at CHF 0 — 14 of the 18 Zwischenjahr contacts
-- carrying an amount are at 0, with register notes reading "schwanger" / "Pause
-- Saison 26/27" — but whether Zwischenjahr owes anything is an OPEN question with
-- the treasurer as of 2026-08-14, and the new fee check deliberately does not
-- evaluate that status yet. The user asked for Gratis; Gratis is what this does.
--
-- Data-only. Idempotent: absolute values, guarded on the id.

UPDATE members
SET beitragskategorie = 'Gratis',
    fee_base_override = NULL
WHERE id = 98;
