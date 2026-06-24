-- Migration 135: members.sektion (ClubDesk section = sport division).
--
-- ClubDesk carries a `Sektion` per member (Volleyball / Basketball / KSCW) that
-- the member CSV scrape already lands in the clubdesk_export staging table but
-- never propagated to `members`. This column receives it (propagation added to
-- import-clubdesk-csv.mjs + backfilled once), powering the finance member
-- explorer's Sport column + filter. Authoritative from ClubDesk (members can't
-- edit it), so the sync always-updates it.
--
-- Schema-only + idempotent. Permissions in setup-permissions.mjs.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS sektion varchar(32);

COMMENT ON COLUMN members.sektion IS
  'ClubDesk Sektion (Volleyball / Basketball / KSCW) — the member''s sport division. Synced from clubdesk_export by import-clubdesk-csv.mjs; ClubDesk-authoritative (always updated).';

INSERT INTO directus_fields (collection, field, interface, options, readonly, sort, width, note)
SELECT 'members', 'sektion', 'select-dropdown',
  '{"choices":[{"text":"Volleyball","value":"Volleyball"},{"text":"Basketball","value":"Basketball"},{"text":"KSCW","value":"KSCW"}],"allowOther":true}'::json,
  true, 199, 'half', 'ClubDesk section / sport division (synced, read-only).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'sektion');

COMMIT;
