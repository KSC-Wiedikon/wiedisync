-- Migration 422: the last German names and values in the DB (clears
-- lint-db-names.baseline.json; plan: .planning/english-db-migration.md).
--
-- members.role  'vorstand' → 'board'
--   The stored role token. CHECK members_role_values_valid is rebuilt with it.
--   Trigger trg_members_vorstand_implies_admin / function
--   members_vorstand_implies_admin (migrations 402/403) → trg_members_board_implies_admin
--   / members_board_implies_admin, same rule as 403 (board with no admin tier gains
--   'admin'). The new trigger is in place before the rows change, so the swap
--   never meets a rule that does not know 'board'.
--   Stored copies of the token: events.invited_roles ('vorstand'),
--   announcements.audience_roles ('role:vorstand') — json arrays; none hold it on
--   dev or prod today, converted anyway and the
--   members.role choices in directus_fields. The Directus role "Vorstand" and the
--   policy "KSCW Vorstand" are labels and stay.
--   kscw-hooks maps a 'vorstand' sent by a cached bundle to 'board'.
--
-- Stats views
--   stats_games_missing_schreiber → stats_games_missing_scorer
--   stats_schreiber_coverage      → stats_scorer_coverage
--   stats_club_overview.upcoming_home_games_no_schreiber → upcoming_home_games_no_scorer
--   stats_club_overview.vb_vorstand / bb_vorstand        → vb_board / bb_board
--   stats_members.role_vorstand                          → role_board
--   stats_club_overview and stats_members count '"vorstand"' in their bodies; they
--   are re-created from their own current definition with the token swapped
--   (dev and prod definitions are identical, checked 16.10.2026). RENAME keeps
--   grants and security_invoker. No other view depends on these four, and none
--   is a Directus collection.
--   stats_games_missing_scorer.missing_roles keeps its display labels
--   ('Schreiber', 'Anzeiger', …) — text shown as is, not a stored value.
--
-- registrations.bb_doc_lizenz → bb_doc_licence
--   Missed by 413. Also the doc name inside bb_docs_waived (comma list).
--   kscw-website still posts and reads `bb_doc_lizenz`: /kscw/registration and
--   wadmin keep accepting / returning the old key.
--
-- fines.paid_to  'team_kasse' / 'club_kasse' → 'team_fund' / 'club_fund'
--   No row sets it on dev or prod. CHECK fines_paid_to_check rebuilt, Directus
--   choices updated.
--
-- clubdesk_offliz_to_dx(text) → clubdesk_official_licence_to_column(text)
--   Same body. Only caller: clubdesk-diff-queries.sql.
--
-- Directus is restarted by the deploy (schema-cache bust). Idempotent.

BEGIN;

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.rename_col(p_table text, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_old)
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_new) THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_table, p_old, p_new);
  END IF;
  UPDATE directus_fields SET field = p_new WHERE collection = p_table AND field = p_old;
END $$;

-- ── 1. members.role: the board rule under its English name ─────────────────
CREATE OR REPLACE FUNCTION members_board_implies_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.role IS NOT NULL
    AND NEW.role @> '["board"]'::jsonb
    AND NOT NEW.role ?| ARRAY['admin', 'vb_admin', 'bb_admin'] THEN
    NEW.role := NEW.role || '["admin"]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION members_board_implies_admin() IS
  'A board member always holds an admin tier (migrations 402/403): role with ''board'' and none of admin / vb_admin / bb_admin gains ''admin''. Was members_vorstand_implies_admin before migration 422.';

DROP TRIGGER IF EXISTS trg_members_vorstand_implies_admin ON members;
DROP TRIGGER IF EXISTS trg_members_board_implies_admin ON members;
CREATE TRIGGER trg_members_board_implies_admin
  BEFORE INSERT OR UPDATE OF role ON members
  FOR EACH ROW EXECUTE FUNCTION members_board_implies_admin();
DROP FUNCTION IF EXISTS members_vorstand_implies_admin();

-- ── 2. members.role: the token ─────────────────────────────────────────────
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_values_valid;

-- Swap in place, keeping each array's order.
UPDATE members m
   SET role = (SELECT jsonb_agg(CASE WHEN e.v = '"vorstand"'::jsonb THEN '"board"'::jsonb ELSE e.v END ORDER BY e.ord)
                 FROM jsonb_array_elements(m.role) WITH ORDINALITY AS e(v, ord))
 WHERE m.role @> '["vorstand"]'::jsonb;

ALTER TABLE members ADD CONSTRAINT members_role_values_valid
  CHECK (role <@ '["user", "admin", "superuser", "vb_admin", "bb_admin", "board", "website_admin", "finance"]'::jsonb);

-- Stored copies (json, not jsonb: text swap of the quoted token). Announcement
-- audiences hold it as 'role:vorstand' (audience.js), invitations as 'vorstand'.
UPDATE events SET invited_roles = regexp_replace(invited_roles::text, '"(role:)?vorstand"', '"\1board"', 'g')::json
 WHERE invited_roles::text ~ '"(role:)?vorstand"';
UPDATE announcements SET audience_roles = regexp_replace(audience_roles::text, '"(role:)?vorstand"', '"\1board"', 'g')::json
 WHERE audience_roles::text ~ '"(role:)?vorstand"';

UPDATE directus_fields
   SET options = replace(options::text, '{"text":"vorstand","value":"vorstand"}', '{"text":"board","value":"board"}')::json
 WHERE collection = 'members' AND field = 'role'
   AND options::text LIKE '%"vorstand"%';

