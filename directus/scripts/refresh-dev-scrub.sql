-- refresh-dev-scrub.sql — the ONE scrub both dev-refresh scripts run on the
-- freshly cloned dev database (audit 2026-09-28, F13 + F14).
--
-- NOT a migration: no NNN- prefix, so apply-migrations.mjs never picks it up.
-- It only ever runs against directus_kscw_dev, right after the prod clone.
--
-- Consumers (both must run THIS file, never a private copy — the two scripts
-- drifted before, see the unaccent note in refresh-dev-daily.sh):
--   • refresh-dev-daily.sh     — reads it from its own directory on the VPS
--   • refresh-dev-from-prod.sh — ships it to the VPS base64-encoded
--
-- psql variable (required — an unset variable aborts the file under
-- ON_ERROR_STOP, i.e. the refresh fails CLOSED):
--   scrub_pii = 1   credentials + PII   (always, for the nightly cron)
--   scrub_pii = 0   credentials only    (refresh-dev-from-prod.sh --no-scrub)
--
-- Credentials are scrubbed unconditionally: `--no-scrub` means "keep real PII
-- for a debugging session", never "hand dev prod's root tokens".
--
-- Design: DENY what dev does not need, keep SHAPE where a dev feature compares
-- two tables. Values that are cross-checked between tables (ClubDesk export vs
-- members, VM check vs members, match-sheet DoB vs members) are mapped with a
-- deterministic function keyed on a per-run random salt, so equal stays equal
-- and the ClubDesk / season-health diffs on dev do not light up — but the salt
-- is never stored, so the fake value cannot be inverted back to the real one.
--
-- Deliberately NOT touched here (so nobody "fixes" them into a nightly abort):
--   • plz / ort / billing_plz / billing_ort — postcode + town only, and hall /
--     finance views group on them.
--   • members.e2ee_* + identity_documents — wrapped key material. Nulling it
--     half-way breaks every dev E2EE flow; the document CIPHERTEXT lives in
--     directus_files storage, which the refresh never copies.
--   • scheduling_emails — the scheduling mailbox archive (opponent clubs).
--   • *_by_email actor columns — staff addresses, not send targets.
--   • directus_activity.ip / user_agent — 850k rows; rewriting them nightly is
--     not worth it for dev.
--   • form_submissions answers — free-form per form; no fixed PII keys to strip.
--
-- ⚠⚠ The scrub holds only until the next import of REAL data into dev.
-- ClubDesk imports are covered: with a dev target, import-clubdesk-csv.mjs and
-- import-clubdesk-finance.mjs run every row through import-clubdesk-dev-scrub.mjs
-- (the SAME transforms as the clubdesk_export / finance blocks below, with its
-- own per-run salt) before anything reaches the database — so a dev "Sync now",
-- `db:clubdesk:sync:dev` or `db:finance:sync:dev` no longer re-imports real
-- AHV / IBAN / phones / streets / DoBs / recipient emails (audit 2026-09-28,
-- F14). ⚠ If you add a column to the clubdesk_export block, add it to
-- CLUBDESK_EXPORT_SCRUB in that module too — refresh-dev-scrub.test.mjs fails
-- until both agree. NOT covered: the dev VM / Basketplan checks
-- (sv_vm_check.birthday/email, basketplan_people.birthdate) still write live
-- values until the next 03:00 run.

-- Normalise scrub_pii through SQL. psql's own `\if` does NOT honour
-- ON_ERROR_STOP on a bad or unset value — it warns, treats it as false and
-- carries on (verified on psql 16), which would silently skip the PII block.
-- An unset variable leaves the literal `:'scrub_pii'` here → syntax error →
-- abort; a non-boolean value fails the cast → abort.
SELECT (:'scrub_pii')::boolean AS scrub_pii \gset

BEGIN;

-- Per-run salt. Local to this transaction and never written anywhere.
SELECT set_config('kscw.scrub_salt', gen_random_uuid()::text || clock_timestamp()::text, true) \g /dev/null

