-- 344 — de-duplicate the city out of nine stored event locations
--
-- Data backfill for the fault fixed in `src/utils/locationLabel.ts`:
-- `LocationCombobox` composed its label as `[name, address, city].join(', ')`,
-- which is right for a hall out of our own table (three separate columns) and
-- wrong for a Google Places hit, whose `address` is `formattedAddress` — already
-- street + postcode + city + country. Every Places pick therefore restated the
-- city, and a plain street address (where `displayName` IS the street) doubled
-- at the front too.
--
-- ⚠ The new values are NOT re-derived in SQL. They are the output of
-- `tidyLocationLabel()` — the same function the picker now uses — captured here
-- verbatim. Restating that logic in PL/pgSQL would be a second opinion free to
-- disagree with the first, and the segment rules (postcode-aware locality match,
-- diacritic folding, Swiss-only country stripping) are exactly where two
-- implementations would drift.
--
-- ⚠ Idempotent by exact-match guard, not by pattern: each UPDATE names the old
-- value it expects. A row someone has since re-picked or hand-edited is left
-- alone rather than being reverted to a stale "corrected" string, and a re-run
-- of an applied migration touches nothing.
--
-- ⓘ Only `events` is affected, and that was checked rather than assumed:
-- `trainings` has no `location` column at all, and `hall_events.location` plus
-- `halls.name`/`halls.address` return 0 rows for the country-segment pattern.
-- `halls` keeps name/address/city as separate columns and never stores the
-- composed label — which is why the three-field join was correct for it.

BEGIN;

UPDATE events SET location = 'KSC Wiedikon, Goldbrunnenstrasse 80, 8055 Zürich'
  WHERE id = 5 AND location = 'KSC Wiedikon, Goldbrunnenstrasse 80, 8055 Zürich, Schweiz, Zürich';
UPDATE events SET location = 'MNG Rämibühl, Rämistrasse 58, 8001 Zürich'
  WHERE id = 21 AND location = 'MNG Rämibühl, Rämistrasse 58, 8001 Zürich, Schweiz, Zürich';
UPDATE events SET location = 'Eggstrasse 11, 8620 Wetzikon'
  WHERE id = 22 AND location = 'Eggstrasse 11, Eggstrasse 11, 8620 Wetzikon, Schweiz, Wetzikon';
UPDATE events SET location = 'Saatlenfussweg 3, 8050 Zürich'
  WHERE id = 23 AND location = 'Saatlenfussweg 3, Saatlenfussweg 3, 8050 Zürich, Schweiz, Zürich';
UPDATE events SET location = 'Kantonsschule Limmattal, In der Luberzen, 8902 Urdorf'
  WHERE id = 24 AND location = 'Kantonsschule Limmattal, In der Luberzen, 8902 Urdorf, Schweiz, Urdorf';
UPDATE events SET location = 'Mehrzweckhalke Egg, 8620 Wetzikon'
  WHERE id = 25 AND location = 'Mehrzweckhalke Egg, 8620 Wetzikon, Schweiz, Wetzikon';
UPDATE events SET location = 'Zürichbergstrasse 10, 8032 Zürich'
  WHERE id = 26 AND location = 'Zürichbergstrasse 10, Zürichbergstrasse 10, 8032 Zürich, Schweiz, Zürich';
UPDATE events SET location = 'KSC Wiedikon, Goldbrunnenstrasse 80, 8055 Zürich'
  WHERE id = 27 AND location = 'KSC Wiedikon, Goldbrunnenstrasse 80, 8055 Zürich, Schweiz, Zürich';
UPDATE events SET location = 'Turnhalle, Oberlunkhofen, 8917 Oberlunkhofen'
  WHERE id = 28 AND location = 'Turnhalle, Oberlunkhofen, 8917 Oberlunkhofen, Schweiz, Oberlunkhofen';

COMMIT;
