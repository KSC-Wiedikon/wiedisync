-- 210-basketplan-birthdate-conflicts.sql
--
-- The 8 birthdate CONFLICTS that migration 208 deliberately left alone (208 was fill-only).
-- Basketplan is now taken as authoritative for all 8 — it is the licence-issuing authority,
-- and the licence fee/category is bound to the date of birth.
--
-- ⚠ ClubDesk is NOT independent corroboration here: `Geburtsdatum` is in CD_PUSH_CONTACT_HEADERS
-- (clubdesk-update.js:200), so wiedisync PUSHES birthdates up. ClubDesk agreeing with our value
-- is circular — it is a mirror of the same (wrong) number, not a second witness.
--
-- Only one of the 8 was decidable from data alone: Thomas Baptistal (502) was recorded born
-- 2020 yet holds a paid `Offizielle/r` licence — a 6-year-old cannot be a licensed official.
-- The other 7 (3 clean day/month swaps + 4 single-digit typos) are a judgement call, made by
-- the club: take Basketplan.
--
-- After this runs, all 8 surface as birthdate drift in Data health (wiedisync vs
-- clubdesk_export.geburtsdatum) → flag → sync-up modal → CSV → ClubDesk import wizard.
--
-- Guarded on the CURRENT (wrong) value, so this is idempotent and cannot silently overwrite a
-- value someone corrects by hand in the meantime.

BEGIN;

UPDATE members SET birthdate = DATE '2000-06-23' WHERE id = 502 AND birthdate = DATE '2020-06-23'; -- Thomas Baptistal      (2020 -> 2000; holds an Offizielle/r licence)
UPDATE members SET birthdate = DATE '1985-04-09' WHERE id = 339 AND birthdate = DATE '1985-09-04'; -- Arnault Pagnard       (day/month swap)
UPDATE members SET birthdate = DATE '1980-12-06' WHERE id = 341 AND birthdate = DATE '1980-06-12'; -- Apostolia Papaevangelou (day/month swap)
UPDATE members SET birthdate = DATE '2018-01-06' WHERE id = 272 AND birthdate = DATE '2018-06-01'; -- Haris Kealey          (day/month swap)
UPDATE members SET birthdate = DATE '2015-02-26' WHERE id = 248 AND birthdate = DATE '2015-06-26'; -- Soley Kalea Huwiler   (month 06 -> 02)
UPDATE members SET birthdate = DATE '2010-04-05' WHERE id = 342 AND birthdate = DATE '2010-04-15'; -- Remo Pastorini        (day 15 -> 05)
UPDATE members SET birthdate = DATE '1988-05-10' WHERE id = 434 AND birthdate = DATE '1988-05-18'; -- Luca Varriale         (day 18 -> 10)
UPDATE members SET birthdate = DATE '2013-08-15' WHERE id = 509 AND birthdate = DATE '2013-08-18'; -- Jonathan Suter        (day 18 -> 15)

COMMIT;
