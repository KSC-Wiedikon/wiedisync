-- Migration 329: say plainly that the two ClubDesk addresses have no password
--
-- `kontakt@kscw.ch` and `kscw@kscw.ch` are the two accounts flagged
-- broad_audience — they reach every member — and both sat in the garage reading
-- "Not stored", which invites exactly the wrong conclusion: that somebody simply
-- has not entered the password yet.
--
-- There is no password. Checked, not assumed:
--   • kscw.ch MX is mx0/mx1.clubdesk.com — ClubDesk is the whole mail system.
--   • No Vaultwarden entry exists for either address.
--   • Neither is an account in scheduling-mailbox.js; nothing authenticates as
--     them anywhere in the codebase.
--   • The code already says so twice, in `clubdesk-update.js` and
--     `registration.js`: ADMIN_EMAIL "is a forwarding alias (kontakt@kscw.ch)
--     without a member record". `kscw@kscw.ch` appears only as the published
--     contact address in the Impressum / privacy text.
--
-- They are forwarding aliases configured inside ClubDesk. What actually commands
-- them is a ClubDesk *account* login — which is a named person's credential, not
-- a mailbox password.
--
-- ⚠⚠ That personal login is deliberately NOT added to this table. The garage is
-- readable by every sport admin (vb_admin / bb_admin) for `sport = 'club'` rows,
-- and there is no "global admin only" visibility tier. Putting a named person's
-- ClubDesk password here would hand it to every section admin — a wider
-- disclosure than the two aliases were ever worth. It belongs in Vaultwarden.
--
-- ⚠ `broad_audience` stays TRUE for both. The reach is real regardless of where
-- the credential lives: whoever can log into ClubDesk can mail the whole Verein
-- as these addresses. Clearing the flag because the password is elsewhere would
-- hide the largest blast radius the club has.
--
-- Data-only, idempotent.

BEGIN;

UPDATE email_accounts SET
  reach_note = 'kscw.ch SPF redirects to _spf.clubdesk.com — ClubDesk is the club register AND its mass-mail tool, so this address can newsletter every member without touching AWS. NO separate mailbox password exists: it is a forwarding alias configured inside ClubDesk, commanded by a personal ClubDesk account login (kept in Vaultwarden, deliberately not here — this table is readable by every sport admin).',
  notes = CASE address
    WHEN 'kontakt@kscw.ch' THEN 'The address published on kscw.ch. Forwarding alias in ClubDesk with no member record and no mailbox login of its own — the code calls it exactly that in clubdesk-update.js and registration.js.'
    WHEN 'kscw@kscw.ch'    THEN 'Club address in the Impressum and privacy text. Forwarding alias in ClubDesk; never authenticated as anywhere in the codebase.'
    ELSE notes
  END
WHERE address IN ('kontakt@kscw.ch', 'kscw@kscw.ch');

COMMIT;

-- Verification (dev/prod):
--   SELECT address, broad_audience, left(reach_note, 60) FROM email_accounts
--    WHERE address IN ('kontakt@kscw.ch','kscw@kscw.ch');
--   -- → both broad_audience = true, reach_note explains there is no password
