-- Migration 212: end-to-end-encrypted identity documents.
--
-- A member uploads a photo of their ID in their profile. The coaches and team
-- responsibles of their teams can show it to a referee in the 45 minutes before a game.
-- NOBODY ELSE CAN READ IT — not the server, not a Directus admin, not the person running
-- the VPS. That is the whole point, and it is what makes this table shaped the way it is.
--
-- THIS IS NOT "ENCRYPTED AT REST"
-- ------------------------------
-- Encryption-at-rest (a key in .env, the server decrypting on demand) protects against
-- someone stealing the disk. It does NOT protect against someone who owns the running
-- server, because the server must hold the key in order to serve the file — and neither
-- does it keep the club's own admins out. So the key never comes near us:
--
--   * The file is encrypted IN THE MEMBER'S BROWSER, with a random per-document content
--     key (AES-256-GCM). We only ever receive ciphertext.
--   * That content key is WRAPPED (ECDH P-256 → HKDF → AES-GCM) once per person allowed
--     to read it: the member, and each coach/TR of their teams. One row per recipient in
--     identity_document_keys.
--   * We store the wrapped keys but hold no private key that can open them. A rooted VPS
--     yields ciphertext and a pile of locked envelopes.
--
-- The member's private key is itself encrypted under a key derived from their LOGIN
-- PASSWORD (PBKDF2-SHA256, 600k iterations). We store that blob so a new device can
-- bootstrap; we cannot open it. The device keeps the unwrapped key in IndexedDB, because
-- the password is only ever in memory during the login call — a page reload has no access
-- to it (AuthProvider restores the session from an httpOnly cookie).
--
-- CONSEQUENCE, ACCEPTED DELIBERATELY: a lost password = a lost key = an unreadable
-- document. There is no escrow and no recovery code. The member simply uploads their ID
-- again — they still have the card in their wallet. This is the one kind of secret where
-- "just re-create it" is a real answer, which is why E2EE is affordable here at all.
--
-- ⚠ NOT ONE of the four existing password paths can preserve a key: /set-password modes
-- 1/2/3 and the Directus admin reset never hold the OLD plaintext, so any of them orphans
-- it. `POST /kscw/change-password` (change-password.js, no schema) is the containment — it
-- verifies the CURRENT password, so the browser holds both plaintexts and re-wraps the key
-- in the same request. A genuine forgot-password reset still loses it; nobody can re-wrap
-- with a secret nobody has.
--
-- Schema-only + idempotent, per the migration policy.

BEGIN;

-- ── Per-member key material ──────────────────────────────────────────────────
-- public_key is PUBLIC by design (others wrap TO it). private_key is ciphertext we
-- cannot open. salt is the PBKDF2 salt. None of this is a secret we hold.

ALTER TABLE members ADD COLUMN IF NOT EXISTS e2ee_public_key  text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS e2ee_private_key text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS e2ee_kdf_salt    text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS e2ee_key_created timestamptz;

COMMENT ON COLUMN members.e2ee_public_key IS
  'ECDH P-256 public key (SPKI, base64). Public by design — others wrap content keys to it.';
COMMENT ON COLUMN members.e2ee_private_key IS
  'The member''s private key, encrypted under PBKDF2(login password). We CANNOT open this. '
  'Stored only so a new device can bootstrap with one password prompt.';
COMMENT ON COLUMN members.e2ee_kdf_salt IS
  'PBKDF2 salt (base64) for the private-key wrapper. Not a secret.';
COMMENT ON COLUMN members.e2ee_key_created IS
  'When the current keypair was created. A new keypair orphans every document wrapped to '
  'the old one — that is why a password reset means "re-upload your ID".';

-- ── The document ─────────────────────────────────────────────────────────────
-- One per member. `file` points at the CIPHERTEXT in directus_files; the plaintext never
-- existed on our side. `iv` is the AES-GCM nonce (public, not a secret).

