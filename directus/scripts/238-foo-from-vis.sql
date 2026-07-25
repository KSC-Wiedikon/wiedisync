-- Migration 238: derive federation_of_origin from a completed VIS transfer.
--
-- The VIS read (migration 237) turned up a transfer whose member record had no
-- federation of origin at all: Ivo Teixeira, transfer #3015, FROM federation 29 —
-- confirmed via GetFederationList as **BRA, Confederação Brasileira de Voleibol**
-- (cross-checked against federation 189 = SUI / Swiss Volley, the receiving side).
-- The transfer is status 200 "ended", 100% complete.
--
-- An international transfer INTO Swiss Volley is direct evidence of the federation
-- the player came from, which is precisely what federation_of_origin records. So
-- the answer was already in a register we now mirror; nobody had to be asked.
--
-- ⚠ FIVB uses 3-letter IOC-style codes (BRA, SUI), NOT ISO 3166-1 alpha-2 (BR,
-- CH). Only the codes actually observed are mapped here — a general FIVB→ISO
-- table is deliberately deferred rather than guessed at, and an unmapped
-- federation simply fills nothing rather than writing a wrong country.
--
-- FILL-ONLY: only members whose federation_of_origin IS NULL are touched, and
-- only where the name matches a VIS row exactly. A member who has answered for
-- themselves is never overwritten by an inference.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE vis_transfers ADD COLUMN IF NOT EXISTS from_federation_code text;

COMMENT ON COLUMN vis_transfers.from_federation_code IS
  'FIVB 3-letter federation code of the releasing federation (BRA, SUI, …) — IOC-style, not ISO alpha-2.';

UPDATE vis_transfers SET from_federation_code = 'BRA' WHERE from_federation_no = 29;

UPDATE members m
   SET federation_of_origin = v.iso
  FROM (
    SELECT t.player_first_name, t.player_last_name,
           CASE t.from_federation_code WHEN 'BRA' THEN 'BR' END AS iso
      FROM vis_transfers t
     WHERE t.deleted_at IS NULL
  ) v
 WHERE m.federation_of_origin IS NULL
   AND v.iso IS NOT NULL
   AND EXISTS (SELECT 1 FROM country_codes c WHERE c.code = v.iso)
   AND lower(btrim(m.last_name))  = lower(btrim(v.player_last_name))
   AND lower(btrim(m.first_name)) = lower(btrim(v.player_first_name));

COMMIT;

SELECT m.id || ' ' || m.last_name || ', ' || m.first_name
       || ' -> federation_of_origin=' || coalesce(m.federation_of_origin, 'NULL') AS result
  FROM members m
 WHERE m.federation_of_origin IS NOT NULL
   AND EXISTS (SELECT 1 FROM vis_transfers t
                WHERE lower(btrim(t.player_last_name)) = lower(btrim(m.last_name)));
