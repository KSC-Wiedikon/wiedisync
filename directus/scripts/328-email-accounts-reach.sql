-- Migration 328: email_accounts.sends_via + broad_audience — which mailbox can
-- reach the whole Verein, and by what path
--
-- The 326/327 model had ONE `provider` column, which conflates two different
-- questions and gets both wrong for half the rows:
--   • where the mail LANDS (Migadu IMAP, ClubDesk) — what `provider` meant;
--   • how mail LEAVES as that address, and WHO it can reach.
-- `spielplanung@volleyball.kscw.ch` is a Migadu inbox AND an SES sender; calling
-- it "migadu" hides the half that matters when handing someone the password.
--
-- The operational question this answers: **which of these passwords lets the
-- holder mail the entire club?** That is a different and much larger blast
-- radius than reading a scheduling inbox, and nothing on the page showed it.
--
-- Evidence, checked in DNS on 18.08.2026 rather than assumed:
--   noreply.kscw.ch     v=spf1 include:amazonses.com ~all                        → SES
--   volleyball.kscw.ch  v=spf1 include:amazonses.com include:spf.migadu.com -all → SES + Migadu
--   basketball.kscw.ch  v=spf1 include:amazonses.com include:spf.migadu.com -all → SES + Migadu
--   wiedisync.kscw.ch   v=spf1 include:amazonses.com include:spf.migadu.com -all → SES + Migadu
--   mail.kscw.ch        v=spf1 include:spf.migadu.com include:amazonses.com -all → SES + Migadu
--   kscw.ch             v=spf1 redirect=_spf.clubdesk.com                        → ClubDesk ONLY
--
-- ⚠⚠ **Broad audience is NOT the same as SES.** `kscw.ch`'s SPF redirects to
-- ClubDesk, which is the club's member register *and* its mass-mail tool — so
-- `kontakt@kscw.ch` / `kscw@kscw.ch` reach the whole Verein without touching
-- AWS at all. Treating "SES" as the danger flag would have marked the two
-- addresses that actually carry a newsletter to every member as harmless.
--
-- ⚠ Conversely most SES senders are NARROW: the two scheduling boxes write to
-- opponent clubs, scorer@ to course participants, vis_transfers@ to foreign
-- federations. They send via AWS and reach a handful of people.
--
-- ⚠ `wiedisync@noreply.kscw.ch` is the one that mails everyone — it is
-- EMAIL_FROM on both containers, so every transactional mail AND the
-- /admin/announcements mass path goes out as it. It is also the only row here
-- with no mailbox and no password, which is exactly why it needs a flag rather
-- than being inferred from "has a password".
--
-- ⚠ INFRA.md's older claim that wiedisync.kscw.ch has "no SES identity and is
-- DMARC p=quarantine" is STALE — as of this check it carries include:amazonses
-- and _dmarc is p=none. That claim dates from the scorer-mailbox migration and
-- was true then; do not re-derive sending policy from it.
--
-- Schema + data, idempotent.

BEGIN;

ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sends_via text NOT NULL DEFAULT 'none';
-- Deliberately NOT NULL DEFAULT false: an account nobody has classified yet is
-- assumed narrow, so the badge means "someone established this reaches everyone",
-- never "nobody has looked". Under-flagging is visible; over-flagging is noise
-- that trains people to ignore the badge.
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS broad_audience boolean NOT NULL DEFAULT false;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS reach_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_accounts_sends_via_check') THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_sends_via_check
      CHECK (sends_via IN ('none', 'ses', 'migadu', 'clubdesk'));
  END IF;
END $$;

