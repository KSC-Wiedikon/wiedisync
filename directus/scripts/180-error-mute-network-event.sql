-- Widen the seeded network_error mute rule from a single message ("Load failed",
-- WebKit/Safari) to the whole event. Every `network_error` is a transient
-- client-side drop by construction — the frontend only emits it from the
-- isTransientNetworkFailure carve-out (src/lib/sentry.ts), which fires for
-- "Load failed", "Failed to fetch" (Chrome/Firefox), "NetworkError…", "…offline",
-- "…connection was lost". Matching on one message left the other variants
-- cluttering the default view (surfaced 2026-07-07: 3 "Failed to fetch" rows).
-- An empty error_match means "any message for this event" (see matchMuteRule in
-- kscw-endpoints). Idempotent: the WHERE no-ops once error_match is already ''.

UPDATE error_mute_rules
SET error_match = '',
    note = 'All transient client-side network failures (Load failed / Failed to fetch / offline / connection lost) — the request never reached the server.'
WHERE event = 'network_error' AND error_match = 'Load failed';
