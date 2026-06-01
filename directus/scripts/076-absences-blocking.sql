-- Migration 076: absences.blocking flag (game-scheduling relevance)
--
-- An absence with affects ∋ 'games'/'all' currently always blocks the
-- Spielplanung / Terminplanung availability calc (a home slot we offer is
-- dropped if anyone is absent; an opponent's away proposal is greyed out).
--
-- Some absences are real time-off (vacation, work) where the player genuinely
-- can't be reached on that date — those SHOULD block scheduling. Others
-- (long-term injury, maternity leave) mean the player won't play regardless,
-- so the absence should NOT prevent the rest of the squad from booking games
-- on those dates.
--
-- `blocking` lets the reporter make that distinction. Default true preserves
-- today's behavior: existing rows + new absences block unless explicitly
-- unticked. The game-scheduling endpoint AND `a.blocking = true` into both
-- absence queries; weekly unavailabilities are already excluded there so the
-- flag only affects standard absences.
--
-- Schema-only + idempotent. Permissions for the new field live in
-- setup-permissions.mjs (MEMBER_ABSENCE_FIELDS read scope).

BEGIN;

ALTER TABLE absences ADD COLUMN IF NOT EXISTS blocking boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN absences.blocking IS
  'When true (default), this absence blocks game-scheduling availability (home slots offered + opponent away proposals) on its dates. Set false for absences that should not block scheduling (e.g. long-term injury, maternity leave) since the player won''t play regardless. Only standard absences affecting games/all are evaluated; weekly unavailabilities never block scheduling.';

-- Directus field metadata so the column is recognized by the schema and
-- editable from the admin UI (mirrors the existing `indefinite` boolean row).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'absences', 'blocking', NULL, 'boolean', 90, false,
  'Blocks game scheduling on these dates. Off = informational only (e.g. injury, maternity leave).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'absences' AND field = 'blocking'
);

COMMIT;
