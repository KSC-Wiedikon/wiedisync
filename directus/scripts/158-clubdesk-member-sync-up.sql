-- Migration 158: ClubDesk member sync-UP support (Phase 2).
--
-- (1) Persist ClubDesk's contact [Id] onto members. The link between a wiedisync
--     member and a ClubDesk contact was previously implicit (e-mail only); the
--     ClubDesk [Id] was captured into the clubdesk_export staging but never onto
--     members. Backfill it from the latest staging export, matched by e-mail
--     (+ alternativ) with a first-name-token guard — the SAME safe match the
--     sync-down birthdate pass uses (import-clubdesk-csv.mjs). Only UNAMBIGUOUS
--     matches are assigned (a shared family e-mail resolving to 2 ClubDesk ids is
--     skipped). Members still NULL after this are the genuinely unlinked set:
--     new members (push as "neu") or divergent-e-mail cases (manual review — they
--     exist in ClubDesk under a different address, so an e-mail-keyed import would
--     duplicate them).
--
-- (2) Dirty-flag for the sync-up push: clubdesk_push_pending is set when a member
--     is created from a registration or edits a ClubDesk-relevant field, and
--     cleared after a successful push. clubdesk_push_changes remembers the
--     field-level diff for the modal echo; clubdesk_pushed_at stamps the last push.
--
-- Schema-only + idempotent. Read/written by raw knex in the endpoints + dispatcher,
-- so no directus_fields registration is required.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS clubdesk_id           varchar(64),
  ADD COLUMN IF NOT EXISTS clubdesk_push_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clubdesk_push_changes jsonb,
  ADD COLUMN IF NOT EXISTS clubdesk_pushed_at    timestamp with time zone;

CREATE INDEX IF NOT EXISTS members_clubdesk_id_idx ON members (clubdesk_id);
CREATE INDEX IF NOT EXISTS members_clubdesk_push_pending_idx
  ON members (clubdesk_push_pending) WHERE clubdesk_push_pending;

-- Backfill clubdesk_id from staging (idempotent — only fills NULLs).
WITH cd AS (
  SELECT lower(btrim(email))            AS email,
         lower(btrim(email_alternativ)) AS email_alt,
         lower(split_part(btrim(vorname), ' ', 1)) AS vorname_tok,
         btrim(clubdesk_id)             AS clubdesk_id
  FROM clubdesk_export
  WHERE NULLIF(btrim(clubdesk_id), '') IS NOT NULL
    AND NULLIF(btrim(email), '') IS NOT NULL
),
matched AS (
  SELECT mm.id, min(cd.clubdesk_id) AS clubdesk_id
  FROM members mm
  JOIN cd ON lower(btrim(mm.email)) IN (cd.email, cd.email_alt)
        AND (cd.vorname_tok = '' OR lower(btrim(mm.first_name)) LIKE cd.vorname_tok || '%')
  WHERE NULLIF(btrim(mm.email), '') IS NOT NULL
  GROUP BY mm.id
  HAVING count(DISTINCT cd.clubdesk_id) = 1   -- unambiguous matches only
)
UPDATE members mm SET clubdesk_id = matched.clubdesk_id
  FROM matched WHERE mm.id = matched.id AND mm.clubdesk_id IS NULL;

COMMIT;
