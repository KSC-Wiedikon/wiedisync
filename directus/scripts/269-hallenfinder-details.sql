-- Migration 269: Hallenfinder — hall dimensions, photo and rental contact.
--
-- The Hallenfinder (migration 242) tells a coach WHEN a City of Zürich hall is
-- free but nothing about whether it is usable: a volleyball court needs 18 x 9 m
-- plus a free zone, and the city's stock ranges from 14 x 6.5 m Gymnastikräume
-- to 28 x 16 m Dreifachhallen with ceilings between 2.7 m and 7.3 m. Every hall
-- detail page (details.php?einrichtung=<id>) already publishes the exact
-- Gesamtfläche as "L x B x H", the per-partition sizes for multi-court
-- facilities, a photo for roughly a third of them, and the rental contact
-- address — all scraped by hallenfinder-details.mjs.
--
-- Columns are all nullable: the details pass runs monthly and independently of
-- the nightly availability scrape, so a hall discovered tonight simply has no
-- dimensions until the next details run.
--
-- ⚠ hall_type stays as it is. It is derived from the hall NAME by
-- hallenfinder-scrape.mjs and is what the UI's type filter matches on
-- ('sporthalle' | 'gymnastikraum' | 'dreifachhalle' | 'doppelhalle'). The
-- detail page's authoritative Hallentyp uses a different vocabulary
-- ('Einfachhalle' where the derived value says 'sporthalle'), so it lands in its
-- own hall_type_label column instead of silently breaking the filter.
--
-- Like 242 these tables stay PRIVATE — read only through
-- /kscw/hallenfinder/search, no Directus collection registration, no entry in
-- setup-permissions.mjs.
--
-- Schema-only + idempotent.

ALTER TABLE city_halls
  ADD COLUMN IF NOT EXISTS hall_type_label     text,
  ADD COLUMN IF NOT EXISTS size_label          text,
  ADD COLUMN IF NOT EXISTS length_m            numeric(6,2),
  ADD COLUMN IF NOT EXISTS width_m             numeric(6,2),
  ADD COLUMN IF NOT EXISTS height_m            numeric(6,2),
  ADD COLUMN IF NOT EXISTS partitions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS photo_url           text,
  ADD COLUMN IF NOT EXISTS photo_thumb_url     text,
  ADD COLUMN IF NOT EXISTS contact_email       text,
  ADD COLUMN IF NOT EXISTS details_scraped_at  timestamptz;

COMMENT ON COLUMN city_halls.hall_type_label IS
  'Authoritative Hallentyp from the detail page ("Einfachhalle" | "Doppelhalle" | "Dreifachhalle" | "Gymnastikraum"). Display only — hall_type remains the name-derived value the UI filter matches on.';
COMMENT ON COLUMN city_halls.size_label IS
  'Whole-hall size exactly as printed, e.g. "23,00 x 10,90 x 5,40 m" (Swiss decimal comma, L x B x H).';
COMMENT ON COLUMN city_halls.length_m IS
  'Whole-hall length in metres. NULL when unknown — the site prints 0,00 for missing measurements (common for ceiling height in Gymnastikräume) and the parser maps that to NULL so height filters do not exclude them as "too low".';
COMMENT ON COLUMN city_halls.width_m IS 'Whole-hall width in metres, NULL when unknown.';
COMMENT ON COLUMN city_halls.height_m IS 'Clear ceiling height in metres, NULL when unknown (see length_m).';
COMMENT ON COLUMN city_halls.partitions IS
  'Per-court breakdown for multi-court facilities: [{"label":"Halle 1 (1/2)","sizeLabel":"…","length":14,"width":22,"height":9,"segment":"36"}]. Empty array for single-court halls. `segment` is the city Belegungsplan''s per-court id.';
COMMENT ON COLUMN city_halls.photo_url IS
  'Full-size hall photo on the city''s server, or NULL when the site serves its empty.jpg placeholder (~2/3 of halls). Hotlinked, never mirrored — the images belong to the City of Zürich.';
COMMENT ON COLUMN city_halls.photo_thumb_url IS 'Resized variant of photo_url for table thumbnails.';
COMMENT ON COLUMN city_halls.contact_email IS
  'Rental contact ("Kontakt für ausserschulische Betriebszeiten"), not the school-hours contact.';
COMMENT ON COLUMN city_halls.details_scraped_at IS
  'Last successful detail-page scrape. NULL = never enriched.';

-- Partial index: the UI offers a "has a photo" affordance and the endpoint
-- filters on it; only ~1/3 of rows qualify.
CREATE INDEX IF NOT EXISTS city_halls_photo_idx
  ON city_halls (einrichtung_id) WHERE photo_url IS NOT NULL;
