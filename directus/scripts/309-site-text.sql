-- 309-site-text.sql
-- Admin-editable page text for the kscw-website (/admin → Seitentexte).
--
-- Holds OVERRIDES ONLY. The website's own dictionaries
-- (kscw-website/public/js/i18n/{de,en}.json) stay the source of truth and the
-- original wording; a row here shadows one key in one or both languages, and
-- deleting the row restores the shipped text. A language left NULL is *not*
-- overridden — deliberately, so that improving an English default in the repo is
-- not silently shadowed by a copy of the old default that an admin never edited.
--
-- Internal config table, same posture as website_admin_access (063): NOT
-- registered in Directus (no directus_collections/directus_fields row), so there
-- is no /items/site_text REST surface and no public policy to grant. Reached only
-- through /kscw/site-text (public read) and /kscw/wadmin/site_text/text
-- (authenticated write) — see kscw-endpoints/src/site-text.js.

BEGIN;

CREATE TABLE IF NOT EXISTS site_text (
  key          varchar(120) PRIMARY KEY,
  de           text,
  en           text,
  date_updated timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES directus_users(id) ON DELETE SET NULL,

  -- The key is an i18n identifier from the website repo, and it is interpolated
  -- into a CSS attribute selector by the runtime overlay. Pin the shape here too,
  -- so the database cannot hold a key the browser would have to defend against.
  CONSTRAINT site_text_key_format CHECK (key ~ '^[A-Za-z][A-Za-z0-9_]*$'),

  -- A row that overrides nothing is the absence of a row. Keeping one would leave
  -- the key flagged as "changed" in the admin for a change that does not exist.
  CONSTRAINT site_text_not_empty CHECK (de IS NOT NULL OR en IS NOT NULL),

  -- Values are rendered as TEXT everywhere: textContent in the browser, Astro's
  -- auto-escaping at build time. The absence of any markup path is what makes an
  -- admin-editable dictionary safe (see kscw-website/tests/unit/no-i18n-html.test.ts),
  -- so refuse "<" in the database as well and not only in the endpoint — a future
  -- write path that forgets the check still cannot store a tag.
  CONSTRAINT site_text_de_no_markup CHECK (de IS NULL OR (de <> '' AND de NOT LIKE '%<%' AND length(de) <= 2000)),
  CONSTRAINT site_text_en_no_markup CHECK (en IS NULL OR (en <> '' AND en NOT LIKE '%<%' AND length(en) <= 2000))
);

COMMENT ON TABLE site_text IS
  'kscw-website page-text overrides, keyed by i18n key. Internal — not a Directus collection; reachable only via /kscw/site-text and /kscw/wadmin/site_text.';
COMMENT ON COLUMN site_text.key IS
  'i18n key as used in kscw-website/public/js/i18n/{de,en}.json.';
COMMENT ON COLUMN site_text.de IS
  'German override. NULL = not overridden, the repo dictionary value is used.';
COMMENT ON COLUMN site_text.en IS
  'English override. NULL = not overridden, the repo dictionary value is used.';

COMMIT;
