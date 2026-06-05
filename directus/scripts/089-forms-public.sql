-- Migration 089: Public (external) forms — is_public + slug.
--
-- Adds:
--   * forms.is_public — when true AND status='open', the form is reachable on the
--     public website (kscw-website) by anonymous, non-member visitors. Submissions
--     arrive via the Turnstile-protected `POST /kscw/public/form-submit` endpoint
--     (server-side knex insert, member=NULL) — there is NO public Directus policy
--     on `forms`/`form_submissions` (mirrors registration.js / public-events.js).
--   * forms.slug — stable, URL-safe identifier for the public page
--     (/de/formular/<slug>). Unique when present.
--
-- Schema-only + idempotent, per CLAUDE.md.

BEGIN;

ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS slug text;

-- Unique slug (partial: NULL slugs are unconstrained — only public forms get one).
CREATE UNIQUE INDEX IF NOT EXISTS forms_slug_unique_idx ON forms (slug) WHERE slug IS NOT NULL;

COMMENT ON COLUMN forms.is_public IS
  'When true and status=open, the form is served on the public website via /kscw/public/forms/:slug and accepts anonymous submissions through the Turnstile-protected public endpoint.';
COMMENT ON COLUMN forms.slug IS
  'URL-safe public identifier (unique). Required when is_public; powers /de/formular/<slug> on kscw-website.';

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'is_public', 'cast-boolean', 'boolean', 13, 'half', 'Expose on the public website (anonymous submissions).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'is_public');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'forms', 'slug', NULL, 'input', 14, 'half', 'Public URL slug (unique). Required for public forms.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'forms' AND field = 'slug');

COMMIT;
