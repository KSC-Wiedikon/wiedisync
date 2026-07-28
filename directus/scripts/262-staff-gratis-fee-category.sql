-- 262 — Staff-only members default to the 'Gratis' fee category (fill-only)
--
-- Coaches/TRs enter through the app door (invite/claim signup), never through
-- the membership registration form, so they land with an EMPTY
-- members.beitragskategorie — and the ClubDesk contact the sync-up creates for
-- them carries no fee category either (surfaced 2026-07-28: Alexander Müller,
-- member 527 / ClubDesk 1001284). The club convention for staff-only people is
-- the existing ClubDesk category 'Gratis' (8 of 9 active staff-only members
-- already carry it, inherited from ClubDesk via the down-sync).
--
-- Rule (fill-only, never overwrites a set category): member is coach or team
-- responsible of ≥1 team, has NO non-guest roster row, is an active member,
-- and beitragskategorie is empty → 'Gratis'. ClubDesk-linked members are also
-- flagged for the next sync-up (clubdesk_push_pending + a push_changes entry,
-- same shape the kscw-hooks IBAN flag writes) so the fill-only UPDATE push
-- fills ClubDesk's empty Beitragskategorie cell; unlinked members carry the
-- category on their CREATE row. 'Gratis' is not in CD_BEITRAG_MAP, so the
-- Mitgliederbeitrag cell stays empty (never guessed) — verified 2026-07-28.
--
-- A player who later becomes staff keeps their playing category (fill-only);
-- a staff member who becomes a player gets their category from the
-- registration approval flow, which assigns over 'Gratis' deliberately.

CREATE OR REPLACE FUNCTION staff_gratis_fill() RETURNS trigger AS $$
BEGIN
  UPDATE members m SET
    beitragskategorie = 'Gratis',
    clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
      THEN true ELSE m.clubdesk_push_pending END,
    clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
        WHERE e->>'field' <> 'beitragskategorie')
      || jsonb_build_array(jsonb_build_object(
           'field', 'beitragskategorie', 'old_value', NULL, 'new_value', 'Gratis'))
      ELSE m.clubdesk_push_changes END
  WHERE m.id = NEW.members_id
    AND COALESCE(BTRIM(m.beitragskategorie), '') = ''
    AND m.kscw_membership_active IS TRUE
    AND NOT EXISTS (SELECT 1 FROM member_teams mt
                     WHERE mt.member = NEW.members_id
                       AND COALESCE(mt.guest_level, 0) = 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_gratis_coaches ON teams_coaches;
CREATE TRIGGER trg_staff_gratis_coaches
  AFTER INSERT ON teams_coaches
  FOR EACH ROW EXECUTE FUNCTION staff_gratis_fill();

DROP TRIGGER IF EXISTS trg_staff_gratis_responsibles ON teams_responsibles;
CREATE TRIGGER trg_staff_gratis_responsibles
  AFTER INSERT ON teams_responsibles
  FOR EACH ROW EXECUTE FUNCTION staff_gratis_fill();

-- Backfill current staff-only members with an empty category (idempotent: a
-- second run matches nothing because the category is no longer empty).
UPDATE members m SET
  beitragskategorie = 'Gratis',
  clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
    THEN true ELSE m.clubdesk_push_pending END,
  clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
    (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' <> 'beitragskategorie')
    || jsonb_build_array(jsonb_build_object(
         'field', 'beitragskategorie', 'old_value', NULL, 'new_value', 'Gratis'))
    ELSE m.clubdesk_push_changes END
WHERE COALESCE(BTRIM(m.beitragskategorie), '') = ''
  AND m.kscw_membership_active IS TRUE
  AND (EXISTS (SELECT 1 FROM teams_coaches tc WHERE tc.members_id = m.id)
       OR EXISTS (SELECT 1 FROM teams_responsibles tr WHERE tr.members_id = m.id))
  AND NOT EXISTS (SELECT 1 FROM member_teams mt
                   WHERE mt.member = m.id
                     AND COALESCE(mt.guest_level, 0) = 0);