UPDATE directus_presets
   SET filter = replace(filter::text, '"vorstand"', '"board"')::json
 WHERE collection IN ('members', 'events', 'announcements') AND filter::text LIKE '%"vorstand"%';

-- ── 3. Stats views ─────────────────────────────────────────────────────────
ALTER VIEW IF EXISTS stats_games_missing_schreiber RENAME TO stats_games_missing_scorer;
ALTER VIEW IF EXISTS stats_schreiber_coverage RENAME TO stats_scorer_coverage;

SELECT pg_temp.rename_col('stats_club_overview', 'upcoming_home_games_no_schreiber', 'upcoming_home_games_no_scorer');
SELECT pg_temp.rename_col('stats_club_overview', 'vb_vorstand', 'vb_board');
SELECT pg_temp.rename_col('stats_club_overview', 'bb_vorstand', 'bb_board');
SELECT pg_temp.rename_col('stats_members', 'role_vorstand', 'role_board');

DO $$
DECLARE
  v   text;
  def text;
BEGIN
  FOREACH v IN ARRAY ARRAY['stats_club_overview', 'stats_members'] LOOP
    def := pg_get_viewdef(format('public.%I', v)::regclass);
    CONTINUE WHEN def NOT LIKE '%vorstand%';
    def := replace(def, '''"vorstand"''::jsonb', '''"board"''::jsonb');
    IF def LIKE '%vorstand%' THEN
      RAISE EXCEPTION 'view % still names vorstand after the swap', v;
    END IF;
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS %s',
                   v, rtrim(def, E'; \n'));
  END LOOP;
END $$;

-- ── 4. registrations.bb_doc_lizenz → bb_doc_licence ────────────────────────
SELECT pg_temp.rename_col('registrations', 'bb_doc_lizenz', 'bb_doc_licence');
UPDATE directus_relations SET many_field = 'bb_doc_licence'
 WHERE many_collection = 'registrations' AND many_field = 'bb_doc_lizenz';

UPDATE registrations
   SET bb_docs_waived = regexp_replace(bb_docs_waived, '\mbb_doc_lizenz\M', 'bb_doc_licence', 'g')
 WHERE bb_docs_waived ~ '\mbb_doc_lizenz\M';

UPDATE directus_presets
   SET layout_query = CASE WHEN layout_query IS NULL THEN NULL ELSE replace(layout_query::text, '"bb_doc_lizenz"', '"bb_doc_licence"')::json END,
       filter       = CASE WHEN filter IS NULL THEN NULL ELSE replace(filter::text, '"bb_doc_lizenz"', '"bb_doc_licence"')::json END
 WHERE collection = 'registrations'
   AND (layout_query::text LIKE '%"bb_doc_lizenz"%' OR filter::text LIKE '%"bb_doc_lizenz"%');

-- ── 5. fines.paid_to ───────────────────────────────────────────────────────
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_paid_to_check;
UPDATE fines SET paid_to = CASE paid_to WHEN 'team_kasse' THEN 'team_fund' WHEN 'club_kasse' THEN 'club_fund' END
 WHERE paid_to IN ('team_kasse', 'club_kasse');
ALTER TABLE fines ADD CONSTRAINT fines_paid_to_check
  CHECK (paid_to IS NULL OR paid_to IN ('team_fund', 'club_fund'));

UPDATE directus_fields
   SET options = '{"choices":[{"text":"Team fund","value":"team_fund"},{"text":"Club fund","value":"club_fund"}]}'::json
 WHERE collection = 'fines' AND field = 'paid_to';

-- ── 6. ClubDesk licence-string mapper ──────────────────────────────────────
CREATE OR REPLACE FUNCTION clubdesk_official_licence_to_column(official_licence TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN official_licence LIKE '%Volleyball Lizenz%'            THEN 'scorer_vb'
    WHEN upper(btrim(official_licence)) = 'OTR1'                THEN 'otr1_bb'
    WHEN upper(btrim(official_licence)) = 'OTR2'                THEN 'otr2_bb'
    WHEN upper(replace(btrim(official_licence), ' ', '')) = 'OTN1' THEN 'otn1_bb'
    WHEN upper(replace(btrim(official_licence), ' ', '')) = 'OTN2' THEN 'otn2_bb'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION clubdesk_official_licence_to_column(TEXT) IS
  'ClubDesk "Offiziellen Lizenz" string -> members column name. A bare level-less "OTN" maps to NULL (migration 303). NULL = no column represents this value. Was clubdesk_offliz_to_dx before migration 422.';

DROP FUNCTION IF EXISTS clubdesk_offliz_to_dx(TEXT);

-- ── 7. Comments ────────────────────────────────────────────────────────────
COMMENT ON COLUMN registrations.bb_doc_licence IS 'Signed Swiss Basketball licence application (directus_files id). Column bb_doc_lizenz before migration 422.';
COMMENT ON COLUMN fines.paid_to IS 'team_fund | club_fund — whose cash the fine went to. Were team_kasse / club_kasse before migration 422.';

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FROM members WHERE role::text LIKE '%vorstand%';          -- → 0
--   SELECT count(*) FROM members WHERE role @> '["board"]';                   -- → 8 on prod
--   SELECT role_board FROM stats_members;                                     -- → 8
--   SELECT count(*) FROM stats_games_missing_scorer;                          -- runs
--   SELECT clubdesk_official_licence_to_column('OTN 2');                      -- → otn2_bb
