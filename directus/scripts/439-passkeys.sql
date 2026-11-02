-- Migration 439: passkeys — sign in with the device's fingerprint, face or PIN
--
-- Owner, 02.11.2026: passkeys for Wiedisync (after svrz_rc and OpenVolley). The device keeps
-- the private key and checks the person; only the public key is stored here. Relying party
-- `kscw.ch` on prod (one key for the member app, Spielplanung, Accounting and later WiePlay),
-- `wiedisync-dev.kscw.ch` on dev. kscw-endpoints/src/passkeys.js owns every read and write.
--
-- Deliberately NOT a Directus collection: no directus_collections / directus_fields row, so
-- the items API, the admin UI, realtime and every policy stay blind to it — no permission rows
-- (setup-permissions.mjs is unchanged). The SQL workspace reader gets no grant either
-- (directus-db-role.sql deny_tables; revoked below for the window until that file runs again).
--
-- A password change or reset removes the account's passkeys (kscw-hooks `users.update`): if
-- someone stole the password and added a key, changing the password must lock them out.

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

COMMENT ON TABLE public.passkeys IS
  'Passkeys (WebAuthn) for signing in without the password. Written only by kscw-endpoints '
  'passkeys.js; not a Directus collection. Removed on any password change (kscw-hooks).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kscw_sql_reader') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.passkeys FROM kscw_sql_reader';
  END IF;
END $$;

COMMIT;
