-- Migration 256 — organize the members admin form: field groups, missing
-- registrations, and column documentation
--
-- Context (DB review 2026-07-27, finding MBR-05 + the members-reorg Phase 1
-- recommendation). members carries ~95 registered fields and ZERO field
-- groups anywhere in this Directus instance — the admin form is one flat
-- list, which is the "table is getting messy" feeling in UI form. The
-- review's verdict: the table is wide but sound (only last_online_at was
-- dead, and it received its writer in the same change-set) — so the fix is
-- organization, not surgery: 14 collapsible groups mirroring the audited
-- column clusters, registration of the 6 unregistered columns (ClubDesk sync
-- bookkeeping + never_dun + last_export_at), and COMMENT ON COLUMN for the
-- non-obvious columns that lacked one (existing comments — nationalitaet,
-- in_vis, e2ee_*, otn_bb… — are preserved, never overwritten).
--
-- Pure metadata + comments: no app-code impact, no permission change.
-- Directus picks the groups up after the container restart that is part of
-- every deploy. Idempotent.

BEGIN;

-- ── (1) The 14 groups ────────────────────────────────────────────────────
-- A group is a directus_fields row: special='alias,no-data,group',
-- interface='group-detail'; children point at it via "group".
DO $$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('grp_identity',    10, 'open',   'Identity & contact'),
      ('grp_address',     20, 'closed', 'Address & personal data (ClubDesk)'),
      ('grp_club_status', 30, 'closed', 'Club status & lifecycle'),
      ('grp_sport',       40, 'closed', 'Sport identity'),
      ('grp_licences_vb', 50, 'closed', 'VB licences & VM sync'),
      ('grp_licences_bb', 60, 'closed', 'BB licences'),
      ('grp_prefs',       70, 'closed', 'Notifications & auto-confirm'),
      ('grp_comms',       80, 'closed', 'Communications & messaging'),
      ('grp_privacy',     90, 'closed', 'Privacy & visibility'),
      ('grp_billing',    100, 'closed', 'Billing & finance'),
      ('grp_clubdesk',   110, 'closed', 'ClubDesk sync bookkeeping'),
      ('grp_e2ee',       120, 'closed', 'E2EE key material'),
      ('grp_vis',        130, 'closed', 'VIS & transfers'),
      ('grp_account',    140, 'closed', 'Account & system')
    ) AS v(field, sort, start, label)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = g.field
    ) THEN
      INSERT INTO directus_fields
        (collection, field, special, interface, options, readonly, hidden,
         sort, width, translations, note, required)
      VALUES
        ('members', g.field, 'alias,no-data,group', 'group-detail',
         json_build_object('start', g.start)::json, false, false,
         g.sort, 'full',
         json_build_array(json_build_object('language', 'en-US', 'translation', g.label))::json,
         NULL, false);
    END IF;
  END LOOP;
END $$;

-- ── (2) Assign every field to its group ──────────────────────────────────
DO $$
DECLARE
  a record;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
      ('grp_identity',    ARRAY['email','first_name','last_name','nickname','phone','photo','birthdate','sex','language']),
      ('grp_address',     ARRAY['adresse','plz','ort','anrede','ahv_nummer','nationalitaet','nationalitaet_codes','beitragskategorie','sektion']),
      ('grp_club_status', ARRAY['kscw_membership_active','wiedisync_active','shell','shell_expires','shell_reminder_sent','requested_team','coach_approved_team','consent_prompted_at','consent_decision','is_spielplaner','spielplaner_assignments','member_teams']),
      ('grp_sport',       ARRAY['number','position','license_nr']),
      ('grp_licences_vb', ARRAY['licence_category','licence_activated','licence_validated','vm_email','scorer_vb','referee_vb']),
      ('grp_licences_bb', ARRAY['otr1_bb','otr2_bb','otn_bb','otn1_bb','otn2_bb','referee_bb']),
      ('grp_prefs',       ARRAY['auto_confirm_trainings','auto_confirm_games','auto_confirm_events','email_notify_registrations','email_notify_join_requests','email_notify_form_submissions','email_notify_announcements','email_notify_events','push_preview_content']),
      ('grp_comms',       ARRAY['communications_team_chat_enabled','communications_dm_enabled','communications_banned','last_online_at','last_export_at']),
      ('grp_privacy',     ARRAY['hide_phone','hide_email','birthdate_visibility','website_visible','website_name_private']),
      ('grp_billing',     ARRAY['iban','iban_confirmed','billing_different','billing_name','billing_email','billing_address','billing_plz','billing_ort','billing_phone','billing_iban','never_dun']),
      ('grp_clubdesk',    ARRAY['clubdesk_id','clubdesk_push_pending','clubdesk_push_changes','clubdesk_pushed_at','clubdesk_sync_exclude','js_id']),
      ('grp_e2ee',        ARRAY['e2ee_public_key','e2ee_private_key','e2ee_kdf_salt','e2ee_key_created']),
      ('grp_vis',         ARRAY['federation_of_origin','transfer_status','transfer_done_at','transfer_done_by_name','transfer_note','in_vis','in_vis_checked_at','vis_player_no']),
      ('grp_account',     ARRAY['user','uuid','ical_token','role','id','date_created','date_updated'])
    ) AS v(grp, fields)
  LOOP
    FOR i IN 1 .. array_length(a.fields, 1) LOOP
      UPDATE directus_fields
         SET "group" = a.grp, sort = i
       WHERE collection = 'members' AND field = a.fields[i];
    END LOOP;
  END LOOP;
