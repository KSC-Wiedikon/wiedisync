-- Migration 249: audit-log indexes, redundant-index cleanup, FK delete-rule
-- corrections (DB review 2026-07-27: jix-03, jix-08, ri-06, ri-08, ri-10/FIN-09).
--
-- ── (1) user_logs indexes (jix-03) ───────────────────────────────────────
-- user_logs (370k rows — bounded: the daily 02:15 UTC purge cron in
-- kscw-hooks/src/audit.js deletes rows older than 90 days, so this is
-- steady-state volume, not unbounded growth) carries only user_logs_pkey and
-- user_logs_user_index. Yet every /admin/audit-log page view runs, via
-- kscw-endpoints/src/audit.js:
--   a) count(*) over the filtered set, then the same filter with
--      ORDER BY date_created DESC LIMIT 50 — full sort, no index;
--   b) SELECT DISTINCT collection_name over the whole table;
-- and /admin/audit/stats filters date_created >= now()-24h twice. Live
-- pg_stat_user_tables: ~60M tuples seq-read at ~220k rows per scan.
--
-- Index choice — minimal set of two for those shapes:
--   • (date_created DESC)                  → the unfiltered browse (the common
--     case: newest page first) and both stats range counts.
--   • (collection_name, date_created DESC) → the collection-filtered browse
--     resolves filter AND order from one index, and the DISTINCT
--     collection_name list becomes an index(-only) scan over the leading
--     column instead of a 370k-row seq scan + sort. A bare (collection_name)
--     index would serve only the DISTINCT and leave the filtered browse
--     re-sorting — the composite covers both, so the single-column variant
--     is not needed.
-- The action/record_id/actor/search filters are always post-filters on one of
-- these two access paths; none is selective enough to justify its own index.
--
-- ── (2) Drop redundant/duplicate indexes (jix-08) ────────────────────────
-- Six exact-duplicate or fully-covered indexes double write-side maintenance
-- for zero read benefit. Each drop re-verified live in pg_indexes against its
-- surviving twin before listing here. members_clubdesk_id_idx (also on the
-- jix-08 list, covered by the partial unique members_clubdesk_id_uq) is
-- dropped by migration 248, not here.
--
-- ── (3) team_requests.member NO ACTION → CASCADE (ri-06) ─────────────────
-- Migration 096 fixed exactly this trap on the team column but left member at
-- NO ACTION: deleting any member who ever filed a join request hard-fails on
-- the FK (43 rows / 36 distinct members live). A join request is meaningless
-- without the requester — same rationale as 003's CASCADE list, which covers
-- every other member-owned throwaway record.
--
-- ── (4) user_logs."user" CASCADE → SET NULL (ri-08) ──────────────────────
-- Migration 003's "audit trail for this member" framing predates user_logs
-- becoming the club-wide audit log. "user" is the ACTOR, not the subject:
-- CASCADE erases every log row of actions a deleted member (ex-coach,
-- ex-admin) performed on OTHER records — precisely what an audit trail exists
-- to preserve. ~66.8k of 370k rows carry a non-NULL actor. SET NULL keeps the
-- row; the reader already renders a NULL actor as 'system'. GDPR erasure of a
-- member's own trail, if ever wanted, belongs in the deletion procedure, not
-- in an FK side effect.
--
-- ── (5) fines.member / fines.team CASCADE → RESTRICT (ri-10 / FIN-09) ────
-- fines is a money ledger (amount, paid_at, paid_method — Kasse cash), yet
-- both FKs CASCADE: deleting a member with open fines silently deletes the
-- debt record. Every comparable money table chose protection instead
-- (finance_expenses.member / finance_payouts.member RESTRICT, migration 149's
-- "protect financial-audit records from cascade deletion"). Both columns are
-- NOT NULL, so RESTRICT is the compatible rule: settle/waive fines before
-- deleting the member or team. 0 fines rows live — the change is free now.
-- fine_rules checked while here: team CASCADE stays (rule CONFIG dies with
-- the team — not money), updated_by is already SET NULL. No change.
--
-- Schema-only. Idempotent: IF NOT EXISTS / IF EXISTS on indexes; each FK
-- change is guarded by the current pg_constraint.confdeltype, so re-runs
-- skip straight through.

BEGIN;

-- ── (1) jix-03 — user_logs indexes ───────────────────────────────────────

CREATE INDEX IF NOT EXISTS user_logs_date_created_idx
  ON user_logs (date_created DESC);

CREATE INDEX IF NOT EXISTS user_logs_collection_date_idx
  ON user_logs (collection_name, date_created DESC);

