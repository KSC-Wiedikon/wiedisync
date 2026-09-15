-- Migration 364 — drop the messaging feature (team chat, DMs, group DMs,
-- activity chats, reactions, message requests, reports, blocks).
--
-- Decision 2026-09-15: the feature is removed wholesale. Prod held 65
-- conversations and 6 messages in total, none in the last 30 days.
--
-- Undoes, in schema terms, migrations 007/008/009/010/015/016/017/018/022/
-- 023/029/042/052 and the messaging slice of 190/256. The `polls` table
-- survives as TEAM polls only (chat polls lose their parent column), and the
-- `system@kscw.ch` sentinel member row is left in place (nothing references
-- it any more; delete it by hand if wanted — the protect trigger is gone).
--
-- Order matters: triggers first (they fire on member_teams/teams/members/
-- participations/events and would otherwise error on the missing tables),
-- then the dependent columns, then the tables, then the Directus metadata.
-- Every statement is idempotent so a re-run is a no-op.

BEGIN;

-- ── 1. Triggers on surviving tables ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_messaging_dm_autoaccept           ON member_teams;
DROP TRIGGER IF EXISTS trg_messaging_teams_members_insert    ON member_teams;
DROP TRIGGER IF EXISTS trg_messaging_teams_members_delete    ON member_teams;
DROP TRIGGER IF EXISTS trg_messaging_teams_insert            ON teams;
DROP TRIGGER IF EXISTS trg_messaging_member_team_chat_enabled ON members;
DROP TRIGGER IF EXISTS trg_messaging_protect_sentinel        ON members;
DROP TRIGGER IF EXISTS trg_participations_activity_chat_sync ON participations;
DROP TRIGGER IF EXISTS trg_activity_chat_event_delete        ON events;

DROP FUNCTION IF EXISTS fn_messaging_dm_autoaccept();
DROP FUNCTION IF EXISTS fn_messaging_teams_members_insert();
DROP FUNCTION IF EXISTS fn_messaging_teams_members_delete();
DROP FUNCTION IF EXISTS fn_messaging_teams_insert();
DROP FUNCTION IF EXISTS fn_messaging_member_team_chat_enabled();
DROP FUNCTION IF EXISTS messaging_protect_sentinel();
DROP FUNCTION IF EXISTS fn_participations_activity_chat_sync();
DROP FUNCTION IF EXISTS fn_activity_chat_event_delete();

-- ── 2. Chat polls → gone; polls keep their team parent ───────────────────
-- `chk_polls_team_or_conversation` allowed team-less chat polls. Delete those
-- rows (their conversation is about to disappear) and make `team` mandatory.
DELETE FROM poll_votes WHERE poll IN (SELECT id FROM polls WHERE team IS NULL);
DELETE FROM polls WHERE team IS NULL;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS chk_polls_team_or_conversation;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_conversation_foreign;
ALTER TABLE polls DROP COLUMN IF EXISTS conversation;
ALTER TABLE polls ALTER COLUMN team SET NOT NULL;

-- ── 3. Tables (children first; CASCADE covers any FK we did not list) ────
DROP TABLE IF EXISTS message_reactions  CASCADE;
DROP TABLE IF EXISTS message_requests   CASCADE;
DROP TABLE IF EXISTS reports            CASCADE;
DROP TABLE IF EXISTS messages           CASCADE;
DROP TABLE IF EXISTS conversation_members CASCADE;
DROP TABLE IF EXISTS conversations      CASCADE;
DROP TABLE IF EXISTS blocks             CASCADE;

-- ── 4. members columns only messaging ever wrote ─────────────────────────
ALTER TABLE members
  DROP COLUMN IF EXISTS communications_team_chat_enabled,
  DROP COLUMN IF EXISTS communications_dm_enabled,
  DROP COLUMN IF EXISTS communications_banned,
  DROP COLUMN IF EXISTS push_preview_content,
  DROP COLUMN IF EXISTS consent_prompted_at,
  DROP COLUMN IF EXISTS consent_decision,
  DROP COLUMN IF EXISTS last_export_at;

-- ── 5. Directus metadata ─────────────────────────────────────────────────
-- A dropped table leaves its rows in directus_collections/fields/relations,
-- and the admin app then shows a broken collection. Permissions rows are
-- reconciled by setup-permissions.mjs on the next deploy, but the collection
-- no longer exists, so clear them here too.
DELETE FROM directus_permissions WHERE collection IN
  ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks');
DELETE FROM directus_relations
  WHERE many_collection IN ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks')
     OR one_collection  IN ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks')
     OR (many_collection = 'polls' AND many_field = 'conversation');
DELETE FROM directus_fields
  WHERE collection IN ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks')
     OR (collection = 'polls' AND field = 'conversation')
     OR (collection = 'members' AND field IN
         ('communications_team_chat_enabled','communications_dm_enabled','communications_banned',
          'push_preview_content','consent_prompted_at','consent_decision','last_export_at'));
DELETE FROM directus_collections WHERE collection IN
  ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks');
DELETE FROM directus_presets WHERE collection IN
  ('conversations','conversation_members','messages','message_reactions','message_requests','reports','blocks');

-- The members form group that held the comms flags (migration 256) now only
-- carries last_online_at; move that to the account group and drop the group.
UPDATE directus_fields SET "group" = 'grp_account'
  WHERE collection = 'members' AND field = 'last_online_at' AND "group" = 'grp_comms';
DELETE FROM directus_fields WHERE collection = 'members' AND field = 'grp_comms';

-- Notifications that pointed at the moderation page (type/title `new_report`)
-- have nowhere to go any more.
DELETE FROM notifications WHERE type = 'new_report' OR activity_type = 'report';

COMMIT;
