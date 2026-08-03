-- 277 — email_suppressions: addresses we must stop mailing.
--
-- Until now nothing in the platform consumed AWS SES bounce or complaint
-- notifications, so a dead address was retried on every send forever. That was
-- survivable while every audience was drawn from the active member register
-- (warm addresses, already receiving club mail). It stopped being survivable on
-- 2026-08-03, when the club mailbox gained a "former members" audience of 376
-- ClubDesk contacts with departures going back to 2018.
--
-- The risk is not the failed delivery, it is the shared identity: bounces and
-- complaints from a cold bulk send accrue against the SAME SES identity that
-- carries password resets, signup invitations, scheduling mail and expense
-- reimbursements. SES suspends on reputation, not per-campaign, so a bad blast
-- to ex-members can take down the club's transactional mail.
--
-- Populated by the SNS webhook (POST /kscw/ses/notify) and consulted by every
-- send path. Idempotent.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id            SERIAL PRIMARY KEY,
  -- Always stored lowercased+trimmed; every reader compares lower(email).
  email         VARCHAR(255) NOT NULL,
  -- 'bounce' | 'complaint' | 'manual'
  reason        VARCHAR(32)  NOT NULL,
  -- SES bounceSubType ('General', 'NoEmail', 'Suppressed', …) or
  -- complaintFeedbackType ('abuse', 'fraud', …). Kept raw for diagnosis.
  subtype       VARCHAR(64),
  detail        TEXT,
  source        VARCHAR(32)  NOT NULL DEFAULT 'ses',
  -- The SES message that triggered it, for tracing back to a send.
  ses_message_id VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Set to un-suppress (address fixed, member re-subscribed). Kept as a
  -- tombstone rather than a delete so the history of why we stopped mailing
  -- someone survives — that question comes up when a member asks why they
  -- never got the GV invitation.
  released_at   TIMESTAMPTZ,
  released_by   INTEGER
);

DO $$ BEGIN
  ALTER TABLE email_suppressions
    ADD CONSTRAINT email_suppressions_reason_chk
    CHECK (reason IN ('bounce', 'complaint', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE email_suppressions
    ADD CONSTRAINT email_suppressions_released_by_fk
    FOREIGN KEY (released_by) REFERENCES members(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One ACTIVE suppression per address; released rows stay as history. Lets the
-- webhook use a targetless ON CONFLICT DO NOTHING on repeat bounces.
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_active_uniq
  ON email_suppressions (email) WHERE released_at IS NULL;

-- The read every send path makes: "which of these addresses are suppressed".
CREATE INDEX IF NOT EXISTS email_suppressions_lookup
  ON email_suppressions (email) WHERE released_at IS NULL;

COMMENT ON TABLE email_suppressions IS
  'Addresses SES told us to stop mailing (permanent bounce / complaint), plus manual entries. Consulted by every send path; written by POST /kscw/ses/notify. released_at un-suppresses without losing the history.';
COMMENT ON COLUMN email_suppressions.reason IS
  'bounce = permanent only (transient bounces are NOT suppressed — a full mailbox is not a dead address); complaint = marked as spam; manual = added by an admin.';