END $$;

-- ── (3) Register the 6 unregistered columns ──────────────────────────────
-- (interface NULL → Directus default by type; sync bookkeeping is readonly —
-- those columns belong to the ClubDesk pipeline, not to human edits.)
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('clubdesk_id',          'grp_clubdesk', true,  1),
      ('clubdesk_push_pending','grp_clubdesk', true,  2),
      ('clubdesk_push_changes','grp_clubdesk', true,  3),
      ('clubdesk_pushed_at',   'grp_clubdesk', true,  4),
      ('last_export_at',       'grp_comms',    true,  5),
      ('never_dun',            'grp_billing',  false, 11)
    ) AS v(field, grp, ro, sort)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = f.field
    ) THEN
      INSERT INTO directus_fields
        (collection, field, special, interface, options, readonly, hidden,
         sort, width, "group", required)
      VALUES
        ('members', f.field,
         CASE WHEN f.field = 'clubdesk_push_changes' THEN 'cast-json' ELSE NULL END,
         NULL, NULL, f.ro, false, f.sort, 'full', f.grp, false);
    END IF;
  END LOOP;
END $$;

-- ── (4) Document the non-obvious columns that lack a comment ─────────────
-- Existing comments (nationalitaet, in_vis, otn_bb, e2ee_*, …) are never
-- overwritten: apply only where col_description() is NULL.
DO $$
DECLARE
  c record;
  v_attnum smallint;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('license_nr',        'Swiss Volley / Basketplan licence number as a STRING — leading zeros are significant (e.g. 038514). Exact join key for VM sync, scorer rosters and the Basketplan people join; partial-unique since migration 248. NOTE the spelling split, frozen by decision (DB review 2026-07-27): this column is US "license", the licence_* trio is UK — renaming either side would churn every sync and export for zero behavior.'),
      ('licence_category',  'VM-synced licence category (weekly vm-sync-check write-back). UK spelling — see license_nr for the frozen spelling split.'),
      ('licence_activated', 'VM-synced flag (set-true-only since 2026-07-17 — VM is a subset of ClubDesk; nothing auto-clears).'),
      ('licence_validated', 'VM-synced flag (set-true-only, like licence_activated).'),
      ('vm_email',          'Volleymanager account email — fallback VM join key when license_nr is absent. Partial-unique since migration 248.'),
      ('beitragskategorie', 'ClubDesk fee category (German picklist value, ClubDesk-owned; synced down, never derived here).'),
      ('last_online_at',    'Presence timestamp for the admin Explorer ("Last online"). Written by the auth.login hook on every login; coarse by design — refresh-token sessions only touch it at real logins.'),
      ('last_export_at',    'Messaging export rate-limit marker (1/day) — messaging-helpers, not a sync column.'),
      ('never_dun',         'Finance: exclude this member from dunning runs entirely.'),
      ('clubdesk_id',       'ClubDesk [Id] — the CSV-import record identity for sync-up rows. NOT Filtern-searchable in the ClubDesk UI (use members.uuid there). Fill-only from sync-down.'),
      ('clubdesk_push_pending', 'ClubDesk sync-up dispatcher flag: member has un-pushed field changes.'),
      ('clubdesk_push_changes', 'Coded field diff awaiting ClubDesk sync-up (rendered per-locale at read time — values travel as codes).'),
      ('clubdesk_pushed_at',    'Timestamp of the last ClubDesk sync-up covering this member.'),
      ('clubdesk_sync_exclude', 'Opt this member out of the ClubDesk two-way sync entirely.'),
      ('uuid',              'Wiedisync ID — the stable round-trip key for ClubDesk contact matching (Filtern box) and exports. Never re-issued.'),
      ('ical_token',        'Per-member calendar-feed token (unique). Rotating it invalidates the member''s calendar subscription.'),
      ('shell',             'Shell member: pre-created by an invite, not yet self-registered. trg_members_shell_convert flips the lifecycle on first login.'),
      ('shell_expires',     'When an unclaimed shell invite lapses (reminder handled by shell_reminder_sent).'),
      ('coach_approved_team',   'Set once a coach approved the join request (requested_team flow).'),
      ('requested_team',    'Join-team picker choice awaiting coach approval; FK to teams since migration 248.'),
      ('wiedisync_active',  'Member has an activated wiedisync account (distinct from kscw_membership_active, the club-register status).'),
      ('consent_decision',  'Messaging consent state (pending/accepted/declined) — gates chat features, prompted at first login.'),
      ('in_vis_checked_at', 'When the monthly VIS player-check last touched this member (see in_vis for what the VIS index does and does not mean).'),
      ('transfer_note',     'Free-text staff note on the federation-transfer workflow (see transfer_status).')
    ) AS v(col, txt)
  LOOP
    SELECT attnum INTO v_attnum FROM pg_attribute
     WHERE attrelid = 'public.members'::regclass
       AND attname = c.col AND NOT attisdropped;
    -- Skip columns absent on a divergent clone; never overwrite an existing
    -- comment.
    IF v_attnum IS NOT NULL
       AND col_description('public.members'::regclass, v_attnum) IS NULL THEN
      EXECUTE format('COMMENT ON COLUMN public.members.%I IS %L', c.col, c.txt);
    END IF;
  END LOOP;
END $$;

COMMIT;
