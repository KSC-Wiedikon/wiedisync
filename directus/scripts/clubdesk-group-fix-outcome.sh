#!/usr/bin/env bash
# clubdesk-group-fix-outcome.sh — judge a "Fix groups" run by the ROWS IT WROTE,
# not by the run finishing.
#
# Sourced by clubdesk-group-fix-dispatch.sh. Deployed with the rest of the
# clubdesk-*.sh glob (npm run clubdesk:deploy).
#
# WHY THIS EXISTS (20.10.2026). The dispatcher used to fail a run only when BOTH
# tools printed no JSON at all, and otherwise wrote grp_state='done' with
# "preview: 16 add, 1 remove" — the size of the WORKLIST, not the outcome. Two
# previews and two commits in which all 17 rows came back `skip_filter_failed`
# (the service account's ClubDesk grid had lost its Wiedisync ID column) were each
# stored as done, the UI offered the commit, and after it said "Done" in green.
# The operator was told everything was fine and ran the whole path again.
#
# ⚠⚠ THE OK STATUS SET. A row "did what was asked" when its status is one of:
#     assigned   — add tool, commit: ClubDesk accepted the dialog's OK
#     previewed  — either tool, preview: every step worked, cancelled at the end
#     removed    — remove tool, commit: chip gone, re-read, saved
# Everything else (skip_*, error, or no row at all because the tool died) is NOT.
# The same three statuses are listed in exactly one place in each of the other two
# layers — keep all three in step:
#     directus/extensions/kscw-endpoints/src/clubdesk-update.js → GROUP_FIX_OK_STATUSES
#     src/modules/admin/utils/groupFixOutcome.ts                → OK_STATUSES
# (kscw-endpoints __tests__/clubdesk-group-fix.test.js fails when they drift.)
GRP_OK_STATUSES="assigned previewed removed"

# SQL that reads one run's RESULT json ({"mode":…,"add":<summary|null>,"remove":…})
# and prints ONE line:  <ok>|<attempted>|<tally of the rest>|<fatal>
#   ok        rows with an OK status
#   attempted rows the tools reported at all (a tool that died early reports fewer
#             rows than it was given — the dispatcher counts the gap as "not attempted")
#   tally     the non-OK statuses, most frequent first: "17 skip_filter_failed, 1 error"
#   fatal     the tools' own `fatal` messages, if any ("; "-joined, one line)
# Same jsonb_array_elements shape as clubdesk-mirror-patch.sh. `fatal` goes LAST
# because it is free text: `IFS='|' read` hands the remainder of the line, pipes
# and all, to the last variable.
grp_outcome_sql() {
  local ok_list
  ok_list="'$(printf '%s' "$GRP_OK_STATUSES" | sed "s/ /','/g")'"
  printf '%s' "
WITH d AS (SELECT \$grpo\$${1}\$grpo\$::jsonb AS j),
r AS (
  SELECT COALESCE(x->>'status', '') AS s
    FROM d, LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.j->'add'->'results') = 'array' THEN d.j->'add'->'results' ELSE '[]'::jsonb END
      || CASE WHEN jsonb_typeof(d.j->'remove'->'results') = 'array' THEN d.j->'remove'->'results' ELSE '[]'::jsonb END
    ) AS x
),
bad AS (
  -- A row without a status is an error, never OK (groupFixOutcome.ts agrees).
  SELECT CASE WHEN s = '' THEN 'error' ELSE s END AS s, count(*) AS n
    FROM r WHERE s NOT IN (${ok_list}) GROUP BY 1
)
SELECT (SELECT count(*) FROM r WHERE s IN (${ok_list}))
    || '|' || (SELECT count(*) FROM r)
    || '|' || COALESCE((SELECT string_agg(n || ' ' || s, ', ' ORDER BY n DESC, s) FROM bad), '')
    || '|' || COALESCE(regexp_replace(concat_ws('; ',
                 NULLIF(BTRIM(d.j->'remove'->>'fatal'), ''),
                 NULLIF(BTRIM(d.j->'add'->>'fatal'), '')), '\s+', ' ', 'g'), '')
  FROM d"
}

# grp_outcome '<result json>' → the one line above, via the caller's psqlc.
grp_outcome() { psqlc "$(grp_outcome_sql "$1")"; }

# grp_outcome_judge <mode> <total> <ok> <attempted> <tally> <fatal> [<held_back>]
# Pure — no DB. Prints two lines: the grp_state ('done' | 'failed'), then the
# grp_message the operator reads. Examples:
#   preview: 0 of 17 writable — 17 skip_filter_failed               → failed
#   commit: 12 of 17 written — 4 skip_ok_disabled, 1 error          → done
#   commit: 0 of 17 written — 17 not attempted — <fatal>            → failed
#   commit: 12 of 12 written — 5 held back (skipped in the preview) → done
# ⚠ 0 OK rows out of >0 is 'failed', whatever the mode. A preview in which nothing
# is writable must not unlock the commit, and a commit that wrote nothing must not
# close the sync path's last step.
# `held_back` = rows the endpoint cut out of the commit because the preview skipped
# them. They were never in <total>, so without naming them a commit of only the
# writable rows read "12 of 12 written" with 5 allocations never made.
grp_outcome_judge() {
  local mode="$1" total="${2:-0}" ok="${3:-0}" att="${4:-0}" tally="${5:-}" fatal="${6:-}" held="${7:-0}"
  local verb state msg na detail=""
  [ "$mode" = "commit" ] && verb="written" || verb="writable"
  case "$held" in ''|*[!0-9]*) held=0 ;; esac
  na=$(( total - att ))
  [ "$na" -lt 0 ] && na=0
  [ -n "$tally" ] && detail="$tally"
  if [ "$na" -gt 0 ]; then
    [ -n "$detail" ] && detail="$detail, "
    detail="${detail}${na} not attempted"
  fi
  if [ "$held" -gt 0 ]; then
    [ -n "$detail" ] && detail="$detail, "
    detail="${detail}${held} held back (skipped in the preview)"
  fi
  msg="$mode: $ok of $total $verb"
  [ -n "$detail" ] && msg="$msg — $detail"
  [ -n "$fatal" ] && msg="$msg — $fatal"
  if [ "$ok" -eq 0 ] && [ "$total" -gt 0 ]; then state=failed; else state=done; fi
  printf '%s\n%s\n' "$state" "$msg"
}
