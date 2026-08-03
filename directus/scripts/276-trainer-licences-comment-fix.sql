-- Migration 276: correct the members.trainer_licences COMMENT.
--
-- Migration 274 shipped a few hours before 275 and its column comment states
-- "wiedisync-owned: ClubDesk has no counterpart column (its 'JS ID' maps to
-- members.js_id instead)". That was true when 274 was written and became FALSE
-- the same day: ClubDesk gained a "Trainer Lizenz" free-text field and 275
-- wired the two-way sync.
--
-- Left alone, the comment actively misleads — it tells the next person there is
-- nothing to sync, which is precisely the conclusion that would make them
-- delete the push column or re-implement it. 274 and 275 are both applied and
-- the runner rejects a sha change on an applied migration (the lesson from
-- migration 273), so this is the fix-forward.
--
-- Comment-only: no DDL, no data, no permissions. Idempotent by construction.

BEGIN;

COMMENT ON COLUMN public.members.trainer_licences IS
  'Coaching education (Trainerausbildung) held by this member: ordered, comma-separated subset of JS (Jugend+Sport Leiter/in), C, B, A. Multi-valued by design — J+S is a separate track from the federation C/B/A ladder, so "JS,B" is an ordinary value. NULL = none / not recorded. Normalized to canonical order by trigger members_normalize_trainer_licences_trg. WIEDISYNC-OWNED and synced BOTH WAYS with ClubDesk''s "Trainer Lizenz" free-text field (migration 275): the push renders these codes as the club wording ("J+S, B") echo-protected, and the down-sync parses that text back fill-only. Do not confuse with ClubDesk''s "JS ID", which is the J+S Personennummer and maps to members.js_id.';

COMMIT;
