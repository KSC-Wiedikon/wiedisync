-- Migration 279: basketplan_clubs — the basketball opponent-CLUB registry.
--
-- WHY A NEW TABLE (and not a sport column on game_scheduling_opponents):
-- game_scheduling_opponents is keyed per (kscw_team, opponent TEAM, season) and is
-- structurally welded to the SVRZ feed — opponentSvrzFixtures() /
-- computeOpponentSlotsPayload() / bookings.svrz_game_id all resolve through
-- svrz_games, which has no basketball counterpart (ProBasket publishes no fixtures
-- before the Spielplansitzung on 05.09.2026). It is also empirically unusable as a
-- club grouping source: on prod today club_id is set on 1 of 75 rows and club_name
-- on 0 of 75, because both the migration-213 backfill and resolveSyncedOpponents()
-- only match fixtures in status open/waitingForApproval. Basketball therefore gets
-- its own club identity.
--
-- IDENTITY, and why the surrogate id is the key:
-- ProBasket's "Übersicht Teamanmeldungen 26/27" workbook (sheet "Klubübersicht")
-- carries Team / Kategorie / Klub and NOTHING else — no club id, no contact. The
-- Basketplan clubId (the ?clubId= parameter of findClubById.do, e.g. 350; KSC
-- Wiedikon itself is 166) is the only real external id, and it is reachable ONLY
-- behind an authenticated session (verified 05.08.2026: findClubById.do,
-- showClubs.do and ?xmlView=true all 302 → showLogin.do). So a club exists here by
-- NAME long before its Basketplan id is known, and `id` — not bp_club_id — is what
-- the portal and the slot plan reference. bp_club_id is nullable and fills in later
-- via directus/scripts/basketplan-scrape-clubs.mjs (manual, opt-in, never a cron).
--
-- WHY THE CONTACT LIVES ON THE CLUB ROW rather than in a basketplan_club_contacts
-- child table: ProBasket's model is exactly ONE functionary per club — "Bitte sorgt
-- dafür das in Basketplan unter «Klub Funktionäre» die richtige Person (inkl. mind.
-- E-Mail) hinterlegt ist. Wir werden hier mit dieser Liste zu arbeiten und es wird
-- keine Excelliste geben." (Einladung Spielplansitzung 05.09.2026) — who may list
-- two addresses (the reference case: club 350 → "Gönültas Ekrem"). One row per club
-- means the portal-mint path needs no join, no "which contact is primary" rule and
-- no partial-unique/ON CONFLICT contract. If a club ever needs several
-- functionaries, add the child table then and migrate these columns into it; do NOT
-- pre-build it for a cardinality the source does not have.
--
-- THIRD-PARTY PII: contact_name / contact_email / contact_email_secondary /
-- contact_phone are named private individuals at OTHER clubs. Store only what the
-- send path needs — never addresses or birthdates (the same line migration 230 drew
-- for basketplan_people). Item permissions live in setup-permissions.mjs and must
-- grant Sport Admin + KSCW Terminplanung only: NOTHING to Member, Coach or Public.
-- The public portal endpoints read this table on the system knex connection behind
-- a token, so the Public policy needs zero rows here.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. The ONE data write is
-- the club-name seed below, which is reference data (the season's opponent list),
-- carries no PII, and is guarded by NOT EXISTS so re-running is a no-op.
--
-- Depends on: nothing. (It does NOT depend on migration 278 — the numbers are
-- independent workstreams and either order applies cleanly.)

BEGIN;

-- ── 1. basketplan_clubs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.basketplan_clubs (
  id                      serial PRIMARY KEY,
  bp_club_id              integer,
  name                    text NOT NULL,
  short_name              text,
  is_own_club             boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true,
  -- ProBasket "Spielplanverantwortliche Person" (Basketplan → «Klub Funktionäre»).
  contact_name            text,
  contact_email           text,
  contact_email_secondary text,
  contact_phone           text,
  contact_role_label      text,
  contact_source          varchar(16) NOT NULL DEFAULT 'none',
  contact_verified_at     timestamptz,
  bp_person_id            integer,
  source                  varchar(16) NOT NULL DEFAULT 'workbook',
  note                    text,
  last_synced_at          timestamptz,
  date_created            timestamptz NOT NULL DEFAULT now(),
  date_updated            timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketplan_clubs_source_check') THEN
    ALTER TABLE public.basketplan_clubs
      ADD CONSTRAINT basketplan_clubs_source_check
      CHECK (source IN ('workbook', 'basketplan', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'basketplan_clubs_contact_source_check') THEN
    ALTER TABLE public.basketplan_clubs
      ADD CONSTRAINT basketplan_clubs_contact_source_check
      CHECK (contact_source IN ('none', 'basketplan', 'manual'));
  END IF;
END $$;

-- Case- AND whitespace-insensitive name uniqueness. The ProBasket workbook ships
-- names with trailing spaces ('BS Kriens ', 'BC Bears Wil '); a plain UNIQUE(name)
-- would store both spellings as two clubs and later mint two portals for one club.
CREATE UNIQUE INDEX IF NOT EXISTS basketplan_clubs_name_unique
  ON public.basketplan_clubs (lower(btrim(name)));

-- PARTIAL unique: most clubs legitimately have no Basketplan id yet.
-- ⚠ Writers MUST use targetless `ON CONFLICT DO NOTHING` against a partial unique
-- (the 2026-07-27 review's contract) — a targeted ON CONFLICT (bp_club_id) cannot
-- see a partial index and errors at runtime. The seed below avoids the question
-- entirely by using NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS basketplan_clubs_bp_club_id_unique
  ON public.basketplan_clubs (bp_club_id) WHERE bp_club_id IS NOT NULL;

COMMENT ON TABLE public.basketplan_clubs IS
  'Basketball opponent clubs + their ProBasket scheduling contact. Seeded by NAME from the ProBasket Teamanmeldungen workbook (sheet "Prov. Gruppeneinteilung" joined to "Klubübersicht"); bp_club_id and the contact block fill in later via the manual Basketplan scrape (directus/scripts/basketplan-scrape-clubs.mjs) or by hand. `id` — not bp_club_id — is the key everything references, because a club exists here before its Basketplan id is known. THIRD-PARTY PII in the contact_* columns: Sport Admin / Terminplanung only, never Member, Coach or Public.';
COMMENT ON COLUMN public.basketplan_clubs.bp_club_id IS
  'Basketplan clubId — the ?clubId= parameter of findClubById.do (e.g. 350). NULL until the authenticated scrape resolves it; the page is session-gated (302 → showLogin.do, verified 05.08.2026), so the public bp-sync.js XML API can never supply it. KSC Wiedikon itself is 166.';
COMMENT ON COLUMN public.basketplan_clubs.is_own_club IS
  'TRUE for KSC Wiedikon. Portal minting excludes it — we never mail ourselves a scheduling link.';
COMMENT ON COLUMN public.basketplan_clubs.contact_email_secondary IS
  'Second address on the SAME Basketplan functionary entry (their «Klub Funktionäre» row may carry two). Both addresses are comma-joined into game_scheduling_club_portals.contact_email at portal-mint time.';
COMMENT ON COLUMN public.basketplan_clubs.contact_source IS
  'none = no contact known yet (the seeded state) | basketplan = scraped from «Klub Funktionäre» | manual = typed in by a KSCW planner. Never guessed: a club with contact_source=none is simply not mailable and must surface as such in the UI.';
COMMENT ON COLUMN public.basketplan_clubs.source IS
  'workbook = seeded from the ProBasket Teamanmeldungen club list | basketplan = discovered by the scrape | manual = added by hand.';

-- ── 2. Seed the season's opponent clubs ──────────────────────────────────
-- 63 distinct opponent clubs across the 15 ProBasket groups that contain a KSCW
-- team, extracted from src/modules/gameScheduling/data/basketballGroups.ts (which
-- is itself the regenerated "Prov. Gruppeneinteilung" sheet joined to
-- "Klubübersicht" on the team name), plus KSC Wiedikon itself with its known
-- Basketplan id.
--
-- NAMES ONLY — deliberately no contact data. We do not have the opponents'
-- Spielplan contacts, and inventing or guessing an address would mail a stranger.
--
-- ⚠ Three workbook teams have a BLANK Klub cell and therefore contribute no club
-- here: 'BS Arth-Goldau H4', 'BC Weinland HU16', 'TV Hünenberg Rockets MU12'. They
-- are reported, never guessed — add the club by hand once ProBasket fills the cell.
INSERT INTO public.basketplan_clubs (name, source)
SELECT v.name, 'workbook'
FROM (VALUES
  ('Aarau Basket'),
  ('Baar Bumble Bees'),
  ('Baden Basket 54'),
  ('BBC Glarus'),
  ('BBC Inwil Hoopers'),
  ('BBC Lions Heat'),
  ('BBC Schaan'),
  ('BBZU'),
  ('BC AKA'),
  ('BC Arlesheim'),
  ('BC Bears Wil'),
  ('BC Brunnen'),
  ('BC Buchrain-Ebikon'),
  ('BC Fällanden Red Lions'),
  ('BC Marmotas'),
  ('BC Oerlikon Grizzlies'),
  ('BC Olten-Zofingen'),
  ('BC Olympiakos'),
  ('BC RJ Lakers'),
  ('BC Sarnen'),
  ('BC Seetal'),
  ('BC Seuzach-Stammheim'),
  ('BC Silvercoast'),
  ('BC Sins'),
  ('BC Uster'),
  ('BC Winterthur'),
  ('BC Zürich 93'),
  ('BCA'),
  ('BCL Rivers'),
  ('BIQ'),
  ('BS Kriens'),
  ('BSCO'),
  ('BV Bregenz 1983'),
  ('BZO'),
  ('CVJM Frauenfeld'),
  ('Emmen Basket'),
  ('Feldkirch Baskets'),
  ('GC Zürich Basketball'),
  ('GRBB'),
  ('Griffins Basketball'),
  ('Ikaros Zürich BC'),
  ('KTV Schaffhausen'),
  ('Linth Basket'),
  ('Megas Alexandros'),
  ('Mutschellen Basketball'),
  ('Oberthurgau Pirates'),
  ('Opfikon Basket'),
  ('Phönix Basket'),
  ('Rheintal Scorpions'),
  ('Rüti Basket'),
  ('SCB'),
  ('Seeblick Bears Cham'),
  ('St. Otmar St. Gallen Basketball'),
  ('Stingerz'),
  ('STV Basket Kreuzlingen'),
  ('STV Luzern Basket'),
  ('Sursee Basket'),
  ('TVRB'),
  ('Unicorn 02 Basket'),
  ('Wallabies'),
  ('Weinland BC'),
  ('Wohlen Basket'),
  ('Zug Basket')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.basketplan_clubs c WHERE lower(btrim(c.name)) = lower(btrim(v.name))
);

-- KSC Wiedikon: seeded with its known Basketplan id so the id space is documented
-- in the DB and the scraper has a known-good page to smoke-test against.
INSERT INTO public.basketplan_clubs (name, bp_club_id, is_own_club, source)
SELECT 'KSC Wiedikon', 166, true, 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.basketplan_clubs c WHERE lower(btrim(c.name)) = lower(btrim('KSC Wiedikon'))
);

-- ── Directus admin metadata (visibility/debugging; item perms in setup-permissions.mjs) ──
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'basketplan_clubs', 'groups', '#e8590c', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'basketplan_clubs');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketplan_clubs', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('bp_club_id',              1, 'Basketplan clubId (findClubById.do?clubId=…). NULL until scraped.'),
  ('name',                    2, 'Club name as ProBasket spells it in the Teamanmeldungen workbook.'),
  ('short_name',              3, 'Optional short form.'),
  ('contact_name',            5, 'ProBasket Spielplanverantwortliche Person.'),
  ('contact_email',           6, 'Primary address.'),
  ('contact_email_secondary', 7, 'Second address on the same Basketplan functionary entry.'),
  ('contact_phone',           8, 'Optional phone.'),
  ('contact_role_label',      9, 'Role exactly as Basketplan labels it.'),
  ('contact_source',         10, 'none | basketplan | manual.'),
  ('bp_person_id',           11, 'Basketplan personId of the contact, when scraped.'),
  ('source',                 12, 'workbook | basketplan | manual.'),
  ('note',                   13, 'Free remark.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketplan_clubs' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'basketplan_clubs', v.field, 'cast-boolean', 'boolean', v.sort, 'half', v.note
FROM (VALUES
  ('is_own_club', 4, 'KSC Wiedikon itself — excluded from portal minting.'),
  ('active',     14, 'Uncheck to hide a club that left the region.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketplan_clubs' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'basketplan_clubs', v.field, NULL, 'datetime', v.sort, 'half'
FROM (VALUES ('contact_verified_at', 15), ('last_synced_at', 16)) AS v(field, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = 'basketplan_clubs' AND f.field = v.field
);

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketplan_clubs', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketplan_clubs' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'basketplan_clubs', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'basketplan_clubs' AND field = 'date_updated');

COMMIT;
