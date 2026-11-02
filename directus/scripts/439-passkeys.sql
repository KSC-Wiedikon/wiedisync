-- Migration 439: passkeys — sign in with the device's fingerprint, face or PIN
--
-- Owner, 02.11.2026: passkeys for Wiedisync (after svrz_rc and OpenVolley). The device keeps
-- the private key and checks the person; only the public key is stored here. Relying party
-- `kscw.ch` on prod (one key for the member app, Spielplanung, Accounting and later WiePlay),
-- `wiedisync-dev.kscw.ch` on dev. kscw-endpoints/src/passkeys.js owns every read and write.
--
-- Deliberately NOT a Directus collection: no directus_collections / directus_fields row and no
-- permission rows (setup-permissions.mjs is unchanged), so no non-admin policy can reach it —
-- Directus still lists unconfigured tables to an admin, who can already reset any password.
-- The SQL workspace reader gets no grant either (directus-db-role.sql deny_tables; revoked
-- below for the window until that file runs again).
--
-- A password change or reset removes the account's passkeys: if someone stole the password and
-- added a key, changing the password must lock them out. A trigger, not a hook (security review
-- 02.11.2026): Directus fires item actions after the commit without awaiting them, so a hook
-- could lose the delete (restart, DB error) or race a passkey sign-in, and raw-SQL password
-- writes skip hooks entirely. Here the keys go in the same transaction as the password.

BEGIN;

CREATE TABLE IF NOT EXISTS passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user"        uuid NOT NULL REFERENCES directus_users (id) ON DELETE CASCADE,
  -- base64url, as the browser reports it. Postgres caps a regex repetition at 255, so the
  -- length is its own check.
  credential_id text NOT NULL,
  -- COSE public key, base64url.
  public_key    text NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[] NOT NULL DEFAULT '{}',
  backed_up     boolean NOT NULL DEFAULT false,
  -- "iPhone · Safari": what the member sees in Profile → Passkeys and in the mail.
  label         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  CONSTRAINT passkeys_credential_id_unique UNIQUE (credential_id),
  CONSTRAINT passkeys_credential_id_format CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) <= 1024),
  CONSTRAINT passkeys_public_key_format CHECK (public_key ~ '^[A-Za-z0-9_-]+$' AND length(public_key) <= 4096),
  CONSTRAINT passkeys_counter_nonnegative CHECK (counter >= 0),
  CONSTRAINT passkeys_label_length CHECK (length(label) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys ("user");

CREATE OR REPLACE FUNCTION trg_directus_users_password_passkeys()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM passkeys WHERE "user" = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_directus_users_password_passkeys ON directus_users;
CREATE TRIGGER trg_directus_users_password_passkeys
  AFTER UPDATE OF password ON directus_users
  FOR EACH ROW WHEN (OLD.password IS DISTINCT FROM NEW.password)
  EXECUTE FUNCTION trg_directus_users_password_passkeys();

COMMENT ON TABLE public.passkeys IS
  'Passkeys (WebAuthn) for signing in without the password. Written only by kscw-endpoints '
  'passkeys.js; not a Directus collection. Removed on any password change '
  '(trg_directus_users_password_passkeys).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.passkeys FROM kscw_sql_reader';
  END IF;
END $$;

COMMIT;
