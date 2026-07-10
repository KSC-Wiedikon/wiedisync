# IMPROVEMENTS.md — KSCW `wiedisync` improvement backlog (open items)

The Phase 1/2 inventory (311 items) was executed and shipped; the full completed backlog and the Phase 2/2b/2c/2d/2e execution log are archived in **[`IMPROVEMENTS-archive.md`](IMPROVEMENTS-archive.md)**. Only the residual open / deferred items remain below.

**Legend:** `[ ]` todo · `⏸️` = deferred (needs focused manual work) · 🔒 = gated (needs sign-off) · ✅ = safe.

---

## High impact

### ✅ Safe

- [ ] ⏸️ `src/modules/gameScheduling/pages/AdminDashboardPage.tsx` — _(DEFERRED in autonomous pass: the derivations sit AFTER the `if (isInitialLoading) return null` early-return at line 482, so wrapping them in useMemo there is a rules-of-hooks violation. Needs a manual restructure to hoist them above the guard — not safe to auto-apply.)_ Heavy derived data is computed inline in the render body without useMemo: slotByIdAll (line 513), the awayMismatches/awayUnbooked/homeVmAlerts IIFEs (each rebuilding oppById/teamNameById/bookingById Maps, lines 637-690), summary reduce, and opponentSearchText. Every search keystroke (search state) re-runs all of it. Wrap these in useMemo keyed on their real deps (slots/opponents/bookings/checks) so typing in the search box doesn't rebuild every Map. _(efficiency)_
- [ ] ⏸️ `src/modules/messaging/hooks/useReactions.ts` — _(DEFERRED in autonomous pass: lifting reactions to conversation level re-plumbs useConversation → MessageBubble → ReactionBar (optimistic toggle + realtime + grouping) — an architectural refactor with behavior risk, not a contained auto-apply. Needs focused work.)_ N+1 fetch/subscription: ReactionBar calls useReactions(messageId) once per MessageBubble, so a 50-message thread fires 50 separate fetchAllItems('message_reactions') requests AND opens 50 useRealtime subscriptions on the same collection. Lift reaction loading to the conversation level (one fetch filtered by message _in [...] passed down, or a single realtime subscription in useConversation) instead of per-message. _(efficiency)_

### 🔒 Gated — need approval

- [ ] 🔒 `src/modules/feedback/FeedbackPage.tsx` — The form lets users attach up to 5 screenshots (UI shows a '(n/5)' counter and multi-file list), but handleSubmit only uploads and saves `files[0]` (lines 158-171) — the other 4 are silently discarded. The `screenshot: string | string[]` record field implies multi was intended. Upload all selected files (or drop the multi-select UI). _(error-handling · GATED: Changes what data is persisted per submission (user-facing behavior).)_

## Medium impact

### ✅ Safe

- [ ] ⏸️ `src/components/ParticipationSummary.tsx` — _(DEFERRED in autonomous pass: hoisting the fetch/subscription to the parent is a cross-component data-flow refactor, not a contained change. `prefetched` already exists as the escape hatch — worth wiring callers to it deliberately.)_ When `prefetched` isn't passed, each instance runs its own useCollection('participations') fetch AND a useRealtime subscription (lines 42-52). Rendered once per card in a list this is an N+1 fetch + N websocket subscriptions. Prefer hoisting a single fetch and passing `participations` down, or share via a query key. _(efficiency)_
- [ ] ⏸️ `src/components/SessionParticipationSheet.tsx` — _(DEFERRED in autonomous pass: same "fetch all in parent, pass slice down" cross-component refactor as ParticipationSummary — behavior-preserving but not contained.)_ Each SessionRow independently calls useParticipation('event', activityId, ...) (line 21), so an event with N sessions fires N separate participation fetches/subscriptions. Fetch all sessions' participations once in the parent and pass each row its slice. _(efficiency)_
