-- Migration 190: members.clubdesk_sync_exclude — mute a member from the
-- ClubDesk sync-up (user 2026-07-07: "mute in sync up this System KSCW").
--
-- A muted member never appears in the up-preview (neither the changed nor the
-- unlinked list) and is refused by /up's server-side eligibility check, so it
-- can't be pushed to ClubDesk at all. Meant for technical rows (the System
-- KSCW account) and deliberate never-sync members. Mute/unmute via the button
-- in the sync-up modal (POST /kscw/clubdesk-member-sync/mute, superadmin,
-- actor-logged) or the Directus admin UI.
--
-- Backfill: the System KSCW technical account (system@kscw.ch) is muted here.
-- Schema + bounded backfill, idempotent. No permission change (column is not
-- in any member-facing field list). After applying, regenerate SCHEMA.sql.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS clubdesk_sync_exclude boolean NOT NULL DEFAULT false;

INSERT INTO directus_fields (collection, field, special, interface, sort, note)
SELECT 'members', 'clubdesk_sync_exclude', 'cast-boolean', 'boolean', 96,
       'Muted from the ClubDesk sync-up — never offered or pushed (migration 190).'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'members' AND df.field = 'clubdesk_sync_exclude'
);

UPDATE members SET clubdesk_sync_exclude = true
WHERE email = 'system@kscw.ch' AND clubdesk_sync_exclude = false;

COMMIT;
