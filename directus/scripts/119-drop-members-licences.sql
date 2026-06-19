-- Migration 119: drop the legacy members.licences (json) column.
--
-- Migration 067 split licences into six boolean columns (scorer_vb, referee_vb,
-- otr1_bb, otr2_bb, otn_bb, referee_bb) and kept `licences` (json) only as a
-- transitional dual-read/dual-write column. Migration 068 moved the stat views
-- onto the booleans. All remaining readers and writers — the frontend query
-- field lists, the registration hook (kscw-hooks), and the Volleymanager sync
-- (vm-sync-check.mjs) — were removed in the same commit as this migration, so
-- the json column is now dead.
--
-- DEPLOY ORDER MATTERS: ship the extension/script changes that stop writing
-- `licences` BEFORE running this migration, otherwise the still-running old
-- code will try to write a dropped column. (`npm run ext:deploy:*` then
-- `npm run db:migrate:*`.)
--
-- The legacy `members_with_photo` view (a Supabase-era artifact, not used by
-- the app — only referenced by the security-setup migrations 004/011/072)
-- selects `m.licences`, so Postgres would block the column drop. We drop and
-- recreate the view without the column, preserving its `security_invoker`
-- setting and the storage photo-url join exactly as before.
--
-- Idempotent: DROP VIEW IF EXISTS / DROP COLUMN IF EXISTS / DELETE WHERE.

DROP VIEW IF EXISTS public.members_with_photo;

ALTER TABLE members DROP COLUMN IF EXISTS licences;

-- Remove the Directus field metadata so the admin Data Model and the items API
-- stop advertising a column that no longer exists.
DELETE FROM directus_fields WHERE collection = 'members' AND field = 'licences';

-- Recreate the view without `licences` (otherwise unchanged).
CREATE VIEW public.members_with_photo WITH (security_invoker='true') AS
 SELECT m.id,
    m.email,
    m.first_name,
    m.last_name,
    m.phone,
    m.license_nr,
    m.number,
    m."position",
    m.photo,
    m.role,
    m.kscw_membership_active,
    m.birthdate,
    m.coach_approved_team,
    m.language,
    m.hide_phone,
    m.birthdate_visibility,
    m.website_visible,
    m.wiedisync_active,
    m.shell,
    m.shell_expires,
    m.shell_reminder_sent,
    m.requested_team,
    m."user",
    m.date_created,
    m.date_updated,
    m.is_spielplaner,
    m.adresse,
    m.plz,
    m.ort,
    m.nationalitaet,
    m.anrede,
    m.sex,
    m.ahv_nummer,
    m.beitragskategorie,
        CASE
            WHEN (m.photo IS NOT NULL) THEN ('/storage/v1/object/public/kscw-files/'::text || o.name)
            ELSE NULL::text
        END AS photo_url
   FROM (public.members m
     LEFT JOIN storage.objects o ON (((o.bucket_id = 'kscw-files'::text) AND (o.name ~~ (m.photo || '%'::text)))));