-- ── (2) jix-08 — drop redundant/duplicate indexes ────────────────────────

DROP INDEX IF EXISTS blocks_blocked_index;                  -- twin: idx_blocks_blocked
DROP INDEX IF EXISTS messages_sender_index;                 -- twin: idx_messages_sender
DROP INDEX IF EXISTS messages_conversation_index;           -- prefix of idx_messages_conv_created (conversation, created_at DESC)
DROP INDEX IF EXISTS reports_reported_member_index;         -- twin: idx_reports_reported_member
DROP INDEX IF EXISTS spielplaner_assignments_member_index;  -- twin: idx_spielplaner_assignments_member (itself dropped below)
DROP INDEX IF EXISTS idx_spielplaner_assignments_member;    -- (member) prefix of uq_spielplaner_assignments_member_team
DROP INDEX IF EXISTS spielplaner_assignments_kscw_team_index; -- twin: idx_spielplaner_assignments_kscw_team (kept)

-- ── (3) ri-06 — team_requests.member → ON DELETE CASCADE ─────────────────

-- Repair first so the ADD cannot fail: a request whose member is gone is the
-- row the CASCADE would have removed. 0 rows live (the NO ACTION FK has kept
-- the column clean) — guard for divergent clones only.
DELETE FROM team_requests tr
 WHERE tr.member IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = tr.member);

DO $$
DECLARE cname text; drule "char";
BEGIN
  SELECT con.conname, con.confdeltype INTO cname, drule
    FROM pg_constraint con
   WHERE con.conrelid = 'public.team_requests'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.team_requests'::regclass
                                AND attname = 'member')]::smallint[];
  IF drule IS NOT DISTINCT FROM 'c' THEN
    RETURN;  -- already CASCADE
  END IF;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.team_requests DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.team_requests
    ADD CONSTRAINT team_requests_member_fkey
    FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE CASCADE;
END $$;

-- ── (4) ri-08 — user_logs."user" → ON DELETE SET NULL ────────────────────

-- SET NULL needs a nullable column. Verified nullable on prod (303,342 rows
-- already carry NULL); DROP NOT NULL is a no-op when already nullable.
ALTER TABLE user_logs ALTER COLUMN "user" DROP NOT NULL;

-- Repair first: an actor row that vanished without cascading (impossible
-- under the current CASCADE FK — divergent clones only) gets the SET NULL
-- treatment the new rule would have applied.
UPDATE user_logs ul
   SET "user" = NULL
 WHERE ul."user" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = ul."user");

DO $$
DECLARE cname text; drule "char";
BEGIN
  SELECT con.conname, con.confdeltype INTO cname, drule
    FROM pg_constraint con
   WHERE con.conrelid = 'public.user_logs'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.user_logs'::regclass
                                AND attname = 'user')]::smallint[];
  IF drule IS NOT DISTINCT FROM 'n' THEN
    RETURN;  -- already SET NULL
  END IF;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_logs DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.user_logs
    ADD CONSTRAINT user_logs_user_foreign
    FOREIGN KEY ("user") REFERENCES public.members(id) ON DELETE SET NULL;
END $$;

-- ── (5) ri-10 / FIN-09 — fines.member + fines.team → ON DELETE RESTRICT ──

-- Repair first: 0 fines rows live, and a dangling reference is impossible
-- while the current CASCADE FKs exist — on a divergent clone, deleting the
-- orphan mirrors what the pre-249 cascade would have done anyway.
DELETE FROM fines f
 WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.id = f.member)
    OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = f.team);

DO $$
DECLARE cname text; drule "char";
BEGIN
  SELECT con.conname, con.confdeltype INTO cname, drule
    FROM pg_constraint con
   WHERE con.conrelid = 'public.fines'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.fines'::regclass
                                AND attname = 'member')]::smallint[];
  IF drule IS NOT DISTINCT FROM 'r' THEN
    RETURN;  -- already RESTRICT
  END IF;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fines DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.fines
    ADD CONSTRAINT fines_member_fkey
    FOREIGN KEY (member) REFERENCES public.members(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE cname text; drule "char";
BEGIN
  SELECT con.conname, con.confdeltype INTO cname, drule
    FROM pg_constraint con
   WHERE con.conrelid = 'public.fines'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.fines'::regclass
                                AND attname = 'team')]::smallint[];
  IF drule IS NOT DISTINCT FROM 'r' THEN
    RETURN;  -- already RESTRICT
  END IF;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fines DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.fines
    ADD CONSTRAINT fines_team_fkey
    FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE RESTRICT;
END $$;

COMMIT;
