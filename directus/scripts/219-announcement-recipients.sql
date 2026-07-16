-- Migration 219: announcement recipient materialization + teams/roles targeting.
--
-- Two things land together because they're the same fact:
--
-- 1. `announcement_recipients` — one row per (announcement, member) resolved at
--    publish time by the kscw-hooks fanout. It serves THREE purposes:
--      a) READ GATE. Members are deliberately blocked from reading
--         announcements.audience_teams / audience_roles (setup-permissions.mjs:977
--         + :1513 — exposing the arrays would reveal targeting intent). That means
--         a teams/roles-targeted post cannot be matched client-side the way
--         `sport` is, so /news could never show it. The Member policy filter
--         instead walks this junction: audience_type in (all, sport) passes as
--         before; teams/roles requires a recipient row for the requesting user.
--         Without this, a targeted post would email + push + ring the bell while
--         the bell link 404s.
--      b) DELIVERY LOG. bell_at / email_at / email_error make "who actually got
--         this, and did it land?" answerable after the fact. The fanout
--         previously logged counts only. There is deliberately no push_at: the
--         push helper sends per locale bucket and reports nothing per-recipient,
--         so any value we wrote would be a guess.
--      c) AUDIENCE SNAPSHOT. Recipients are frozen as-of-publish. Editing a post's
--         audience afterwards does NOT re-resolve (fanout_sent_at already blocks
--         re-fanout), so the log keeps saying who was actually reached.
--
--    Rows are written for EVERY audience_type, not just teams/roles — uniform
--    delivery logging. But the policy filter keeps its own `all`/`sport` arm, so
--    materialization is purely additive for those two and load-bearing only for
--    teams/roles. A materialization failure can't hide an existing club-wide post.
--
-- 2. `audience_teams` / `audience_roles` — the columns, the directus_fields rows
--    and the audience_type choices already exist (005-add-announcements.mjs:149-154,
--    stubbed "future use, hidden in v1 admin UI"). This migration only unhides them
--    and gives them show/hide conditions mirroring audience_sport's.
--
-- audience_roles holds PREFIXED tokens across three disjoint namespaces, because
-- "role" means three different things on this schema and a bare string would be
-- ambiguous the first time the sets overlap:
--   role:<members.role enum>  — admin superuser vb_admin bb_admin vorstand
--                               website_admin finance user
--   fn:<team-derived>         — coach team_responsible captain (from the
--                               teams_coaches / teams_responsibles junctions and
--                               teams.captain; NOT members.role values)
--   qual:<members boolean>    — is_spielplaner scorer_vb referee_vb otr1_bb
--                               otr2_bb otn_bb referee_bb
-- No rows use these columns yet, so no backfill and no compatibility burden.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions
-- (incl. the Member read filter that walks `recipients`) live in
-- setup-permissions.mjs, NOT here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.announcement_recipients (
  id            serial PRIMARY KEY,
  announcement  integer NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  member        integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  bell_at       timestamptz,
  email_at      timestamptz,
  email_error   text,
  date_created  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_recipients_announcement_member_unique UNIQUE (announcement, member)
);

-- The policy filter walks announcement -> member on every /news load.
CREATE INDEX IF NOT EXISTS announcement_recipients_member_idx
  ON public.announcement_recipients (member);

COMMENT ON TABLE public.announcement_recipients IS
  'One row per (announcement, member) resolved at publish by the kscw-hooks fanout (migration 219). Read gate for teams/roles-targeted posts (members cannot read audience_teams/audience_roles, so the Member policy filter walks this junction instead), per-recipient delivery log, and a frozen as-of-publish audience snapshot. Written for every audience_type; load-bearing only for teams/roles.';
COMMENT ON COLUMN public.announcement_recipients.bell_at IS
  'In-app bell notification created. Always attempted — opt-outs suppress email/push only, never the bell.';
COMMENT ON COLUMN public.announcement_recipients.email_at IS
  'Email accepted by SES. NULL when notify_email was off, the member has no address, or email_notify_announcements is false.';
COMMENT ON COLUMN public.announcement_recipients.email_error IS
  'SES/transport error for this recipient, if the send threw. NULL on success or when no email was attempted.';

-- ── Directus admin metadata ────────────────────────────────────────────
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_app_filter)
SELECT 'announcement_recipients', 'group', '#0ea5e9', NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'announcement_recipients');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'announcement_recipients', 'announcement', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'The announcement this delivery belongs to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'announcement');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'announcement_recipients', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'Resolved recipient.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'member');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'announcement_recipients', 'bell_at', 'datetime', true, 3, 'half', 'In-app bell notification created.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'bell_at');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'announcement_recipients', 'email_at', 'datetime', true, 5, 'half', 'Email accepted by SES.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'email_at');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'announcement_recipients', 'email_error', 'input', true, 6, 'full', 'Per-recipient send error, if any.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'email_error');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'announcement_recipients', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcement_recipients' AND field = 'date_created');

-- o2m alias on announcements. REQUIRED for the Member policy filter to walk
-- `recipients` — a permission filter can only traverse a registered relation.
INSERT INTO directus_fields (collection, field, special, interface, hidden, sort, note)
SELECT 'announcements', 'recipients', 'o2m', 'list-o2m', true, 40,
  'Resolved recipients + per-recipient delivery log (migration 219). Hidden in the app UI; walked by the Member read policy.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'announcements' AND field = 'recipients');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'announcement_recipients', 'announcement', 'announcements', 'recipients', NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'announcement_recipients' AND many_field = 'announcement');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'announcement_recipients', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'announcement_recipients' AND many_field = 'member');

-- ── Unhide the dormant targeting fields (005-add-announcements.mjs:152-154) ──
-- audience_teams/audience_roles were created hidden with note "future use".
-- This is that future. Conditions mirror audience_sport's show/hide rules so the
-- Directus admin form only surfaces the array relevant to the chosen type.
UPDATE directus_fields
SET hidden = false,
    interface = 'select-multiple-dropdown-m2o',
    note = 'Team IDs to target. Used when audience_type = teams.',
    options = '{"template":"{{name}}"}'::json,
    conditions = '[{"name":"Hide unless teams","rule":{"audience_type":{"_neq":"teams"}},"hidden":true},{"name":"Show for teams","rule":{"audience_type":{"_eq":"teams"}},"hidden":false}]'::json
WHERE collection = 'announcements' AND field = 'audience_teams';

UPDATE directus_fields
SET hidden = false,
    interface = 'tags',
    note = 'Prefixed role tokens to target (role:* / fn:* / qual:*). Used when audience_type = roles.',
    conditions = '[{"name":"Hide unless roles","rule":{"audience_type":{"_neq":"roles"}},"hidden":true},{"name":"Show for roles","rule":{"audience_type":{"_eq":"roles"}},"hidden":false}]'::json
WHERE collection = 'announcements' AND field = 'audience_roles';

COMMIT;
