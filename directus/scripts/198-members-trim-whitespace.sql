-- Migration 198: trim existing leading/trailing whitespace on members text fields.
--
-- One-time cleanup of rows that already carry stray whitespace (surfaced
-- 2026-07-09: member 461 "Irini " / "Zoubos " — a trailing space added on both
-- names via the Directus admin UI). Going forward the kscw-hooks filter
-- `trimMemberStrings` (members.items.create / .update) strips leading/trailing
-- whitespace on every items-API write, so new occurrences can't land; this
-- migration fixes the history that predates the hook.
--
-- Dynamic over every text / varchar column on `members` (skips json/array cols
-- like `role`, and generated columns), so it stays correct as the schema grows.
-- Trims ASCII whitespace + U+00A0 non-breaking space, matching JS String.trim()
-- semantics closely enough for real data. Only rows that actually differ are
-- updated, so this is fully idempotent (re-running trims nothing new — repo
-- policy #2). Schema-touch-free: pure data backfill.

BEGIN;

DO $$
DECLARE
  col text;
  pat text := '^[[:space:]' || chr(160) || ']+|[[:space:]' || chr(160) || ']+$';
  n   bigint;
BEGIN
  FOR col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'members'
      AND data_type IN ('text', 'character varying')
      AND is_generated = 'NEVER'
    ORDER BY ordinal_position
  LOOP
    EXECUTE format(
      'UPDATE members SET %1$I = regexp_replace(%1$I, %2$L, %3$L, %4$L) '
      'WHERE %1$I IS NOT NULL AND %1$I <> regexp_replace(%1$I, %2$L, %3$L, %4$L)',
      col, pat, '', 'g');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'members.%: trimmed % row(s)', col, n;
    END IF;
  END LOOP;
END $$;

COMMIT;
