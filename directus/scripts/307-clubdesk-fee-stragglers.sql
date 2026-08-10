-- 307 — push the +CHF 10 to the 11 basketball contacts ClubDesk missed.
--
-- (Numbered 305 for about two minutes on 2026-08-10 and renumbered the same
-- hour: a parallel session had claimed 305 first. Dev therefore carries the
-- old filename in kscw_migrations as well — harmless, both this and 308 are
-- re-runnable by construction. Prod only ever sees these numbers.)
--
-- CONTEXT, because the obvious reading of this file is the wrong one. The
-- 2026-08-10 basketball increase (migration 304) did NOT originate in
-- wiedisync: the club had already raised the amounts in ClubDesk, and wiedisync
-- + the website were the ones lagging. Measured on prod with the real fee
-- engine over all 674 active linked members, the register already holds the new
-- price for the vast majority (31 Erwerbstätige at 520, 101 Jugend at 320, 47
-- Minis at 220, 14 1. Liga at 570, 13 Lernende at 420). Exactly ELEVEN rows
-- were left on the old price. Those are the ones below, and they are the ONLY
-- members whose Mitgliederbeitrag wiedisync may write over the register.
--
-- Everything else that disagrees (113 members) goes the OTHER way — the
-- register wins and its amount is pinned into the member's fee override by
-- migration 308. Read the two together or neither makes sense.
--
-- HOW THE OVERWRITE IS AUTHORISED: buildPushCsv sends Mitgliederbeitrag
-- fill-only (ClubDesk's own cell echoes back verbatim) UNLESS the member's
-- pending push NAMES the field — the same registerCell gate the register triple
-- uses. So this migration pushes nothing by itself; it flags the 11 and records
-- the field, and the next sync-up a human APPROVES carries the corrected
-- amount. Nothing else ever writes a 'mitgliederbeitrag' change entry — not the
-- members hook, not a category edit — so the licence stays scoped to this act.
--
-- ⚠ A flagged member is skipped by the Saturday sync-DOWN until the push lands
-- (migration 302's contract). For 11 rows that is the intended trade.
--
-- Idempotent: the change entry replaces any earlier one for the same field, and
-- a re-run simply re-asserts pending = true.

UPDATE members m
SET clubdesk_push_pending = true,
    clubdesk_push_changes = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' IS DISTINCT FROM 'mitgliederbeitrag'
    ) || jsonb_build_array(jsonb_build_object(
      'field', 'mitgliederbeitrag',
      'old_value', v.old_amount,
      'new_value', v.new_amount
    ))
FROM (VALUES
  (460, '310', '320'),  -- Zora Ziegler · BB Jugend Meisterschaft
  (485, '410', '420'),  -- Tiago Manuel Fernandez Santa Cruz · BB Jugend Meisterschaft
  (486, '410', '420'),  -- Leo Hebeisen · BB Jugend Meisterschaft
  (492, '410', '420'),  -- Emil Roth · BB Jugend Meisterschaft
  (494, '410', '420'),  -- Pau Parrilla · BB Jugend Meisterschaft
  (498, '410', '420'),  -- Osman Said · BB Jugend Meisterschaft
  (500, '410', '420'),  -- Shpat Iseni · BB Jugend Meisterschaft
  (501, '410', '420'),  -- Ennio Küchler · BB Jugend Meisterschaft
  (506, '410', '420'),  -- Leonardo Ammann · BB Jugend Meisterschaft
  (548, '210', '220'),  -- Leonardo Cuoco · BB Minis Turnier
  (730, '610', '620')   -- Nikolaos Chatzichrisafis · BB Erwerbstätige
) AS v(member_id, old_amount, new_amount)
WHERE m.id = v.member_id
  -- Never flag an unlinked member: an update row is keyed on [Id], and a
  -- contact that does not exist in ClubDesk has nothing to correct.
  AND NULLIF(BTRIM(COALESCE(m.clubdesk_id, '')), '') IS NOT NULL;