-- 32-bit non-negative hash of a value under the run salt.
CREATE FUNCTION pg_temp.kscw_h(v text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT ('x' || substr(md5(current_setting('kscw.scrub_salt') || v), 1, 8))::bit(32)::bigint
$$;

-- Birthdate shift. Keeps the birth YEAR (junior categories and age brackets are
-- by year) and keeps which side of today's month/day the birthday falls on, so
-- "has had their birthday this year" — and therefore today's age, minor vs
-- adult included — is unchanged. Same input date → same output date within a
-- run, so a member's DoB still matches their ClubDesk / VM / roster row.
CREATE FUNCTION pg_temp.kscw_shift_date(d date) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE
  y     int;
  m     int  := extract(month FROM current_date)::int;
  dd    int  := extract(day   FROM current_date)::int;
  jan1  date;
  dec31 date;
  cut   date;
  lo    date;
  hi    date;
BEGIN
  IF d IS NULL THEN RETURN NULL; END IF;
  y     := extract(year FROM d)::int;
  jan1  := make_date(y, 1, 1);
  dec31 := make_date(y, 12, 31);
  -- Today's month/day transplanted into year y (29.02. → 28.02. in a common year).
  cut := make_date(y, m, LEAST(dd, extract(day FROM (make_date(y, m, 1) + interval '1 month - 1 day'))::int));
  IF d <= cut THEN lo := jan1;    hi := cut;
  ELSE             lo := cut + 1; hi := dec31;
  END IF;
  RETURN lo + (pg_temp.kscw_h(d::text) % (hi - lo + 1))::int;
END $$;

-- clubdesk_export stores DoB as text 'dd.mm.yyyy'. Anything unparseable → NULL
-- (never abort the whole scrub on one malformed register cell).
CREATE FUNCTION pg_temp.kscw_shift_ddmmyyyy(t text) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF t IS NULL OR t !~ '^\d{2}\.\d{2}\.\d{4}$' THEN RETURN NULL; END IF;
  RETURN to_char(pg_temp.kscw_shift_date(to_date(t, 'DD.MM.YYYY')), 'DD.MM.YYYY');
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- Street line → 'Teststrasse N'. Deterministic under the salt so members.adresse
-- still equals clubdesk_export.adresse where it did before.
CREATE FUNCTION pg_temp.kscw_street(v text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN v IS NULL OR btrim(v) = '' THEN v
              ELSE 'Teststrasse ' || (pg_temp.kscw_h(lower(btrim(v))) % 200 + 1) END
$$;

-- Every IBAN becomes SIX's published example IBAN (valid checksum), so QR-bill,
-- payout and "IBAN on file" flows stay testable on dev.
CREATE FUNCTION pg_temp.kscw_iban(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL OR btrim(v) = '' THEN v ELSE 'CH9300762011623852957' END
$$;

-- Keys stripped from JSON history (revisions, user_logs, push diffs).
CREATE FUNCTION pg_temp.kscw_pii_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'ahv_nummer','iban','billing_iban','pay_to_iban',
    'adresse','adress_zusatz','billing_address','recipient_address','payee_address','kontoinhaber',
    'phone','billing_phone','contact_phone','telefon_mobil','telefon_privat','telefon_geschaeft',
    'birthdate','geburtsdatum','birthday',
    'email','vm_email','billing_email','email_alternativ','recipient_email',
    'password','token','tfa_secret','auth_data','ical_token'
  ]
$$;

CREATE FUNCTION pg_temp.kscw_strip(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN j IS NULL OR jsonb_typeof(j) <> 'object' THEN j
    -- {field:'ahv_nummer', value:'756…'} shaped entries (ClubDesk proposals).
    WHEN j->>'field' = ANY (pg_temp.kscw_pii_keys())
      THEN (j - pg_temp.kscw_pii_keys()) - ARRAY['value','proposed_value','current_value','old','new','from','to']
    ELSE j - pg_temp.kscw_pii_keys()
  END
$$;

-- ── Credentials (ALWAYS) ─────────────────────────────────────────────────────
-- ⚠⚠ The clone carries prod's directus_users verbatim: static API tokens
-- (Administrator + Superuser among them), argon2 password hashes and TOTP
-- seeds. On dev every one of them is a PROD credential. Null them all here;
-- the refresh then re-pins the tokens/passwords DEV had before the clone (its
-- own test tokens), and a final prod-equality guard nulls any re-pinned token
-- that is still identical to prod, and any re-pinned password hash too — except
-- on the allowlisted dev logins, whose password is kept so the operator is not
-- locked out of dev admin (accepted residual; see refresh-dev-daily.sh [1b/7]).
-- Household shadow logins already have password NULL (migration 377's
-- is_managed_shadow_row), so the revoke trigger cannot fire from this.
UPDATE directus_users
   SET token      = NULL,
       password   = NULL,
       tfa_secret = NULL,
       auth_data  = NULL
 WHERE token IS NOT NULL OR password IS NOT NULL OR tfa_secret IS NOT NULL OR auth_data IS NOT NULL;

-- Bearer-style link tokens that are valid against PROD endpoints.
UPDATE members                      SET ical_token = md5(gen_random_uuid()::text) WHERE ical_token IS NOT NULL;
UPDATE game_scheduling_opponents    SET token      = md5(gen_random_uuid()::text) WHERE token IS NOT NULL;
UPDATE game_scheduling_club_portals SET token      = md5(gen_random_uuid()::text) WHERE token IS NOT NULL;
-- Unsubscribe / double-opt-in links (newsletter.js looks them up on prod) and
-- unlisted event share links (public-event-signup.js — reads the event AND
-- accepts signups). md5 = 32 hex chars, inside events_public_share_token_format.
UPDATE newsletter_subscribers       SET verify_token      = md5(gen_random_uuid()::text) WHERE verify_token IS NOT NULL;
UPDATE newsletter_subscribers       SET unsubscribe_token = md5(gen_random_uuid()::text) WHERE unsubscribe_token IS NOT NULL;
UPDATE events                       SET public_share_token = md5(gen_random_uuid()::text) WHERE public_share_token IS NOT NULL;
UPDATE team_invites                 SET token      = md5(gen_random_uuid()::text) WHERE token IS NOT NULL;
-- Hashed at rest already, but a pending reset for a prod account has no
-- business on dev.
DELETE FROM password_reset_tokens;

-- Third-party API keys stored in Directus settings (AI assistants, Mapbox).
-- Whatever prod holds is prod's bill; dev runs without them.
UPDATE directus_settings SET
  ai_openai_api_key            = NULL,
  ai_anthropic_api_key         = NULL,
  ai_google_api_key            = NULL,
  ai_openai_compatible_api_key = NULL,
  mapbox_key                   = NULL;

-- Mailbox credentials (Emails Garage, migration 326).
-- ⚠⚠ The INVENTORY is useful on dev; the CIPHERTEXT is not. Without this, a
-- clone hands dev every club mailbox password, and the only thing standing
-- between dev and plaintext is EMAIL_VAULT_KEY differing between the two
-- containers — a one-line env mistake away from being the same key. Null the
-- column instead so the question cannot arise: dev's page lists the accounts
-- and honestly reports "no password stored".
UPDATE email_accounts SET password_enc = NULL WHERE password_enc IS NOT NULL;

-- Devices / transient state
TRUNCATE push_subscriptions;
DELETE FROM email_verifications;
DELETE FROM directus_sessions;

\if :scrub_pii

-- ── Members (real player PII) ───────────────────────────────────────────────
UPDATE members SET email    = 'member_' || id || '@devsink.invalid' WHERE email IS NOT NULL AND email <> '';
UPDATE members SET vm_email = NULL WHERE vm_email IS NOT NULL;
UPDATE members SET phone    = NULL WHERE phone IS NOT NULL;
-- One statement for the rest: trg_pv_members refreshes participation
-- visibility once per statement.
UPDATE members SET
  ahv_nummer            = NULL,
  iban                  = pg_temp.kscw_iban(iban),
  billing_iban          = pg_temp.kscw_iban(billing_iban),
  adresse               = pg_temp.kscw_street(adresse),
  billing_address       = pg_temp.kscw_street(billing_address),
  billing_email         = CASE WHEN billing_email IS NOT NULL AND billing_email <> '' THEN 'billing_' || id || '@devsink.invalid' ELSE billing_email END,
  billing_phone         = NULL,
  birthdate             = pg_temp.kscw_shift_date(birthdate),
  clubdesk_push_changes = pg_temp.kscw_strip(clubdesk_push_changes)
 WHERE ahv_nummer IS NOT NULL OR iban IS NOT NULL OR billing_iban IS NOT NULL
    OR adresse IS NOT NULL OR billing_address IS NOT NULL OR billing_email IS NOT NULL
    OR billing_phone IS NOT NULL OR birthdate IS NOT NULL OR clubdesk_push_changes IS NOT NULL;

-- ── Directus login accounts (keep admin/dev logins on the allowlist) ────────
UPDATE directus_users
   SET email = 'user_' || id || '@devsink.invalid'
 WHERE email IS NOT NULL
   -- Household shadow logins (synthetic, no PII): scrubbing them would
   -- fire migration 377's revoke trigger and unlink every household on dev.
   AND lower(email) NOT LIKE '%@managed.wiedisync.kscw.ch'
   AND lower(email) NOT IN (
     'admin@kscw.ch','aniish.k@hotmail.com','anja_jimenez@hotmail.com',
     'cron-service@kscw.ch','luca.canepa@gmail.com','thamayanth.kanagalingam@uzh.ch'
   );

-- ── ClubDesk register mirror ────────────────────────────────────────────────
-- {basketball,people,volleyball} are VIEWS over clubdesk_export — scrub the base only.
UPDATE clubdesk_export SET
  email             = CASE WHEN email IS NOT NULL AND email<>'' THEN 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid' ELSE email END,
  email_alternativ  = CASE WHEN email_alternativ IS NOT NULL AND email_alternativ<>'' THEN 'scrub_'||substr(md5(email_alternativ),1,16)||'@devsink.invalid' ELSE email_alternativ END,
  ahv_nummer        = NULL,
  iban              = pg_temp.kscw_iban(iban),
  kontoinhaber      = NULL,
  adresse           = pg_temp.kscw_street(adresse),
  adress_zusatz     = NULL,
  telefon_geschaeft = NULL,
  telefon_mobil     = NULL,
  telefon_privat    = NULL,
  fax               = NULL,
  bic               = NULL,
  bemerkungen       = NULL,
  geburtsdatum      = pg_temp.kscw_shift_ddmmyyyy(geburtsdatum);

-- Push/pull state holds whole register rows as CSV text.
UPDATE clubdesk_member_sync SET up_csv = NULL, up_csv_create = NULL
 WHERE up_csv IS NOT NULL OR up_csv_create IS NOT NULL;
UPDATE clubdesk_sync_proposals SET current_value = NULL, proposed_value = NULL
 WHERE field = ANY (pg_temp.kscw_pii_keys()) AND (current_value IS NOT NULL OR proposed_value IS NOT NULL);
UPDATE clubdesk_sync_proposals SET payload = pg_temp.kscw_strip(payload) WHERE payload IS NOT NULL;

-- ── Registrations ───────────────────────────────────────────────────────────
UPDATE registrations SET
  email         = CASE WHEN email IS NOT NULL AND email<>'' THEN 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid' ELSE email END,
  ahv_nummer    = NULL,
  iban          = pg_temp.kscw_iban(iban),
  adresse       = pg_temp.kscw_street(adresse),
  telefon_mobil = NULL,
  bemerkungen   = NULL,
  geburtsdatum  = pg_temp.kscw_shift_date(geburtsdatum);

-- ── Other copies of a date of birth (kept consistent with members) ──────────
UPDATE sv_vm_check           SET birthday  = pg_temp.kscw_shift_date(birthday)  WHERE birthday  IS NOT NULL;
UPDATE basketplan_people     SET birthdate = pg_temp.kscw_shift_date(birthdate) WHERE birthdate IS NOT NULL;
UPDATE game_rosters          SET birthdate = pg_temp.kscw_shift_date(birthdate) WHERE birthdate IS NOT NULL;
UPDATE game_roster_officials SET birthdate = pg_temp.kscw_shift_date(birthdate) WHERE birthdate IS NOT NULL;

-- ── Finance: bank details + real send targets ──────────────────────────────
-- ⚠ recipient_email is a SEND target: without this a dev "send invoice" mails
-- a real member.
UPDATE finance_payouts          SET iban = pg_temp.kscw_iban(iban), payee_address = pg_temp.kscw_street(payee_address)
 WHERE iban IS NOT NULL OR payee_address IS NOT NULL;
UPDATE finance_expenses         SET pay_to_iban = pg_temp.kscw_iban(pay_to_iban) WHERE pay_to_iban IS NOT NULL;
UPDATE finance_billing_contacts SET
  billing_iban = pg_temp.kscw_iban(billing_iban),
  address      = pg_temp.kscw_street(address),
  email        = CASE WHEN email IS NOT NULL AND email<>'' THEN 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid' ELSE email END;
UPDATE finance_invoices         SET
  recipient_email   = CASE WHEN recipient_email IS NOT NULL AND recipient_email<>'' THEN 'scrub_'||substr(md5(recipient_email),1,16)||'@devsink.invalid' ELSE recipient_email END,
  recipient_address = pg_temp.kscw_street(recipient_address)
 WHERE recipient_email IS NOT NULL OR recipient_address IS NOT NULL;
UPDATE finance_dunning_notices  SET recipient_email = 'scrub_'||substr(md5(recipient_email),1,16)||'@devsink.invalid' WHERE recipient_email IS NOT NULL AND recipient_email<>'';

-- ── Other contact tables ────────────────────────────────────────────────────
UPDATE event_public_signups      SET email         = CASE WHEN email IS NOT NULL AND email<>'' THEN 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid' ELSE email END,
                                     phone         = NULL;
UPDATE event_signups             SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE email_sends               SET to_email      = 'scrub_'||substr(md5(to_email),1,16)||'@devsink.invalid'      WHERE to_email IS NOT NULL AND to_email<>'';
UPDATE feedback                  SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE game_scheduling_opponents SET contact_email = 'scrub_'||substr(md5(contact_email),1,16)||'@devsink.invalid' WHERE contact_email IS NOT NULL AND contact_email<>'';
UPDATE newsletter_subscribers    SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE sv_vm_check               SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE svrz_spielplaner_contacts SET contact_email = CASE WHEN contact_email IS NOT NULL AND contact_email<>'' THEN 'scrub_'||substr(md5(contact_email),1,16)||'@devsink.invalid' ELSE contact_email END,
                                     contact_phone = NULL;
UPDATE vm_vb_spielplan_contact   SET "Email"       = 'scrub_'||substr(md5("Email"),1,16)||'@devsink.invalid'       WHERE "Email" IS NOT NULL AND "Email"<>'';

-- ── History: the same PII sits in every past write ──────────────────────────
-- Directus revisions snapshot whole items; user_logs carries the payloads of
-- custom-endpoint writes (a members row logs iban/ahv_nummer/adresse/birthdate
-- at top level). Strip those keys, keep the rest so dev's audit pages work.
UPDATE directus_revisions SET
  data  = pg_temp.kscw_strip(data::jsonb)::json,
  delta = pg_temp.kscw_strip(delta::jsonb)::json
 WHERE (data  IS NOT NULL AND jsonb_typeof(data::jsonb)  = 'object' AND data::jsonb  ?| pg_temp.kscw_pii_keys())
    OR (delta IS NOT NULL AND jsonb_typeof(delta::jsonb) = 'object' AND delta::jsonb ?| pg_temp.kscw_pii_keys());
UPDATE user_logs SET data = pg_temp.kscw_strip(data::jsonb)::json
 WHERE data IS NOT NULL AND jsonb_typeof(data::jsonb) = 'object'
   AND (data::jsonb ?| pg_temp.kscw_pii_keys() OR data::jsonb->>'field' = ANY (pg_temp.kscw_pii_keys()));

\endif

COMMIT;
