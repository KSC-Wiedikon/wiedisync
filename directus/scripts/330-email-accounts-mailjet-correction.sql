-- Migration 330: correct migration 329 — a Vaultwarden entry for kontakt@ DOES exist
--
-- 329 recorded that `kontakt@kscw.ch` and `kscw@kscw.ch` are ClubDesk forwarding
-- aliases with no mailbox password. That conclusion is right and stands. One of
-- the four supporting facts it listed is wrong:
--
--   329 said:  "No Vaultwarden entry exists for either address."
--   Actually:  `services/mailjet / Mailjet - SMTP password`, username
--              `kontakt@kscw.ch`.
--
-- Left uncorrected, the next person to open the vault finds that entry, decides
-- the note is stale, and re-opens a question that has already been answered — or
-- worse, concludes a working sending credential for kontakt@ exists and uses it.
--
-- It does not work, and that is checkable rather than assumed:
--   • kscw.ch publishes `v=spf1 redirect=_spf.clubdesk.com`
--   • which resolves to `v=spf1 a:gate1.clubdesk.com a:gate2.clubdesk.com -all`
--   • Mailjet is not in it, and the record ends in `-all` — a HARD fail, not a
--     soft one, so a Mailjet send as kontakt@kscw.ch is rejected at the
--     receiver, not merely marked.
--   • `mailjet` appears nowhere in the codebase: nothing here uses it.
--
-- So it is a legacy third-party SENDING credential, not a mailbox login, and it
-- is inert. Recorded rather than deleted — the fact that it exists and does not
-- work is more useful than silence, which is what sent this migration's
-- predecessor down the wrong path.
--
-- ⚠ Written as a NEW migration rather than an edit to 329, which is already
-- applied on dev AND prod: the runner sha-locks applied files and refuses a
-- changed one (it caught exactly this). Fix forward, never edit.
--
-- ⚠ The Mailjet password itself stays in Vaultwarden and out of this table —
-- same reasoning 329 gave for the ClubDesk account login: `email_accounts` is
-- readable by every sport admin for `sport = 'club'` rows, and there is no
-- global-admin-only visibility tier.
--
-- Data-only, idempotent: appends the correction only if it is not already there,
-- so a re-run cannot duplicate the sentence.

BEGIN;

UPDATE email_accounts
   SET reach_note = reach_note || ' ⚠ A legacy Vaultwarden entry "Mailjet - SMTP password" is filed under '
                    || 'kontakt@kscw.ch: a third-party SENDING credential, not a mailbox login, and inert — '
                    || 'the SPF chain resolves to "a:gate1.clubdesk.com a:gate2.clubdesk.com -all", which '
                    || 'excludes Mailjet, so a send as this address hard-fails at the receiver.'
 WHERE address IN ('kontakt@kscw.ch', 'kscw@kscw.ch')
   AND reach_note IS NOT NULL
   AND reach_note NOT LIKE '%Mailjet%';

COMMIT;

-- Verification (dev/prod):
--   SELECT address, reach_note LIKE '%Mailjet%' AS corrected FROM email_accounts
--    WHERE address IN ('kontakt@kscw.ch','kscw@kscw.ch');   -- → both true
--   -- Re-run this migration and the occurrence count must NOT grow. It is 2, not
--   -- 1: the appended sentence names Mailjet twice (the vault entry, then the
--   -- SPF exclusion). Counting occurrences is the real idempotence check here,
--   -- because the guard is a NOT LIKE on the very word being appended.
--   SELECT address, (length(reach_note)-length(replace(reach_note,'Mailjet','')))/length('Mailjet') AS mentions
--     FROM email_accounts WHERE address IN ('kontakt@kscw.ch','kscw@kscw.ch');  -- → 2 each, stable