COMMENT ON COLUMN public.email_accounts.sends_via IS
  'How mail LEAVES as this address, as opposed to `provider` which is where it lands. '
  '''none'' = receive-only (postmaster boxes, DMARC report inboxes, archives). Checked against '
  'the domain SPF, not assumed from the domain name.';

COMMENT ON COLUMN public.email_accounts.broad_audience IS
  'true = whoever holds this password can mail the whole club (or a large slice of it). NOT a '
  'synonym for sends_via=''ses'': kscw.ch sends via ClubDesk and reaches every member, while most '
  'SES senders here write to a handful of opponents or course participants. Drives the warning '
  'badge on /admin/emails-garage.';

COMMENT ON COLUMN public.email_accounts.reach_note IS
  'Why this account has the reach it has — shown in the UI so the badge is auditable rather than '
  'a value someone has to trust.';

-- ── Classification ─────────────────────────────────────────────
-- Addressed individually: a domain rule would be wrong for admin@wiedisync
-- (sends, narrow) vs wiedisync@noreply (sends, everyone) on the same suffix.

UPDATE email_accounts SET sends_via = 'ses', broad_audience = true,
  reach_note = 'EMAIL_FROM on both containers — every transactional mail and the /admin/announcements mass path goes out as this address. Reaches every member. No mailbox and no password: outbound identity only.'
WHERE address = 'wiedisync@noreply.kscw.ch';

UPDATE email_accounts SET sends_via = 'clubdesk', broad_audience = true,
  reach_note = 'kscw.ch SPF redirects to _spf.clubdesk.com — ClubDesk is the club register AND its mass-mail tool, so this address can newsletter every member without touching AWS.'
WHERE address IN ('kontakt@kscw.ch', 'kscw@kscw.ch');

UPDATE email_accounts SET sends_via = 'ses', broad_audience = false,
  reach_note = 'Sends to opponent clubs via SES (DKIM-aligned for its own domain). Audience is the fixtures'' opponents, not the club.'
WHERE address IN ('spielplanung@volleyball.kscw.ch', 'spielplanung@basketball.kscw.ch');

UPDATE email_accounts SET sends_via = 'ses', broad_audience = false,
  reach_note = 'Sends course correspondence and exam results to Schreiber-course participants.'
WHERE address = 'scorer@volleyball.kscw.ch';

UPDATE email_accounts SET sends_via = 'ses', broad_audience = false,
  reach_note = 'Club-admin correspondence and the Google-calendar change digest. Sends to named recipients, not to the membership.'
WHERE address = 'admin@wiedisync.kscw.ch';

UPDATE email_accounts SET sends_via = 'ses', broad_audience = false,
  reach_note = 'Transfer correspondence with FIVB VIS and foreign federations.'
WHERE address = 'vis_transfers@mail.kscw.ch';

UPDATE email_accounts SET sends_via = 'none', broad_audience = false,
  reach_note = 'Archive recipient for submitted reimbursements. Receive-only — real delivery to the treasurer is FINANCE_NOTIFY_EMAILS.'
WHERE address = 'finance@mail.kscw.ch';

-- Swept in from Migadu: postmaster boxes, the DMARC report inbox and the
-- basketball waitlist. All receive-only until someone says otherwise.
UPDATE email_accounts SET sends_via = 'none', broad_audience = false,
  reach_note = 'Postmaster box for the domain — receive-only.'
WHERE address IN ('admin@mail.kscw.ch', 'admin@volleyball.kscw.ch', 'admin@basketball.kscw.ch');

UPDATE email_accounts SET sends_via = 'none', broad_audience = false,
  reach_note = 'Receives DMARC aggregate reports (the rua= target). Receive-only.'
WHERE address = 'dmarc@wiedisync.kscw.ch';

UPDATE email_accounts SET sends_via = 'none', broad_audience = false,
  reach_note = 'Junior waitlist enquiries. Receive-only.'
WHERE address = 'waitlist@basketball.kscw.ch';

COMMIT;

-- Verification (dev/prod):
--   SELECT address, provider, sends_via, broad_audience FROM email_accounts ORDER BY broad_audience DESC, address;
--   -- → exactly 3 broad: wiedisync@noreply (ses), kontakt@kscw.ch + kscw@kscw.ch (clubdesk)
