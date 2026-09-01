-- 348-households.sql
--
-- Households: let ONE adult login administer SEVERAL members.
--
-- WHY
-- ---
-- Nina Bolgé has three daughters in the club — Elin (DU12), Mila (DU14), Zoé
-- (DU18Sp) — and does all the administration for all three. Today she cannot.
-- Verified on prod 31.08.2026:
--
--   141  Elin  ninabolge@icloud.com  user SET     wiedisync_active = true
--   563  Zoé   ninabolge@icloud.com  user NULL    wiedisync_active = false
--   564  Mila  ninabolge@icloud.com  user NULL    wiedisync_active = false
--
-- The family's ONE login hangs off Elin's member row. Zoé and Mila have no
-- account at all, so nobody can RSVP, mark an absence or fill a form for them
-- by any means. This is not a Bolgé problem: 16 households share a contact
-- email across 36 active members, and in EVERY ONE of them exactly one sibling
-- holds the household's only login. 20 members are unreachable in the app
-- because a sibling has the account.
--
-- ⚠⚠ THE CLUB'S DECISION — "each child keeps her own member record" — IS ABOUT
-- MEMBER ROWS, NOT LOGINS. Rosters, RSVPs, fees, licences and federation data
-- stay strictly per-member and this migration does not touch any of them. What
-- changes is only WHO MAY SIGN IN AND ACT for a member. Conflating the two is
-- what made this look like it needed three email addresses.
--
-- WHAT
-- ----
-- households          — the family. Named, not derived: an email address is a
--                       terrible family key (parents remarry, siblings get
--                       their own address, two families share an au pair's).
-- household_members   — who is in it, and as what. `guardian` may act for the
--                       household's `managed` members; `managed` may not act
--                       for anyone. NEVER hard-deleted — `revoked_at` is set,
--                       because the history of who could act for a minor IS
--                       the record.
-- member_guardians    — the materialised grant. The ONLY table the request hot
--                       path reads: one flat indexed (uuid, int) lookup per
--                       request. Same reasoning as participation_visibility
--                       (migration 341) — a hot path must never walk a junction.
--                       Trigger-derived; hand-editing it is meaningless and a
--                       hand-written row would be a privilege grant with no
--                       household behind it, so it is registered readonly and
--                       granted to nobody in setup-permissions.mjs.
--
-- ⚠ `household` IS PART OF member_guardians' UNIQUE KEY. A member/guardian pair
-- may legitimately exist in two households (separated parents, two homes), and
-- a per-household rebuild must not delete the grant the OTHER household still
-- confers. Keying on (member, guardian_user) alone would make one household's
-- edit silently revoke the other's.
--
-- ⚠ A guardian must hold a real login for the grant to mean anything, hence the
-- `g_m."user" IS NOT NULL` join in the rebuild and the trigger on members."user".
-- A guardian who LOSES her login must lose every grant in the same statement.
--
-- ⚠ Single-column serial PKs throughout. A composite PK makes Directus ignore
-- the collection outright, and any relation pointing at it then 500s on read
-- for everyone including admins (migration 343's lesson).
--
-- ⚠ No permission rows here (CLAUDE.md migration rule 1 — migrations are
-- SCHEMA-ONLY). setup-permissions.mjs grants read to Sport Admin + Vorstand and
-- nothing at all to Member; the household endpoints are /kscw/* and need no
-- items-API grant.
--
-- ⚠⚠ Directus caches the schema at boot and a raw-SQL directus_fields /
-- directus_collections insert does NOT bust that cache (2026-08-22,
-- events.open_roster read back as `type: alias` until restart). Restart after:
--   npm run db:migrate:dev && ssh hetzner "sudo docker restart directus-kscw-dev"
--
-- Schema-only + idempotent per the CLAUDE.md migration policy.

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS households (
  id           serial PRIMARY KEY,
  name         varchar(120) NOT NULL,
  notes        text,
  created_by   integer REFERENCES members(id) ON DELETE SET NULL,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz,
  CONSTRAINT households_name_nonblank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE households IS
  'A family (or other caring arrangement) in which one adult login administers several members. Created by admin/superuser only — see /kscw/household.';
COMMENT ON COLUMN households.name IS
  'Display name, e.g. "Familie Bolgé". Named rather than derived from a shared email: an address is a poor family key (remarriage, siblings getting their own address, shared inboxes).';

CREATE TABLE IF NOT EXISTS household_members (
  id         serial PRIMARY KEY,
  household  integer NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member     integer NOT NULL REFERENCES members(id)    ON DELETE CASCADE,
  role       varchar(16) NOT NULL DEFAULT 'managed',
  accent     varchar(16),
  linked_by  integer REFERENCES members(id) ON DELETE SET NULL,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by integer REFERENCES members(id) ON DELETE SET NULL,
  CONSTRAINT household_members_role_ck CHECK (role IN ('guardian', 'managed')),
  -- A revoker without a revocation is nonsense. The converse IS allowed:
  -- revoked_at may stand alone, because the two automatic revocation paths
  -- (guardian loses her login; member graduates) have no acting human.
  CONSTRAINT household_members_revoked_by_needs_revoked_at
    CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

-- One LIVE row per (household, member). Revoked rows are kept forever, so the
-- unique index is partial — re-linking a member you previously revoked is
-- allowed and leaves both rows visible in the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS household_members_pair_uq
  ON household_members (household, member) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS household_members_member_ix ON household_members (member);
CREATE INDEX IF NOT EXISTS household_members_household_ix ON household_members (household);

COMMENT ON TABLE household_members IS
  'Membership of a household. role=guardian may act for the household''s managed members; role=managed may act for nobody. Never hard-deleted — revoked_at is set, because the history of who could act for a minor IS the record.';
COMMENT ON COLUMN household_members.accent IS
  'Stable per-member colour token for the account switcher (sky/ochre/plum/teal/rose). Stored rather than hashed from the id so it never re-shuffles when a sibling is added — a parent navigates this bar by colour before she reads it.';
COMMENT ON COLUMN household_members.revoked_at IS
  'Set instead of deleting. The partial unique index ignores revoked rows, so a member may be re-linked later without losing the earlier record.';

-- The materialised acting-grant. Read once per request that carries the acting
-- header; nothing else reads it. Derived — see rebuild_member_guardians().
CREATE TABLE IF NOT EXISTS member_guardians (
  id            serial PRIMARY KEY,
  member        integer NOT NULL REFERENCES members(id)        ON DELETE CASCADE,
  guardian_user uuid    NOT NULL REFERENCES directus_users(id) ON DELETE CASCADE,
  household     integer NOT NULL REFERENCES households(id)     ON DELETE CASCADE,
  CONSTRAINT member_guardians_uq UNIQUE (member, guardian_user, household)
);

CREATE INDEX IF NOT EXISTS member_guardians_lookup_ix
  ON member_guardians (guardian_user, member);

COMMENT ON TABLE member_guardians IS
  'DERIVED from household_members by trigger — do not edit. The only table the acting-member request path reads. A hand-written row here is a privilege grant with no household behind it, which is why no policy grants write access to it.';

-- ── Rebuild ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rebuild_member_guardians(p_household integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_household IS NULL THEN RETURN; END IF;

  DELETE FROM member_guardians WHERE household = p_household;

  INSERT INTO member_guardians (member, guardian_user, household)
  SELECT DISTINCT c.member, g_m."user", p_household
    FROM household_members c
    JOIN household_members g   ON g.household = c.household
                              AND g.role = 'guardian'
                              AND g.revoked_at IS NULL
    JOIN members            g_m ON g_m.id = g.member
                              AND g_m."user" IS NOT NULL
   WHERE c.household = p_household
     AND c.role = 'managed'
     AND c.revoked_at IS NULL
     AND c.member <> g.member
  ON CONFLICT (member, guardian_user, household) DO NOTHING;
END $$;

COMMENT ON FUNCTION rebuild_member_guardians(integer) IS
  'Recomputes every acting-grant conferred by one household. Called by trigger on household_members and on members."user" changes. Deletes then re-inserts, scoped to the single household — which is why `household` is part of member_guardians'' unique key.';

-- ── Triggers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_household_members_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Rebuild BOTH sides on a move: a row whose household changed removes a grant
  -- from the old household and adds one to the new.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM rebuild_member_guardians(OLD.household);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'INSERT' OR NEW.household IS DISTINCT FROM OLD.household THEN
      PERFORM rebuild_member_guardians(NEW.household);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_household_members_rebuild ON household_members;
CREATE TRIGGER trg_household_members_rebuild
  AFTER INSERT OR UPDATE OR DELETE ON household_members
  FOR EACH ROW EXECUTE FUNCTION trg_household_members_rebuild();

-- A guardian gaining or losing her own login must gain or lose every grant she
-- confers. Without this, revoking a parent's account would leave live rows in
-- member_guardians pointing at a deleted user (the FK cascade covers deletion,
-- but NOT the far more common case of members."user" being set to NULL).
CREATE OR REPLACE FUNCTION trg_members_user_rebuild_guardians()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h integer;
BEGIN
  FOR h IN
    SELECT DISTINCT household FROM household_members
     WHERE member = NEW.id AND role = 'guardian' AND revoked_at IS NULL
  LOOP
    PERFORM rebuild_member_guardians(h);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_members_user_rebuild_guardians ON members;
CREATE TRIGGER trg_members_user_rebuild_guardians
  AFTER UPDATE OF "user" ON members
  FOR EACH ROW WHEN (OLD."user" IS DISTINCT FROM NEW."user")
  EXECUTE FUNCTION trg_members_user_rebuild_guardians();

-- ── Directus registration ───────────────────────────────────────────
-- Without these the collections are invisible to the items API and the admin
-- app. member_guardians is registered hidden + readonly: it is derived.

INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'households', 'family_restroom',
       'A family in which one adult login administers several members. Managed via /admin/households.', false, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'households');

INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'household_members', 'group',
       'Who is in a household, and as what (guardian / managed). Revoked rows are kept — never delete.', false, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'household_members');

INSERT INTO directus_collections (collection, icon, note, hidden, singleton)
SELECT 'member_guardians', 'key',
       'DERIVED from household_members by trigger — do not edit.', true, false
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'member_guardians');

-- households
INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'households', 'name', 'input', 'raw', false, 1, 'full', 'e.g. "Familie Bolgé".'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'households' AND field = 'name');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'households', 'notes', 'input-multiline', 'raw', false, 2, 'full', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'households' AND field = 'notes');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'households', 'created_by', 'select-dropdown-m2o', 'related-values', true, 3, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'households' AND field = 'created_by');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'households', 'date_created', 'datetime', 'datetime', true, 4, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'households' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'households', 'date_updated', 'datetime', 'datetime', true, 5, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'households' AND field = 'date_updated');

-- household_members
INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'household', 'select-dropdown-m2o', 'related-values', false, 1, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'household');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'member', 'select-dropdown-m2o', 'related-values', false, 2, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'member');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'role', 'select-dropdown', 'labels', false, 3, 'half',
       'guardian = may act for this household''s managed members. managed = may act for nobody.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'role');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'accent', 'input', 'raw', false, 4, 'half',
       'Stable colour token for the account switcher.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'accent');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'linked_by', 'select-dropdown-m2o', 'related-values', true, 5, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'linked_by');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'linked_at', 'datetime', 'datetime', true, 6, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'linked_at');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'revoked_at', 'datetime', 'datetime', true, 7, 'half',
       'Set instead of deleting. A revoked row confers nothing.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'revoked_at');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'household_members', 'revoked_by', 'select-dropdown-m2o', 'related-values', true, 8, 'half', NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'household_members' AND field = 'revoked_by');

-- member_guardians (all readonly — derived)
INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'member_guardians', 'member', 'select-dropdown-m2o', 'related-values', true, 1, 'half', 'Derived — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'member_guardians' AND field = 'member');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'member_guardians', 'guardian_user', 'select-dropdown-m2o', 'related-values', true, 2, 'half', 'Derived — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'member_guardians' AND field = 'guardian_user');

INSERT INTO directus_fields (collection, field, interface, display, readonly, sort, width, note)
SELECT 'member_guardians', 'household', 'select-dropdown-m2o', 'related-values', true, 3, 'half', 'Derived — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'member_guardians' AND field = 'household');

COMMIT;
