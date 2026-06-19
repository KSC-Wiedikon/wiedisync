-- Migration 117: grandfather existing photos into website_visible.
--
-- Companion to migration 116's enforcement. Until now the /public/team/:id
-- endpoint returned every member's photo regardless of `website_visible`
-- (the opt-out was honoured only by the kscw-website frontend, which never
-- received the flag — so it was effectively ignored). 116's endpoint fix now
-- gates the photo server-side: website_visible=false → no photo on the public
-- site. Because the column DEFAULTs to false, that would silently drop the
-- photo of every member who never explicitly opted in.
--
-- To avoid yanking photos that have been publicly visible all along, this is a
-- ONE-TIME backfill: any member who currently has a photo is treated as having
-- consented to show it (website_visible := true). New members keep the opt-in
-- default (false) and choose via Profile → Privacy.
--
-- Schema-policy: data backfills are allowed in numbered migrations. Idempotent —
-- the guard means a re-run touches nothing once applied (and setting true→true
-- is a no-op regardless).

BEGIN;

UPDATE members
   SET website_visible = true
 WHERE photo IS NOT NULL
   AND website_visible = false;

COMMIT;
