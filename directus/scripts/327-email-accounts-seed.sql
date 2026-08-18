-- Migration 327: seed the Emails Garage with the club's actual mailbox inventory
--
-- Migration 326 created an empty table. An empty credential store answers the
-- wrong half of the question — "which mailboxes does the club even have?" is the
-- part nobody could answer without asking Luca, and it is knowable from
-- INFRA.md without knowing a single password.
--
-- So: every live KSCW address, with its purpose and section, and NO passwords.
-- The page then opens on a complete inventory where each row says "not stored"
-- until a club admin fills it in — which is the one thing this migration cannot
-- do, because the passwords live in a Vaultwarden the server cannot read.
--
-- ⚠ Addresses only, deliberately. Putting a password in a migration would put it
-- in git, which is the exact thing password_enc + EMAIL_VAULT_KEY exist to avoid.
--
-- ⚠ ON CONFLICT DO NOTHING against the lower(address) unique index from 326, so
-- a re-run never overwrites a password an admin has since entered, and never
-- resurrects an address someone deliberately deleted's… no — it DOES re-insert a
-- deleted row on re-apply. The runner applies each file once (sha-locked), so
-- that only matters for a hand-run; noted rather than guarded, because the cost
-- is one unwanted row and the guard would be a tombstone table.
--
-- ⚠ `sport` is set explicitly rather than left to the endpoint's domain rule:
-- scorer@volleyball.kscw.ch is volleyball by both, but finance@mail.kscw.ch and
-- admin@wiedisync.kscw.ch are club-wide by INTENT while their domains say
-- nothing. Intent is what decides who sees the row.
--
-- ⚠ wiedisync@noreply.kscw.ch is OUTBOUND ONLY — the SES From for transactional
-- mail. It has no mailbox and can never have a password; it is listed so nobody
-- goes looking for the login to a thing that has none.
--
-- Data-only, idempotent.

BEGIN;

INSERT INTO email_accounts (address, label, sport, provider, notes, migadu_managed, is_active, sort)
VALUES
  ('spielplanung@volleyball.kscw.ch', 'Volleyball scheduling',
   'volleyball', 'migadu',
   'Opponent correspondence for game scheduling. Read in-app under Spielplanung → Mailbox; synced over IMAP every 10 minutes.',
   true, true, 10),

  ('spielplanung@basketball.kscw.ch', 'Basketball scheduling',
   'basketball', 'migadu',
   'Basketball half of the scheduling mailbox. Same in-app Mailbox tab, behind the sport toggle.',
   true, true, 20),

  ('scorer@volleyball.kscw.ch', 'Schreiber-Ausbildung',
   'volleyball', 'migadu',
   'Scorer-course signups, match sheets and replies to the exam-result mail. Read in Migadu webmail — it has no in-app mailbox tab.',
   true, true, 30),

  ('admin@wiedisync.kscw.ch', 'Club admin mailbox',
   'club', 'migadu',
   'General club admin correspondence, plus the Google-calendar change notifications. Read in-app under Admin → Club mailbox (global admins only).',
   true, true, 40),

  ('finance@mail.kscw.ch', 'Finance archive',
   'club', 'migadu',
   'Archive copy of submitted reimbursements. ⚠ Mail sent here alone does NOT reach the treasurer — the ClubDesk forward is quarantined by DMARC. Real delivery is FINANCE_NOTIFY_EMAILS.',
   true, true, 50),

  ('vis_transfers@mail.kscw.ch', 'FIVB VIS transfers',
   'volleyball', 'migadu',
   'International transfer correspondence with FIVB VIS and foreign federations.',
   true, true, 60),

  ('kontakt@kscw.ch', 'General club contact',
   'club', 'clubdesk',
   'The address published on kscw.ch. Runs through ClubDesk, not Migadu.',
   false, true, 70),

  ('kscw@kscw.ch', 'Club address',
   'club', 'clubdesk',
   'Club-wide address in the website footer. ClubDesk.',
   false, true, 80),

  ('wiedisync@noreply.kscw.ch', 'Transactional sender (outbound only)',
   'club', 'ses',
   '⚠ Not a mailbox — the AWS SES From for app email. There is no login and never will be a password; replies to it go nowhere.',
   false, true, 90)
ON CONFLICT (lower(address)) DO NOTHING;

COMMIT;

-- Verification (dev/prod):
--   SELECT address, sport, provider, (password_enc IS NOT NULL) AS has_pw
--     FROM email_accounts ORDER BY sort;     -- → 9 rows, has_pw all false
