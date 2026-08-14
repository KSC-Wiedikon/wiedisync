-- 317 — the six basketball juniors migration 308 pinned at the PRE-increase
-- price. User decision 2026-08-14: they rise too (310 → 320, 210 → 220).
--
-- HOW THEY GOT STUCK. The 2026-08-10 basketball increase raised every BB rate by
-- CHF 10 (migration 304). Migration 307 pushed the correction to the ELEVEN
-- contacts ClubDesk had left on the old price; migration 308 pinned the register's
-- own amount onto the 113 members where the register was deliberately different
-- ("the register wins"). These six fell on the 308 side of that split — so their
-- `fee_base_override` now holds the OLD amount, which does not merely record the
-- old price, it PERPETUATES it: the override outranks both the season rate
-- schedule and CD_BEITRAG_MAP, so no future increase would ever reach them
-- either. That is the actual defect being fixed here, not the CHF 60.
--
-- TWO DIFFERENT FIXES, because these are two different kinds of member:
--
--   • Brodmann, Ganguillet, Shanmugarajah, Waldinsperger → override CLEARED.
--     320 IS the standard 'BB Jugend Meisterschaft' rate, so they need no
--     per-person exception at all; with the override gone they follow the
--     category like everybody else and the next rate change carries them along.
--     Leaving a 320 pin would recreate exactly this bug at the next increase.
--
--   • Fahrni, Suter → override SET to 220. Their category derives 320, so 220 is
--     a genuine per-person exception (the register notes "Lizenzantrag fehlt" for
--     both). It has to stay expressed as an override; there is no category for it.
--
-- ⚠⚠ `fee_surcharge_override = false` MUST STAY on all six — it is doing real
-- work, not leftover from 308. Brodmann, Shanmugarajah and Waldinsperger are 18
-- with NO basketball official's licence (otr1/otr2/otn1/otn2 all false), and
-- 'BB Jugend Meisterschaft' is in SURCHARGE_YOUTH, so for a U16+ member the rule
-- adds the CHF 100 no-licence surcharge. Verified against feeBreakdown() with
-- their real rows: with the waiver each emits 320, without it 420. Whoever tidies
-- these overrides next must not "clean up" the boolean.
--
-- Verified 2026-08-14 by running feeBreakdown() over all six with the values
-- below: 320/320/320/320/220/220, 0 mismatches.
--
-- WHY THE PUSH FLAG. Mitgliederbeitrag is fill-only on an UPDATE row — ClubDesk's
-- own amount echoes back verbatim — UNLESS the member's pending push NAMES the
-- field (registerCell / CD_REGISTER_FIELDS). Nothing writes that entry
-- automatically: not the members hook, not a category edit. So this migration
-- pushes nothing by itself; it corrects wiedisync's derivation and records the
-- licence, and the next sync-up a human APPROVES carries 320/220 to the register.
-- Same scoped authorisation migration 307 used for its eleven.
--
-- ⚠ A flagged member is skipped by the Saturday sync-DOWN until the push lands
-- (migration 302's contract). For six rows that is the intended trade.
--
-- Data-only. Idempotent: the override writes are absolute values, and the change
-- entry replaces any earlier entry for the same field.

-- 1. Make wiedisync derive the new amount.
UPDATE members SET fee_base_override = NULL
WHERE id IN (508, 489, 616, 504)          -- Brodmann, Ganguillet, Shanmugarajah, Waldinsperger
  AND beitragskategorie = 'BB Jugend Meisterschaft';

UPDATE members SET fee_base_override = 220
WHERE id IN (507, 509)                     -- Fahrni, Suter — "Lizenzantrag fehlt"
  AND beitragskategorie = 'BB Jugend Meisterschaft';

-- 2. Licence the register correction for the next approved sync-up.
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
  (508, '310', '320'),  -- Maxim Brodmann · BB Jugend Meisterschaft
  (489, '310', '320'),  -- Robin Ganguillet · BB Jugend Meisterschaft
  (616, '310', '320'),  -- Shangith Shanmugarajah · BB Jugend Meisterschaft
  (504, '310', '320'),  -- Nicola Waldinsperger · BB Jugend Meisterschaft
  (507, '210', '220'),  -- Lena Fahrni · BB Jugend Meisterschaft
  (509, '210', '220')   -- Jonathan Suter · BB Jugend Meisterschaft
) AS v(member_id, old_amount, new_amount)
WHERE m.id = v.member_id
  AND NULLIF(BTRIM(COALESCE(m.clubdesk_id, '')), '') IS NOT NULL;
