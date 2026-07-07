-- Migration 184: members.uuid — globally unique round-trip key for ClubDesk.
--
-- The "Wiedisync ID" custom field in ClubDesk (2026-07-07) carried members.id,
-- which is unambiguous inside one database but not across environments or a
-- future rebuild/re-import, and is visually confusable with ClubDesk's own
-- numeric contact [Id]. members.uuid is the forever-stable key: the up-push now
-- writes the UUID into "Wiedisync ID" and the down-sync linker matches it back
-- (it still accepts the ~686 legacy numeric stamps via members.id — they stay
-- valid alternate keys and get overwritten with the UUID on each member's next
-- push).
--
-- Schema-only + idempotent. Not in any member-facing permission field list
-- (explicit lists in setup-permissions.mjs), so no permission change. After
-- applying, regenerate SCHEMA.sql (npm run db:baseline:prod).

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS uuid uuid;
UPDATE members SET uuid = gen_random_uuid() WHERE uuid IS NULL;
ALTER TABLE members ALTER COLUMN uuid SET DEFAULT gen_random_uuid();
ALTER TABLE members ALTER COLUMN uuid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_uuid_unique ON members (uuid);

-- Registered so the items API returns it under `*` and admins can see it;
-- readonly — it is system-assigned and must never be edited.
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort, note)
SELECT 'members', 'uuid', 'uuid', 'input', true, false, 95,
       'Stable global member key; pushed to ClubDesk as "Wiedisync ID" (migration 184). System-set — never edit.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'members' AND df.field = 'uuid'
);

COMMIT;