CREATE TABLE IF NOT EXISTS identity_documents (
  id           serial PRIMARY KEY,
  member       integer NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  file         uuid NOT NULL REFERENCES directus_files(id) ON DELETE CASCADE,

  iv           text NOT NULL,          -- AES-GCM nonce, base64. Public.
  mime         varchar(64),            -- the PLAINTEXT's type, so the viewer can render it
  size         integer,                -- plaintext byte length, for the UI

  -- Who encrypted it. A member normally uploads their own; an admin MAY upload on their
  -- behalf (e.g. migrating the scan already held in registrations.id_upload_front), because
  -- wrapping only needs the member's PUBLIC key. The uploader is never made a recipient, so
  -- an admin who does this locks themselves out of the result by construction — they saw the
  -- plaintext in their hands at that moment, but they cannot open the stored copy afterwards.
  -- Requires the member to already HAVE a keypair (i.e. to have logged in at least once).
  uploaded_by      integer REFERENCES members(id) ON DELETE SET NULL,
  uploaded_by_self boolean NOT NULL DEFAULT true,

  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity_documents IS
  'A member''s identity document, encrypted in the uploader''s browser. We hold ciphertext '
  'and no key. Normally self-uploaded; an admin may upload on a member''s behalf and is '
  'deliberately NOT given a wrapped key for it.';
COMMENT ON COLUMN identity_documents.uploaded_by_self IS
  'false = an admin uploaded it for this member. They are not a recipient and cannot read it back.';
COMMENT ON COLUMN identity_documents.file IS
  'directus_files row holding the CIPHERTEXT. Lives in the private identity folder; served '
  'only through /kscw/identity/*, never via /assets.';

-- ── The envelopes ────────────────────────────────────────────────────────────
-- The content key, wrapped once per person allowed to read the document. Deleting a row
-- revokes future access (it does NOT un-download what someone already decrypted — no
-- design can, once a human has looked at it).

CREATE TABLE IF NOT EXISTS identity_document_keys (
  id            serial PRIMARY KEY,
  document      integer NOT NULL REFERENCES identity_documents(id) ON DELETE CASCADE,
  recipient     integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,

  -- ECDH ephemeral-static: the sender made a throwaway keypair, did ECDH against the
  -- recipient's public key, and AES-GCM-wrapped the content key with the derived secret.
  eph_public_key text NOT NULL,        -- ephemeral SPKI, base64
  wrap_iv        text NOT NULL,        -- AES-GCM nonce for the wrap, base64
  wrapped_key    text NOT NULL,        -- the content key, encrypted. Opaque to us.

  -- Which of the recipient's keypairs this was wrapped to. If they re-key (password
  -- reset), rows carrying the old fingerprint are dead and must be re-wrapped by the
  -- OWNER's device — the server cannot do it, having no key.
  recipient_key_created timestamptz,

  date_created  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document, recipient)
);

COMMENT ON TABLE identity_document_keys IS
  'The per-document content key, wrapped to each authorised reader (the member + the '
  'coaches/TRs of their teams). We store these but hold no key that opens them.';
COMMENT ON COLUMN identity_document_keys.recipient_key_created IS
  'The recipient''s e2ee_key_created at wrap time. If it no longer matches, the recipient '
  'has re-keyed and this envelope is dead — the owner must re-wrap.';

CREATE INDEX IF NOT EXISTS idx_identity_document_keys_recipient
  ON identity_document_keys (recipient);

-- ── Private folder for the ciphertext ────────────────────────────────────────
-- Fixed UUID so setup-permissions.mjs can name it. NOTE: the Member file-read filter is a
-- DENY-list (`folder NOT IN (...)`), so a new folder is readable by every member unless it
-- is added there. The bytes are ciphertext, but a permissions hole is not something to
-- leave standing because the crypto happens to cover it — setup-permissions.mjs excludes
-- this folder in the same commit.

INSERT INTO directus_folders (id, name, parent)
SELECT 'd0c00001-0000-4000-8000-000000000001', 'Identity documents (encrypted)', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM directus_folders WHERE id = 'd0c00001-0000-4000-8000-000000000001'
);

-- ── Directus registration ────────────────────────────────────────────────────

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', v.field, 'input', true, true, v.sort, 'half', v.note
FROM (VALUES
  ('e2ee_public_key',  300, 'ECDH public key. Public by design.'),
  ('e2ee_private_key', 301, 'Private key, encrypted under the member''s password. NOT readable by anyone here.'),
  ('e2ee_kdf_salt',    302, 'PBKDF2 salt. Not a secret.'),
  ('e2ee_key_created', 303, 'When the current keypair was created.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'members' AND df.field = v.field
);

INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'identity_documents', 'badge',
       'Encrypted identity documents. Ciphertext only — the club cannot read these.', false, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'identity_documents');

INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'identity_document_keys', 'key',
       'Per-recipient wrapped content keys. Opaque — no key here opens them.', false, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'identity_document_keys');

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT v.mc, v.mf, v.oc
FROM (VALUES
  ('identity_documents',     'member',    'members'),
  ('identity_documents',     'file',      'directus_files'),
  ('identity_document_keys', 'document',  'identity_documents'),
  ('identity_document_keys', 'recipient', 'members')
) AS v(mc, mf, oc)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations r
  WHERE r.many_collection = v.mc AND r.many_field = v.mf
);

COMMIT;
