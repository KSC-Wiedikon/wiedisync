-- Migration 416: member values in English, step 2 of 3 (phase 2b-2b of the
-- English-only DB migration, plan: .planning/english-db-migration.md).
--
--   members.club_section, registrations.club_section_choice
--       Volleyball / Basketball / KSCW → volleyball / basketball / club
--   members.register_status
--       Aktivmitglied → active, Passivmitglied → passive, Ehrenmitglied → honorary,
--       Ehemaliges Mitglied → former, Kein Mitglied → non_member,
--       Verstorben → deceased, Zwischenjahr → gap_year
--
-- ClubDesk keeps its wording: the push maps back at the cell
-- (member-values.js / app_to_cd), the pull stages slugs (cd_to_app). The
-- staging table clubdesk_export and its views stay German.
-- permissions_section is unaffected: kscw_member_sport_section() compares the
-- section lower-cased and 'club' falls through exactly like 'kscw' did.
--
-- Stored copies move too: ClubDesk proposals (incl. refused tombstones),
-- members.clubdesk_push_changes and the Directus dropdowns. Idempotent.

BEGIN;

-- ── 1. CHECKs that spell the German statuses go first ───────────────────────
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_register_status_values;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_left_on_needs_departed_status;

-- ── 2. Values ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.member_value(p_field text, p_value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN btrim(p_value) = '' AND p_field IN ('club_section', 'register_status') THEN NULL
    WHEN p_field = 'club_section' THEN CASE lower(btrim(p_value))
      WHEN 'volleyball' THEN 'volleyball' WHEN 'basketball' THEN 'basketball'
      WHEN 'kscw' THEN 'club' WHEN 'club' THEN 'club' ELSE p_value END
    WHEN p_field = 'register_status' THEN CASE btrim(p_value)
      WHEN 'Aktivmitglied' THEN 'active' WHEN 'Passivmitglied' THEN 'passive'
      WHEN 'Ehrenmitglied' THEN 'honorary' WHEN 'Ehemaliges Mitglied' THEN 'former'
      WHEN 'Kein Mitglied' THEN 'non_member' WHEN 'Verstorben' THEN 'deceased'
      WHEN 'Zwischenjahr' THEN 'gap_year' ELSE p_value END
    ELSE p_value END
$$;

UPDATE members SET club_section = pg_temp.member_value('club_section', club_section)
 WHERE club_section IS DISTINCT FROM pg_temp.member_value('club_section', club_section);
UPDATE members SET register_status = pg_temp.member_value('register_status', register_status)
 WHERE register_status IS DISTINCT FROM pg_temp.member_value('register_status', register_status);
UPDATE registrations SET club_section_choice = pg_temp.member_value('club_section', club_section_choice)
 WHERE club_section_choice IS DISTINCT FROM pg_temp.member_value('club_section', club_section_choice);

-- ── 3. Stored copies ─────────────────────────────────────────────────────────
UPDATE clubdesk_sync_proposals
   SET current_value  = pg_temp.member_value(field, current_value),
       proposed_value = pg_temp.member_value(field, proposed_value)
 WHERE field IN ('club_section', 'register_status')
   AND (current_value  IS DISTINCT FROM pg_temp.member_value(field, current_value)
     OR proposed_value IS DISTINCT FROM pg_temp.member_value(field, proposed_value));

UPDATE members m SET clubdesk_push_changes = (
    SELECT jsonb_agg(CASE
             WHEN jsonb_typeof(e) = 'object' AND e->>'field' IN ('club_section', 'register_status')
             THEN e || jsonb_build_object(
                    'old_value', pg_temp.member_value(e->>'field', e->>'old_value'),
                    'new_value', pg_temp.member_value(e->>'field', e->>'new_value'))
             ELSE e END ORDER BY ord)
      FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord))
 WHERE jsonb_typeof(m.clubdesk_push_changes) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
                WHERE jsonb_typeof(e) = 'object' AND e->>'field' IN ('club_section', 'register_status'));

-- ── 4. CHECKs on the slugs ───────────────────────────────────────────────────
ALTER TABLE members ADD CONSTRAINT members_register_status_values
  CHECK (register_status IS NULL OR register_status IN
    ('non_member', 'active', 'passive', 'honorary', 'former', 'deceased', 'gap_year'));
ALTER TABLE members ADD CONSTRAINT members_left_on_needs_departed_status
  CHECK (left_on IS NULL OR register_status IS NULL OR register_status IN ('non_member', 'former', 'deceased'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_club_section_values') THEN
    ALTER TABLE members ADD CONSTRAINT members_club_section_values
      CHECK (club_section IS NULL OR club_section IN ('volleyball', 'basketball', 'club'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_club_section_choice_values') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_club_section_choice_values
      CHECK (club_section_choice IS NULL OR club_section_choice IN ('volleyball', 'basketball', 'club'));
  END IF;
END $$;

-- ── 5. Directus metadata ─────────────────────────────────────────────────────
UPDATE directus_fields
   SET interface = 'select-dropdown',
       options = '{"choices":[{"text":"Volleyball","value":"volleyball"},{"text":"Basketball","value":"basketball"},{"text":"KSCW (club)","value":"club"}],"allowNone":true}'::json
 WHERE (collection = 'members' AND field = 'club_section')
    OR (collection = 'registrations' AND field = 'club_section_choice');
UPDATE directus_fields
   SET interface = 'select-dropdown',
       options = '{"choices":[{"text":"Aktivmitglied","value":"active"},{"text":"Passivmitglied","value":"passive"},{"text":"Ehrenmitglied","value":"honorary"},{"text":"Zwischenjahr","value":"gap_year"},{"text":"Ehemaliges Mitglied","value":"former"},{"text":"Kein Mitglied","value":"non_member"},{"text":"Verstorben","value":"deceased"}],"allowNone":true}'::json
 WHERE collection = 'members' AND field = 'register_status';

COMMENT ON COLUMN members.club_section IS 'ClubDesk register Sektion as a slug: volleyball | basketball | club (migration 416). Not the access scope — see permissions_section.';
COMMENT ON COLUMN members.register_status IS 'ClubDesk register Status as a slug: active | passive | honorary | gap_year | former | non_member | deceased (migration 416).';

COMMIT;
