-- Migration 096: give team_requests.team an ON DELETE CASCADE.
--
-- team_requests_team_fkey was created with no ON DELETE clause (NO ACTION), so
-- deleting a team that still has rows in team_requests (e.g. an archived team
-- with stale pending join requests left over from before the rollover now
-- expires them) would ERROR instead of cleaning up. Every other team-FK
-- junction (events_teams, hall_slots_teams, teams_coaches/responsibles/sponsors,
-- fines, fine_rules, scheduling_blocks, conversations, forms_teams,
-- spielplaner_assignments) is already ON DELETE CASCADE — align team_requests.
--
-- Schema-only, idempotent: drop-if-exists then re-add. No data changes.

BEGIN;

ALTER TABLE public.team_requests DROP CONSTRAINT IF EXISTS team_requests_team_fkey;
ALTER TABLE public.team_requests
  ADD CONSTRAINT team_requests_team_fkey
  FOREIGN KEY (team) REFERENCES public.teams(id) ON DELETE CASCADE;

COMMIT;
