-- Migration 232: record whether a Swiss-club transfer held a licence recently,
-- so the Freibrief gate can waive the document where Swiss Basketball waives it.
--
-- Swiss Basketball does not require the Freibrief (release letter) from a player
-- transferring out of another Swiss club when either:
--   - they held no licence in the last two seasons — the former club has nothing
--     to release, and asking sends the applicant to chase a document that club
--     has no reason to issue
--   - the category is U12 or below
-- ("Verfahren Lizenz SWB" §3, and the 2026-27 licence mail of 22.07.2026.)
--
-- The age half is derived from geburtsdatum and needs no column. The licence
-- history cannot be derived — only the applicant knows — so it is asked on the
-- registration form and stored here.
--
-- ⚠ WHY THE COLUMN MUST EXIST BEFORE THE FORM USES IT. bbRequiredDocs() is
-- enforced at three points (registration create, doc-status, approval gate) and
-- POST /kscw/registration rejects a submission whose required documents are
-- missing with HTTP 400. A client that waives the Freibrief while this gate still
-- demands it does not spare anyone the document — it stops them registering at
-- all, which is exactly what happened when kscw-website 1.15.1 shipped the
-- client half alone. Website and gate change together, backend first.
--
-- NULL is the honest default for every existing row: unanswered, not "no". Only
-- an explicit 'nein' waives, so back-filling nothing keeps historic rows exactly
-- as strict as they are today. The U12 rule does relax retroactively, which is
-- safe: it only ever removes a requirement, never adds one, so no pending
-- registration can become un-approvable because of it.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS bb_recent_licence varchar(4);

-- 'ja' | 'nein' only. A CHECK rather than an enum: the set is closed and tiny,
-- and Directus surfaces a varchar cleanly without a custom type.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'registrations_bb_recent_licence_check'
  ) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_bb_recent_licence_check
      CHECK (bb_recent_licence IS NULL OR bb_recent_licence IN ('ja', 'nein'));
  END IF;
END $$;

COMMENT ON COLUMN registrations.bb_recent_licence IS
  'Basketball transfer_ch only: did the applicant hold a Swiss Basketball licence in the last two seasons? ja/nein, NULL = not asked. Only ''nein'' waives the Freibrief (see bb-docs.js bbFreibriefWaived).';
