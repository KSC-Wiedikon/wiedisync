# Security baseline — KSCW (`wiedisync`)

Living doc for the security posture of the KSCW platform. Audited findings, fixes, gotchas, and rules. Update on every audit pass.

> **Reporting:** mail `kontakt@kscw.ch`. Do NOT open a public issue with exploit details. Production lives at `wiedisync.kscw.ch` + `directus.kscw.ch` (Hetzner via Cloudflare Tunnel).

---

## Trust boundaries

| Surface | Origin | Auth | Notes |
|---|---|---|---|
| `wiedisync.kscw.ch` (React) | CF Pages, prod branch | Directus access token (localStorage / sessionStorage based on remember-me) | Talks only to `directus.kscw.ch`. CF Pages env vars carry only `VITE_*` (public). |
| `wiedisync.pages.dev` (React dev) | CF Pages, dev branch | Same | Talks to `directus-dev.kscw.ch`. |
| `directus.kscw.ch` (Directus) | Hetzner VPS via CF Tunnel | Built-in Directus auth (cookies + bearer). Custom endpoints inherit `req.accountability`. | All custom routes under `/kscw/*`. |
| `kscw-push.lucanepa.workers.dev` (CF Worker) | Cloudflare Workers | Shared bearer secret from Directus → worker (constant-time compared since 2026-05-06). | VAPID keys in worker secret store; Directus side reads `VAPID_PUBLIC_KEY` env. |
| `kscw.ch` (ClubDesk) | External | Out of our scope | Don't change DNS until explicitly confirmed. |

Direct VPS exposure (Hetzner ports 8055/8056) is **not** publicly reachable — only via CF Tunnel. If that ever changes, `X-Forwarded-For`-based rate limiters collapse simultaneously (every limiter in `kscw-endpoints` uses it as fallback).

---

## What's gitignored vs. tracked

Already in `.gitignore` (don't commit):

- `.env`, `.env.*` (`.env.example` is the only tracked env file)
- `.env.test` — local-only test creds; the test accounts share a single password (structural value, not reproduced here — see Vaultwarden `services/kscw-test-accounts`). Rotate if leaked.
- `INFRA.md` — contains VPS IPs / SMTP creds / token formats
- `CONTINGENCY.md`
- `directus/.env`, `directus/uploads/`, `directus/node_modules/`
- `.planning/` and `docs/superpowers/{plans,specs}/` (plan/spec docs leak credentials in practice)
- `playwright-report/`, `test-results/`, `e2e/.auth/`

Tracked (must stay clean of secrets):

- `directus/extensions/**` — only `process.env.X` reads, no fallback values to live keys.
- `workers/push/src/**` — same. VAPID + AUTH secrets via `wrangler secret`.
- `src/**` — only `VITE_*` env variables (public by design).

> **Rule:** if you find yourself adding a `|| 'fallback-value'` to a secret env read, push it back. Web push regressed on this once (`VAPID_PUBLIC_KEY` had a hardcoded fallback) — fixed 2026-05-06.

---

## Hardening completed (audit log)

Treat this as a deduplication shield: if a future audit finds something on this list, it's either a regression or a misunderstanding — verify before re-flagging.

### 2026-07-04 — Registration documents enforced server-side

All registration-document requirements previously lived only in the kscw-website client JS (any direct `POST /kscw/registration` — or any upload-phase failure after the row was created — produced a document-less registration; live case REG-2026-5041). Now enforced at three layers:

- **Create gate.** `POST /kscw/registration` refuses a basketball registration whose required document UUIDs (`id_upload_front`, `id_upload_back`, `bb_doc_lizenz`; non-CH additionally `bb_doc_selfdecl` + `bb_doc_natdecl`) are not in the payload (`docs_required`). The form (v3.3.0) uploads files eagerly on pick and submits their ids WITH the create — the create-before-upload window is gone.
- **Approval gate.** `registrations.items.update` filter hook blocks `status='approved'` on a basketball registration missing required docs (legacy rows without `nationalitaet_code` need only the base 3). AnmeldungenPage pre-checks and toasts.
- **Late re-upload, second factor + fill-only.** `POST /kscw/registration/:id/files` now also accepts `status='approved'` rows **only with the registration email as a second factor** next to the reference number (mismatches feed the existing brute-force lockout), and on approved rows it is **fill-only** — existing (admin-reviewed) document pointers can no longer be silently replaced. New public `GET /kscw/registration/doc-status` (reference + email, same limiter, booleans only, 404 on any mismatch) powers the website's "Dokumente nachreichen" page.
- **Documents born private + folder locked down (adversarial review of this diff).** The form no longer uses the anon core `POST /files`: new public `POST /kscw/registration/upload` streams the file server-side into the private registration folder (`a0000167-…`), MIME/size-checked and per-IP-limited — ID scans are never folder-less/anon-readable, even as orphans. Member `directus_files` read now **excludes the registration folder** (was readable by any logged-in member; Sport Admin keeps access via full CRUD, Vorstand via a folder-scoped read). Nightly kscw-hooks sweep deletes week-old unreferenced files in that folder (eager upload orphans). Create gate additionally verifies the submitted doc UUIDs are real `directus_files` rows (no fabricated-UUID "complete" rows).

### 2026-07-03 — Signup closed to invite-tokens + duplicate-member hardening

Open self-registration is closed: accounts are created only by redeeming a **single-use, member-bound signup token** (migration **167**, `signup_tokens` — SHA-256 hash only, 30-day TTL, delete-before-use, backend-only knex table mirroring 073). Minted automatically on Anmeldung approval (kscw-hooks) and manually by admin/vorstand/coach/TR via `POST /kscw/signup-invites/create` (writeUserLog'd; token travels email-only, never in API responses). `/kscw/register`'s new-member insert branch now returns `registration_closed`; the email-match claim flow and vm_email claim remain. Related fixes in the same batch:

- **Role-less account creation (HIGH).** `/kscw/set-password` mode 3 created `directus_users` without a role → zero policies, every request silently 403'd (live case: member 542, fixed on prod by hand + code now passes the Member role; the new redeem endpoint does too).
- **team_invites dead end-to-end.** Code wrote non-existent `created_by`/`claimed_at` columns (42703 → create 500'd, claim rolled back; 0 rows ever on prod) and the modal read `res.url` while the endpoint returns `qr_url`. Fixed to the real schema (`invited_by` member-id, `date_updated`) + writeUserLog on create.
- **Duplicate-member dedup hardening.** `team-invites/claim` + registration-approval hook upgraded from case-sensitive members-only email match to the `/register` standard (LOWER + directus_users + vm_email). New `members.items.create` filter blocks same-person duplicate emails on the items API (admins included — the only live dup source per the 2026-07-03 audit) while allowing same-email different-first-name family adds (verified legit on prod: Galeczki/Stinson sibling pairs). Registration hook now creates a separate row for a same-email different-name sibling instead of grafting onto the wrong person. Deliberately NO unique index on `members.email` (family emails are legitimate).
- **Approval-hook ordering.** Member creation now happens BEFORE the registrant email (which carries the token CTA); creation failure alerts sport admins instead of mailing the registrant a dead-end link.
- **Spielplaner manual-game grant (pre-existing 403) + scope guards.** New per-user `KSCW Spielplaner` policy grants games create/update/delete **row-filtered to `source='manual'`**; kscw-hooks extends the per-team scope guard to update/delete for assignment-scoped spielplaners. Coach/TR gained read-only Spielplanung access (planner calendar + 3 read endpoints), zero mutation endpoints loosened.
- **Accepted tradeoff — `signup-invites/create` returns the invite URL.** So staff can show a QR code / copy the link in person (onboarding request), the mint endpoint returns `invite_url` (the tokenised `/signup?invite=` link) to the caller. The token is therefore visible to the minter, who could redeem it and set the invited member's password. Accepted because the caller is always admin / vorstand / the member's own coach or TR (trusted staff already able to act for that member), every mint is `writeUserLog`'d, and the member is emailed the same link — mirroring the existing `team-invites/create` QR flow. Public `info`/`redeem` still never expose a token.

### 2026-07-02 — Deep dual-repo review + remediation (wiedisync + kscw-website)

Full multi-agent review (security + access-control + logic + efficiency + error-handling + deps) over everything since the 2026-06-25 audit — finance native ledger (150–155), ClubDesk two-way member sync (157–159), scheduling global blocks (160), per-member poll answers, training tombstones (162). 45 raw findings → 42 confirmed after adversarial verification (0 critical, 4 high, 14 medium, rest low/info). All remediated below. Migrations **163–165** (schema-only); permissions in `setup-permissions.mjs`. Deploy order: schema first (`db:deploy:*`) then `ext:deploy:*`, then push frontend.

**High**
- **Scorer-delegation duty hijack — UPDATE gap in the 2026-06-25 fix (HIGH, #3).** Migration 148 forced `status='pending'` only on INSERT and the Member `scorer_delegations.update` grant was `fields:['*']` (scoped by `OWN_DELEGATION`), so a member who is a party to a delegation could PATCH `from_member`/`to_member`/`game`/`role` and flip `status='accepted'`, driving the transfer hook to reassign a LEADER-only scorer/timekeeper duty. Three layers now: the Member update grant is restricted to `fields:['status']`; migration **163** makes the identity columns immutable on UPDATE (`trg_scorer_delegation_freeze_identity`); the transfer hook already re-checks recipient + duty ownership.
- **wadmin PII exfil via relational `fields` (HIGH, #4).** `GET /kscw/wadmin/:section/items/:collection` runs an `accountability:{admin:true}` ItemsService (RLS-bypass) and forwarded the client's `fields` verbatim while `assertCollection` validated only the top-level collection — a section-scoped (non-manager) Website Admin could deep-expand `events → invited_members.members_id.{email,ahv_nummer,iban,birthdate}` and dump the member directory. Non-manager callers are now rejected for any relational `fields`/`sort`/`filter` (`assertScalarQuery` in `wadmin.js`); managers (superuser) keep full flexibility.
- **Finance refund double-counts the ledger (HIGH, #1).** With a prepayment account configured, refunding an overpayment re-opened Accounts Receivable instead of drawing down the prepayment, permanently drifting the Debitoren control from the sub-ledger. `finance-autopost.js` now tracks a running prepaid balance and draws refunds from prepayment first; the allocation is extracted to a pure, unit-tested `planSettlementLegs` (`__tests__/finance-autopost.test.js` asserts Debitoren==open, Bank==net cash, double-entry balance).
- **ClubDesk sync-up blanked authoritative fields (HIGH, #2).** The up-push emitted the full contact row incl. `Anrede`/`Nationalität`/`AHV Nummer`, which wiedisync never syncs down — sending blanks that could wipe the legal register. Those three columns are dropped from the push; sync-up also now runs dry-run-first (commit gated behind `CLUBDESK_UP_COMMIT=1`), stamps `clubdesk_pushed_at` to prevent duplicate re-push, and only clears the pending flag for members actually pushed. **Still gated on live ClubDesk import-wizard validation before enabling commit on prod** (memory-tracked).

**Medium**
- **Anonymous poll de-anonymization (MED, #5/#14).** Anonymous poll votes always persisted `member`, and the LEADER (2026-06-28) + Vorstand + Sport Admin `poll_votes` reads returned the voter identity — anonymity was UI-only. All three manager reads are now scoped to `poll.anonymous = false`; managers get anonymous-poll results as identity-free counts via the new `GET /kscw/polls/:id/results` (manager-gated). Full Directus admins still bypass by design.
- **Finance reversal/idempotency + cancel/delete symmetry (MED, #6–#10).** Journal reversal rejects re-reversing / already-reversed entries (migration **165** adds a partial `UNIQUE(reversal_of)` race backstop); cancelling an invoice with received cash is blocked (would delete the settle legs for real cash); deleting a team entry now removes its auto-posted GL entry (`removeAutopostForTeamEntrySafe`); dues-run issue takes a per-fiscal-year advisory lock + re-checks already-billed inside the txn (concurrent issue no longer double-bills).
- **Audit-log PII redaction gap (MED, #13).** `audit.js` redaction listed `address` (real column is `adresse`) and omitted `iban` + all `billing_*` — cleartext PII to `user_logs`. Redaction map corrected.
- **Registration/newsletter spoofable rate-limit IP (MED, #12).** File-attach IDOR lockout + limiters keyed on leftmost `X-Forwarded-For` (attacker-spoofable behind Cloudflare); now use `cf-connecting-ip` like `contact-form.js`.
- **CSV formula injection (MED, #17).** Registration + finance CSV exports (`AnmeldungenPage`, `financeExport.ts`, `exportResults.ts`) now neutralize leading `= + - @` / tab / CR.
- **Frontend finance logic (MED, #15/#16).** `isOpenInvoice()` now treats native `partial` as open (members can pay the remainder; totals correct; `partial` badge added); dues "Download bills" bills the open balance, not the full amount, for already-paid rows.
- **Public forms member-directory enumeration (MED, #18) — PARTIAL.** The website autocomplete flow (`531dc3c2-…`) returns the full roster; client hardened (drops internal `id` where unused) but the **Directus Flow itself must be scoped to the public policy (website_visible + adults, no id)** — server-side, tracked as a follow-up.

**Low / Info**
- Closed-year ledger immutability bypass via `fiscal_year` re-point closed (migration **164** guards OLD and NEW year on UPDATE, #19). Rounding-residual ≤1 rappen now cleared so Debitoren reconciles (#23). 0-CHF dues no longer minted (#21). Year-end close surfaces an `unposted_ar` completeness count (#22). Tombstone pre-state Map now TTL-swept (#32). ClubDesk auto-linker reverse-dedup + 1:1 re-check on deactivate (#11). writeUserLog added to ClubDesk flag write / mailbox send / Saturday rebalance cascade (#28/#29/#40). Saturday hall rebalance no longer leaves a stale/duplicate hall (#30). Registration POST per-IP limit (#31). New migrations self-wrap in BEGIN/COMMIT (the #39 lesson). **kscw-website:** `youth-status` href scheme-guarded (#33) + fallback badges no longer wiped on empty/failed fetch (#35); calendar null-date crash + unbounded fetch fixed (#34/#37); unit suite repaired (22/22, #36). **Deps:** `nodemailer` bumped to 9.0.3 (GHSA-p6gq-j5cr-w38f) on the direct send path (#38).

### 2026-06-25 — Deep dual-repo audit (wiedisync + kscw-website)

Full 6-surface audit of both repos (security + permission + UI) via 13 parallel finders + adversarial verification (`/kscw-security-audit`, extended to the website + a UI dimension). 66 raw findings → **63 confirmed (2 high, 7 medium, rest low/info)**; 3 refuted (expense-upload IDOR already `uploaded_by`-scoped — see the finance-batch entry below; website roster `yob` already minor-stripped server-side by `/public/team/:id`; website admin `/users` reachable only by manager-admins, no gated role exists). Remediated:

**wiedisync — security/permission:**
- **Scorer-delegation duty hijack (HIGH — HOOK-1 + PG-1).** A Member could `POST /items/scorer_delegations {status:'accepted', game:<any>}`; the kscw-hooks transfer then reassigned that game's scorer/timekeeper duty via raw knex, bypassing the LEADER-only `games.update` perm (and could force a no-show-fine duty onto a non-consenting victim). Three layers now: migration **148** forces `status='pending'` on INSERT; `transferDelegatedDuty` only fires when the actor **is** the recipient AND the delegator currently holds the duty; the `/scorer-delegation/accept` endpoint re-checks duty ownership and writes `writeUserLog` (EP-SCH-3, also on `/decline`).
- **Member feedback-screenshot PII leak (MEDIUM — PERM-1).** The Member `directus_files` read excluded only the finance folder, so any member could enumerate + download every feedback screenshot (member-authenticated screens / PII). Read now also excludes the feedback folder (`_nin: [finance, feedback]`); only Vorstand/Sport-Admin review them via a folder-scoped read.
- **user_logs audit forgery (MEDIUM — PERM-2).** Member `user_logs` create was unfiltered/unstamped (forge audit rows attributed to any member). New `user_logs.items.create` hook force-stamps the actor to the caller's own member id (system/admin pass through).
- **Privilege-flag escalation defense-in-depth (MEDIUM — HOOK-2).** The members create/update filter stripped only `role` for non-admins; it now also strips `is_spielplaner` + `finance` (each escalates to a real policy via the action hook), so the field-perm whitelist is no longer the sole backstop.
- **Contact-form email relay (MEDIUM — INT-1).** Public `/contact` (Turnstile-only) echoed an attacker's free-form message to an attacker-chosen, unverified address from KSCW's DKIM domain. Now per-IP rate-limited (5 / 10 min) + the acknowledgement is a constant body/subject (no echo of attacker content).
- **Finance FK cascade (LOW — PG-2/PG-3).** `finance_payments` + `finance_dunning_notices` referenced `finance_invoices` ON DELETE CASCADE, so deleting an invoice silently destroyed received-payment records and the Mahnwesen reminder trail. Migration **149** switches both to ON DELETE RESTRICT — a dunned/paid invoice can no longer be hard-deleted (void/soft-delete required). *Behaviour note: deleting such an invoice now errors by design.*
- **Other backend (LOW/INFO):** public opponent-register rate-limit + email-format validation + team-existence check (EP-SCH-2); `/register` OTP freshness bound `expires_at > now` (INT-2); newsletter-digest HTML escaping + allowlist-sanitized AI summary + constant-time admin-token compare (EP-COMM-1/4); registration file-attach per-IP limit + reference-mismatch lockout + UUID-format guard (EP-COMM-2); newsletter-subscribe per-IP/per-email limiter (EP-COMM-3); camt `processEntities:false` + reject `<!DOCTYPE` (EP-FIN-3); CSV formula-injection neutralization in `clubdesk-update.js` `escCsv` + `csvEscapeHook` (EP-FIN-2/INT-3/HOOK-3); Turnstile siteverify body via `URLSearchParams` (INT-4, 4 call sites); CSP `form-action 'self'` added to `public/_headers` (FE-1); Sentry user identifier pseudonymized to `member#<id>`, real name no longer sent to the EU processor (FE-2).

**kscw-website — security:** mixed-turnier note rendered with `escapeHtml` instead of default-profile DOMPurify (WEB-ADM-3); `SectionHeader` action label `set:html`→plain interpolation (WEB-SEC-3); success-modal messages built via `createElement`/`textContent` (WEB-SEC-7); **DOMPurify vendored locally** (SRI-verified 3.2.4 → `public/js/vendor/purify.min.js`) so the news-body XSS sanitizer no longer depends on a third-party CDN's availability (WEB-SEC-4). New `kscw-website/SECURITY.md` created.

**UI (both repos, sentence-case + Swiss-date + a11y):** ~145 wiedisync + ~238 website English i18n values Title-Case→Sentence-case (UI-W-8 / UI-WEB-2/8); every wiedisync `Intl`/`toLocale*` date render hardcoded to `de-CH` (`formatDate` now localizes fr/it; GameDetailModal en→en-GB) per the Swiss-date rule; native `<select>` dark-mode backgrounds; form-label `htmlFor`/`id` association + dialog `role`/`aria-modal` + icon-button `aria-label`; BugfixDashboard + VolleyFeedback record lists → `<Table>`; website nav dropdowns keyboard-operable + `aria-expanded`/`haspopup` + 44 px touch targets + lang-toggle `aria-pressed` (UI-WEB-1/3/4/5/6/7).

### 2026-06-25 — Finance batch (migrations 138–147) audit + remediation

Two parallel audits over the new finance endpoints/collections found **0 critical, 0 high** — authz (every write `canManageFinance`-gated), parameterized SQL, IDOR-safe `:id` routes (`source='native'` re-check), uniform `writeUserLog` actor-capture, and a well-layered mass-email guard (test_mode default-ON → dry_run → confirm → `finance_email_jobs_one_running` partial-unique → idempotent `email_sent_at`). camt parser is XXE/billion-laughs-immune (fast-xml-parser, no DTD/entity resolution). Remediated:
- **expense-upload file IDOR (MEDIUM, pre-existing, exploitable)** — `loadFile()` selected `directus_files` by id with no owner predicate, an alternate read path defeating the 2026-06-24 invoice-PDF folder-scoping (a member could OCR/email-exfiltrate any file by UUID). Now scoped to `uploaded_by = caller`, 404 on mismatch (`expense-upload.js`).
- **Finance email-recipient validation (MEDIUM)** — `test_recipient` (email-settings) + `billing_contacts.email` are now email-regex validated (400) so a finance-role user can't redirect dues-email QR-bills to an arbitrary external mailbox.
- **camt upload size cap (MEDIUM)** — `POST /finance/camt-import` rejects bodies >8 MB (413); parse-and-loop OOM footgun closed.
- **dunning `force` over `never_dun`** now records `forced_never_dun + member` in `writeUserLog` (the opt-out override is auditable).
- Settlement recompute hardened (separate adversarial review): no false-settle on refund/write-off mixes, transactions+row-locks on confirm/payments/camt, reopen clears `confirmed_*`, camt null-uid skip, ClubDesk sync writes a ledger row. See `git log` (commits 91501221 + this).

**Permission posture (PASS):** the 5 sensitive new collections (`finance_email_settings`, `finance_email_jobs`, `finance_team_entries`, `finance_dunning_notices`, `finance_billing_contacts`) have **zero policy grant** → deny-by-default for Member/TR/Sport-Admin/Public; `finance_dues_rates`/`finance_dues_runs` are READ Vorstand+Finance only; all writes are endpoint-only. Per-collection scope is tabled in `PERMISSIONS.md`. **Open (accepted, see below):** Sport Admin reads `members.*` unfiltered → `never_dun` now rides the same wildcard that already exposes `iban`/`ahv_nummer` — decide field-scope vs accept.

### 2026-06-24 — Finance role + invoice-PDF privacy (migrations 132–134)
- **New orthogonal `finance` role** (treasurer / finance team) — member permissions + a per-user `KSCW Finance` policy (attached like `is_spielplaner`/Terminplanung, reconciled by the role-sync hook + `setup-permissions.mjs §13`). Least-privilege: club-wide finance reads + a field-scoped `members` read (contact/IBAN/membership/billing) + a `members` UPDATE scoped to the billing-contact fields ONLY — NOT the rest of Vorstand's board read-all. Finance writes (native invoices + camt) gated in code by `canManageFinance`. The `members.role` write is still stripped at the kscw-hooks filter for non-admin callers, so a finance user can't self-assign roles.
- **Invoice PDFs are member-private.** Invoice PDFs contain a member's billing details. They upload into a private Directus folder; the **Member `directus_files` read was narrowed** from fully-unfiltered to exclude that folder (`{ _or: [{ folder: _null }, { folder: { _neq: <finance folder> } }] }`). Surgical — every pre-existing file (folder-less photos, feedback screenshots) stays member-readable; only the new private folder is excluded. Finance + Vorstand get a folder-scoped read, so `/assets` 403s the PDF for members while finance/board can open it. Verified on dev + prod (`directus_permissions` filter inspection).

### 2026-06-16 — Scheduling/forms/mailbox cycle reconciliation

Doc-drift catch-up for the work landing 2026-06-10..06-15 after the deep-audit remediation below. No new security regression — recorded here as the security-relevant slice of a feature/schema cycle so a future audit doesn't re-flag it. Most of this cycle is features; only the slices below touch the security/permission surface.

- **Migrations 104–111 (schema-only, idempotent, no permission rows):** `104` VM-push tracking columns, `105` per-fixture bookings, `106` contacts team-identifier, `107` repoint orphaned games to active teams, `108` game-scheduling season window, `109` invite-reminder-sent, `110` game-scheduling contact groups, `111` booking-proposer. All verified to carry NO permission rows and NO new plpgsql functions lacking `SET search_path` (the search_path discipline below still holds for this cycle). Per the Migration & Permission Policy these are correctly schema-only; permissions stay in `setup-permissions.mjs`.
- **Scheduling mailbox went LIVE (dev + prod):** the embedded IMAP client for `volleyball@spielplanung.kscw.ch` (migration 100, `kscw-endpoints/src/scheduling-mailbox.js`) is now wired with real credentials (`SCHEDULING_IMAP_PASSWORD` from Vaultwarden, both `.env`s + both containers recreated). Attachment bytes are never stored — streamed on demand from IMAP. Replies send via the existing SES SMTP (DKIM-aligned) and are append-only to Migadu Sent. The endpoint stays gated like the derbies surface (no item-collection perm grant). Env changes need a container **recreate**, not `docker restart`.
- **Forms permission surface (migrations 086–089) — recorded so the role-table reconciliation in `PERMISSIONS.md` is the source of truth, not a finding:** Member gets read on `forms` (scoped to club-wide ∪ their teams via `FORMS_VISIBLE`) + `forms_teams`, and create/read of their OWN `form_submissions` only (`FORM_SUBMISSION_OWN` self-scope `_or` anonymous `member = NULL`, blocking submit-as-another-member). LEADER (coach/TR) gets read/create/update/delete on `forms` + `forms_teams` scoped to teams they coach/TR (`FORMS_LEADER_SCOPE`) and reads submissions of forms in that scope. Vorstand has **full CRUD** on `forms` / `forms_teams` / `form_submissions` (decision 2026-06-05) — i.e. Vorstand is **not** read-only for Forms; the "read-only by design" wording in `PERMISSIONS.md` is corrected for this collection set. Submission ownership is additionally enforced by the `assertCreateOwnership` create-guard hook (perm row-filters are no-ops on CREATE — see the 2026-05-31 High note) plus the migration-086/088 `form_submissions` guard triggers (search_path-pinned in migration 101).

### 2026-06-10 — Deep audit remediation

Cross-cutting deep audit of the scheduling/permissions surfaces plus a doc-drift reconciliation. Findings remediated below; permissions live in `setup-permissions.mjs` (canonical), schema fixes in migrations 101–103 (schema-only, no perm rows). `PERMISSIONS.md` updated the same pass.

**Permissions**
- **Public `events` row-scope** (`setup-permissions.mjs`): the public read was field-restricted (`PUBLIC_EVENT_FIELDS`) but **not row-restricted** (filter `null`), so anon could read EVERY event's title — including team-internal events (a tournament scoped to one team) — by hitting `/items/events` directly. The `/kscw/public/events` endpoint already filtered team-/member-scoped events server-side, but the raw collection read had no such guard. Scoped to club-wide event types `{ event_type: { _in: ['verein', 'tournament'] } }`, mirroring the Member `EVENTS_VISIBLE` club-wide branch. (A club-wide-TYPE event that is also team-scoped via `events_teams` is still excluded by the `/public/events` endpoint the website uses; this closes the type-axis leak on the direct read.)

**Schema (migrations 101–103, idempotent, schema-only)**
- **`search_path` hardening regressions** (migration **101**): three trigger functions created *after* the migration-071 sweep shipped with a plain `$$ LANGUAGE plpgsql;` and no `SET search_path` — `members_prevent_email_blanking()` (059), `trg_form_submissions_guard()` (086), `trg_form_submissions_update_guard()` (088). All reference unqualified public tables (schema-shadowing hijack vector). Re-pinned `SET search_path = public` via `ALTER FUNCTION` (body-preserving), matching 001/043/050/071.
- **Guest-block numeric-cast bypass** (migration **102**): `participations.activity_id` is `varchar(255)` but `trg_participations_guest_block` (050) resolved the game's team with an *implicit* `varchar→int` cast (`WHERE id = NEW.activity_id`). A non-numeric `activity_id` would make the cast error or the lookup find nothing → `v_team IS NULL` → the guest block silently skipped (a guest could confirm a game). Now gated on `NEW.activity_id ~ '^[0-9]+$'` with an explicit `::integer` cast before the lookup; all other logic (team-scope join, exception) preserved byte-for-byte, so valid numeric game participations behave identically.
- **Confirmed derby left hostless on team delete** (migration **103**): `game_scheduling_derbies.leg1_home_team` / `leg2_home_team` reference `teams(id) ON DELETE SET NULL` (090), so deleting a host team nulled the column while leaving `confirmed = true` — a confirmed Art. 27 anchor with no home team, which breaks the home-slot/away-date clamping for both teams. New `BEFORE DELETE` trigger on `teams` un-confirms (`confirmed = false`) and clears the host pointer on any derby the deleted team hosts. Runs in the same transaction as the migration-003 delete-protection guard, so an aborted delete rolls the un-confirm back with it.

**Smoke test** (`smoke-test.mjs`): added Member-token read assertions for the collections whose lost read-row silently empties `loadTeamContext` / HomePage (the 2026-06-07 `fine_rules` incident class) — `teams_coaches` + `teams_responsibles` (fanned out in the same `loadTeamContext` `Promise.all` as `member_teams`), `fine_rules`, `rankings`, `forms`. Conversations (inbox unread badge + list) are probed via the real `/kscw/messaging/conversations` endpoint, since there is deliberately no Member direct `/items/conversations` read grant.

**Docs** (`PERMISSIONS.md`): reconciled six rows where the doc had drifted from the authoritative script — `sv_vm_check` Member read is REVOKED (endpoint-only), public `directus_files` read is `folder _null` (env approach dropped), `member_teams` Member read returns `*` incl. `guest_level`, `event_sessions` Member read is unfiltered cross-club, LEADER `absences` read is the coach/TR-team scope, LEADER `user_logs` read is REVOKED. Plus the new Public `events` row filter and migrations 101–103.

**Cross-cutting hardening landed in adjacent work this cycle** (recorded here for the dedup shield; details in the changelog): scheduling away-date blocking moved to `timestamptz` semantics; season-cutover (Vor-/Rückrunde + invite cutoff) alignment; spielplaner write/read scoping tightened to per-team (`spielplaner_assignments`); fixed invite-expiry (30.06 VolleyManager cutoff replacing the rolling 90-day TTL, migration 094) + invite "sent" tracking (099); `sanitize-html.js` allowlist applied to the scheduling/announcement email paths. The above migrations + perms + smoke are the security-relevant slice of that cycle.

**Workers deployed (2026-06-10)** — the two CF Workers carrying prior + current hardening went live via `wrangler deploy` (scoped CF API token): `kscw-push` (version `db9e3e33` — constant-time bearer compare, fail-closed `AUTH_SECRET`, per-IP rate limit, push-endpoint host allowlist) and `kscw-sentry-tunnel` (version `13bd83f0` — request size cap + per-IP rate limit). `AUTH_SECRET` confirmed present on the push worker so the fail-closed guard is satisfied; unauth → 401 verified live. Closes the 2026-05-31 "Remaining (1)".

### 2026-05-31 — Multi-agent security audit + remediation (branch `security-fixes`)

Full-repo automated audit (security + permissions + code-quality) across `wiedisync` and `kscw-website`, with adversarial verification of every critical/high finding. Reports: `SECURITY_AUDIT.md` (both repos). 0 critical confirmed; 3 high, 11 medium, 11 low (wiedisync) + 2 high, 2 medium, 1 low (kscw-website). All code-fixable items below remediated on branch `security-fixes`.

**Backend deployed + verified on DEV 2026-05-31:** migrations 070–073 applied (psql-verified: 0 leftover anon/auth RLS read policies, `search_path` pinned on the 5 functions, `security_invoker=true` restored on the PII/stats views, `password_reset_tokens` table created); permissions reconciled (383, 0 errors); extensions deployed; `db:smoke:dev` 19/19; backend security regression suite green (9/9 runnable — password-reset/​set-password hardening, public/team field strip, no-PII-leak public read, and the member-impersonation guard which **caught a real bug**, see High note below). **Backend DEPLOYED + verified on PROD 2026-05-31:** snapshot taken; migrations 070–073 applied + psql-verified on `directus.kscw.ch` (0 leftover anon/auth RLS read policies, `password_reset_tokens` created, 5 funcs `search_path`-pinned, 4 views `security_invoker`); permissions reconciled (383, 0 errors); extensions deployed + healthy (endpoints + ownership-guard hook loaded); backend security regression suite **8/8** against prod; `SCHEMA.sql` baseline regenerated from prod and committed. Frontend (wiedisync app OAuth-token strip + kscw-website XSS) merged to `prod` and pushed — CF Pages builds both. **Remaining:** (1) the **push-worker hardening** (`workers/push` fail-closed `AUTH_SECRET` + rate-limit + exact-origin CORS) — **DEPLOYED 2026-06-10** (see the 2026-06-10 entry above); both `kscw-push` and `kscw-sentry-tunnel` are now live with their hardening. (2) Google Maps key GCP lockdown (operational — see "Open / accepted"). The public `directus_files` /assets PII leak was closed on prod 2026-05-31 (migration 074 + folder-less read scope + feedback quarantine hook; verified anon `/assets/<feedback screenshot>` 200 → 403, public photos still 200).

**High**
- **Website-Admin IDOR over members + participations** (`wadmin.js`): `mixed_turnier` section listed `members`/`participations`, which the generic `/wadmin/:section/items/:collection` routes serve with `accountability:{admin:true}` (RLS-bypass). Removed both — section now scoped to `mixed_tournament_signups` only. Test updated (`__tests__/wadmin.test.js`) to lock in the secure contract.
- **Password-reset minted a static API token** (`password-reset.js`, `index.js` `/set-password`, migration **073**): the flow wrote a value into `directus_users.token` (Directus's full-privilege static API credential) and mailed it. Replaced with a dedicated **backend-only** `password_reset_tokens` table storing only a SHA-256 hash of a 256-bit secret, 1-hour TTL, single-use. The `/set-password` Mode-2 consumer now validates against it (hash lookup → expiry → delete-before-use). The emailed link is no longer an API credential.
- **Unfiltered Member create permissions** (`setup-permissions.mjs` + `kscw-hooks/index.js`): `participations`/`absences`/`poll_votes`/`push_subscriptions`/`scorer_delegations`/`carpools`/`carpool_passengers`/`team_requests` `create` were unfiltered → impersonation (fake absences triggered migration-038's RSVP-decline cascade for the victim). **Important — verified on dev 2026-05-31:** Directus enforces NEITHER the `permissions` row-filter NOR a relational `validation` filter on CREATE (no existing row to match; a `member.user == $CURRENT_USER` validation can't be resolved against the payload and rejects *all* creates). The first-pass fix (self-scope filter in the create `permissions`) was therefore a no-op — an impersonating create still returned 200. **Enforcement now lives in a `kscw-hooks` `*.items.create` ownership guard** (`assertCreateOwnership`): pass-through for system writes (crons) + admins; self for everyone; coach/TR of the member's team may also write for participations/absences (roster editing); strictly-personal collections are self-only. Re-tested on dev: impersonation now blocked, legitimate own-creates + smoke still pass. (Blocked impersonations surface as 500 via the project's `kscwScopeError` plain-Error pattern, same as the other hook guards — only fires on an actual impersonation attempt, never the normal self-RSVP UI path.)

**Medium**
- **Mass-notify abuse** (`event-notify.js`): added per-(user,event) rate limit (1/10min); leader-only coach/TR callers are now scoped to the team(s) they actually lead (no club-wide `invited_roles`/`invited_members` expansion); `send_email:true` gated to admin/sport-admin/creator. **Behaviour change** — coaches/TRs can no longer send the event email blast or fan out beyond their own teams.
- **Privacy projection bypass** (`kscw-hooks/index.js`): the `members.items.read` redaction now sources `hide_email`/`hide_phone`/`birthdate_visibility`/`user` from the DB per row and redacts unconditionally on the caller's field projection (was bypassable by requesting a narrow `fields=`). Fails closed.
- **Public members read ignored `website_visible`** (`setup-permissions.mjs`): public read scoped to `{ website_visible: { _eq: true } }`.
- **Wide-open `USING(true)` RLS** (migration **070**): dropped all `anon_read_*`/`auth_read_*` PostgREST-era SELECT policies (Directus connects as `supabase_admin`, so no live caller affected; defense-in-depth on top of the migration-011 GRANT revoke).
- **`/set-password` OTP accepted any verified row** (`index.js`): Mode-3 now requires the verification to be fresh (`expires_at > now()`, the original 10-min OTP window) in addition to `verified=true`; single-use delete retained.
- **Event-invite email unescaped** (`event-notify.js`): `event.description` now `escHtml()`-escaped before HTML interpolation.
- **OAuth/Google SSO login REMOVED entirely (2026-06-18)** — `OAuthCallbackPage.tsx`, `useAuth.loginWithOAuth`, the `/auth/callback` route and the `AUTH_GOOGLE_*` / `AUTH_PROVIDERS` Directus config are deleted. The OAuth findings here and the `oauth_pending`/`state`-nonce CSRF + state-round-trip residual-gap notes below are now **MOOT**. Historical detail retained for the audit trail:
- **OAuth tokens in URL** (`OAuthCallbackPage.tsx`): tokens scrubbed from the address bar via `history.replaceState` immediately after read; `state` nonce check tightened to strict equality (absent/mismatched rejected).
- **Google Maps key client-exposure** (`useGooglePlacesSearch.ts`): documented as inherently client-side; operational lockdown required (see below).
- **Push worker fail-open** (`workers/push/src/index.ts`): explicit fail-closed guard if `AUTH_SECRET` is unset/short; subscription-list cap + shape/host allowlist validation; per-IP rate limit.

**Low / Info**
- Public `directus_files` /assets leak closed: read scoped to FOLDER-LESS files (`{folder:{_null:true}}`, `setup-permissions.mjs`); feedback screenshots relocated to a private folder (migration **074**) + kept there by a kscw-hooks `feedback.items.*` quarantine hook. `/assets/:id` honours the file's row read filter, so anon still fetches root-level team/sponsor/member photos but a foldered feedback screenshot → 403. Verified on prod (was 200 → 403). (The earlier `PUBLIC_FILES_FOLDER` env approach was dropped — folder-less scoping fits the actual asset layout and needs no env/infra change.)
- `GET /public/team/:id` no longer leaks `features_enabled`/`dashboard_*`/`bb_source_id`/`captain` — `index.js`.
- Function `search_path` re-pinned via `ALTER FUNCTION` on `trg_trainings_notify`, `fn_messaging_dm_autoaccept`, and the migration-069 fines helpers (migration **071**, body-preserving).
- `security_invoker=true` restored on `members_with_photo` + `stats_*` views (migration **072**).
- CSP hardened (`public/_headers`): `object-src 'none'`, `base-uri 'self'`, report-uri added (`style-src 'unsafe-inline'` retained — Tailwind).
- `exceljs` transitive vulns (`tmp`, `uuid`) pinned via `package.json` `overrides` (needs `npm install`).
- TweetCard `dangerouslySetInnerHTML` wrapped in `DOMPurify.sanitize` (`tweet-card.tsx`).
- **kscw-website**: homepage event description rendered as plain text (`de|en/index.astro`); calendar JSON island `<`/`>`/`&` escaped against `</script>` breakout (`de|en/weiteres/kalender.astro`); client-side regex sanitiser replaced with `textContent` (`calendar-grid.ts`); RSS slug `encodeURIComponent` + XML-escaped (`feed.xml.ts`); CSP tightened (`public/_headers`).

### 2026-05-12 — Deep audit Low-tier + hygiene (v4.8.8)

Closes the remaining open items from the 2026-05-12 audit beyond what v4.8.3 and v4.8.5 already shipped.

**Custom hooks (`directus/extensions/kscw-hooks/src/`)**
- New `sanitize-html.js` — allowlist HTML sanitizer (pure JS, no deps). Strips `<script>`, `<style>`, `<iframe>`, `<img>`, `<form>`, `<svg>`, every event handler, every inline style, and every attribute except `href` on `<a>` (https-only or same-origin). Applied to the announcement email body before fanout (`notifyAnnouncementPublished`). Closes audit finding #14 — a compromised Sport Admin can no longer ship phishing redirects, tracking pixels, or `<a href="javascript:…">` payloads to the whole sport's mailbox.
- `index.js` absence-auto-decline + auto-confirm paths — every `EXTRACT(DOW FROM DATE '${dateStr}')` template-string now parameterizes the date through the driver as `EXTRACT(DOW FROM ?::date)`. `autoDeclineForAbsence` additionally coerces the `daysOfWeek` jsonb array to integers in the 0..6 range before interpolating into the `IN (…)` list. Defense-in-depth — the `safeDateStr()` regex and `jsonb` column already protect in practice, but the new shape removes the string-concatenation pattern entirely. Closes audit finding #9.

**Audit log (`directus/extensions/kscw-hooks/src/audit.js`)**
- Per-collection `REDACTED_FIELDS` map: payload values for `members.ahv_nummer`, `birthdate`, `email`, `phone`, `license_nr`, postal address, `directus_users` credentials, and `push_subscriptions` keys are replaced with `[REDACTED]` before being written to `user_logs.data`. `reports_filed`, `messages`, `message_requests` payloads collapse to `{_redacted: true, _fields: [...]}` so an audit reviewer can see WHICH columns moved without exfiltrating the row content. Field names — and hence the "what changed" signal — survive.
- New 90-day purge cron (daily at 02:15 UTC) deletes `user_logs` rows older than 90 days. The audit-log UI advertises a 90-day window via `ARCHIVE_DAYS`; until now the rows accumulated indefinitely. Closes audit finding #11.

**SQL — migration 052**
- `fn_messaging_dm_autoaccept` drops the `other_mt.season = NEW.season` predicate. Cross-season teammates now auto-accept pending DM requests the same way same-season teammates do. Was producing a confusing "we're on the same team but my request is still pending" state at season boundaries. Closes audit finding #25.

**Docs**
- `PERMISSIONS.md` header bumped to migration 052.
- `SCHEMA.sql` baseline regenerated from prod (was 7 migrations behind; closes audit finding #24).

### 2026-05-12 — Deep audit + remediation (v4.8.3)

Deep audit run post-v4.8.1 (LEADER-per-user backfill) and v4.8.2 (LEADER read scope for trainings/events). Six parallel research agents over the same six surfaces. Eight Fix-this-week findings closed.

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- `event-notify.js` `POST /kscw/events/:id/notify` — previously unauthenticated. Now requires `req.accountability.user` AND callers must be Directus admin, KSCW sport-admin role, the event creator, or a coach/TR of one of the event's teams. Closes a mass push/email amplification vector exploitable by any anonymous HTTP client.
- `audit.js` `requireSuperuser()` — replaced the `directus_roles.name = 'Superuser'` string match (bypassable by renaming any role) with `req.accountability.admin === true`. The stable policy-derived admin flag is the right gate; the role name is mutable.
- `registration.js` admin notification email — `reg.bemerkungen` now routed through `escHtml()` from `email-template.js`. Public registrants can no longer inject HTML/script into the email body delivered to admin clients. `escHtml` exported from `email-template.js` so other endpoints can reuse it.
- `web-push.js` `/subscribe` — new `validatePushEndpoint()` rejects non-https, malformed URLs, private/loopback/link-local hosts (IPv4 + IPv6), and any host outside an allow-list of known browser push providers (FCM, APNs, Mozilla autopush, WNS). Closes the SSRF path where an authenticated member could coerce the CF push Worker to issue outbound requests to attacker-chosen hosts.

**Custom hooks (`directus/extensions/kscw-hooks/src/index.js`)**
- Team-join-request email body (5 locales) — `member.first_name`, `member.last_name`, and `teamName` are now routed through `escapeEmailHtml()` before interpolation into the `intro` HTML. Closes a stored-HTML injection path via member registration names.

**Frontend (`src/`)**
- `OAuthCallbackPage.tsx` + `useAuth.tsx loginWithOAuth` — `oauth_pending` sentinel TTL tightened from 5 min → 2 min, and a `state=<nonce>` query param is now embedded into the redirect URL handed to Directus. If Directus preserves our query string when appending `?access_token=…` (which most OAuth provider integrations do), the callback verifies the round-tripped state against the stored nonce — full CSRF binding. If Directus strips it, the shorter TTL still narrows the residual window (documented as a known residual gap below).

**Permissions (`directus/scripts/setup-permissions.mjs`) — LEADER policy scope tightening**
- `members.read` — was unfiltered full-row read across the entire club. Replaced with a `COACH_TEAM_MEMBERS`-scoped row + a new `LEADER_TEAM_MEMBER_FIELDS` field whitelist (all of `MEMBER_OWN_READABLE` minus `ahv_nummer`). Coaches see contact info (email/phone/address/birthdate) only for members on teams they coach or TR. Out-of-team members continue to be readable via the MEMBER policy's existing `MEMBER_VISIBLE_FIELDS` whitelist (no PII).
- `games.update` — was unfiltered. Now scoped to coach/TR of the game's `kscw_team` via the standard M2M filter pattern.
- `trainings.update` — was unfiltered. Now uses the same `COACH_OR_TR_OF_TEAM` filter already applied to `trainings.read`/`delete`.
- `events.update` — was unfiltered. Now mirrors the existing `events.delete` filter (creator OR coach/TR of an invited team).
- `participations.read` + `participations.update` — was unfiltered full-club RSVP dump. Now scoped via `participation.member.member_teams.team.{coach|team_responsible}`.
- `absences.read` — was unfiltered full-club absence dump. Same scope as participations.
- `user_logs.read` — REMOVED entirely from LEADER. The audit log endpoint at `/kscw/admin/audit` is the only sanctioned access path and is admin-only.

**SQL — migration 050**
- `trg_participations_guest_block` — was checking `guest_level > 0` across the member's ANY team. Now joins to `games.kscw_team` and checks only the row for the game's team. Closes a correctness defect that silently 400'd legit RSVPs for any senior who guest-played for a youth team.

**Smoke test (`directus/scripts/smoke-test.mjs`)**
- New optional Coach-token pass: reads `DIRECTUS_DEV_USER_TOKEN_COACH` / `DIRECTUS_PROD_USER_TOKEN_COACH` from `.env.local`. Asserts `participations.read` returns only rows whose member is reachable via the coach's teams, and `user_logs` direct read 403s. Skipped silently if no coach token is present, so existing deploys don't break.

**Residual gaps documented**
- OAuth nonce round-trip depends on Directus preserving our `state` query param through the OAuth provider redirect. If Directus strips it the TTL (now 2 min) is the only defence. Full backend support for `state` belongs in a separate enhancement.

### 2026-05-06 (continued) — v4.5.2 closes the last Critical

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- New `sv-licence.js` — `GET /kscw/sv-licence/me` joins by `members.license_nr → sv_vm_check.association_id` and returns the 11-field whitelist for the caller's own row only. Replaces direct collection access.
- New `migrations-status.js` — admin-only `GET /kscw/admin/migrations-status` exposes `{applied, pending, latest, latest_applied_at}` for the InfraHealth dashboard. Drift detection without giving up the admin token.

**Frontend (`src/`)**
- `ProfilePage.tsx` switched to `kscwApi('/sv-licence/me')`. No remaining direct `sv_vm_check` reads from non-admin code paths.
- `InfraHealthPage.tsx` shows the migration tracker card.

**Permissions (`directus/scripts/setup-permissions.mjs`)**
- KSCW Member's `sv_vm_check.read` row removed entirely. Direct `GET /items/sv_vm_check` returns 403 for Members. Sport Admin retains CRUD.
- Auto-loads `.env.local` and resolves `DIRECTUS_DEV_TOKEN` / `DIRECTUS_PROD_TOKEN` by URL — no env-wrapper noise on `npm run db:setup-perms:*`.

**Smoke test (`directus/scripts/smoke-test.mjs`)**
- Token-only auth. New asserts: `sv_vm_check direct (must 403)` + `kscw/sv-licence/me`. Re-granting Member read on the collection now turns the next deploy red.

**Ops**
- Web push `VAPID_PUBLIC_KEY` set on **both** dev + prod containers; missing-on-dev gap closed (`docker run` recreate, since `docker restart` doesn't reload env-file).
- Live admin password reconciled against `/opt/directus-kscw{,-dev}/.env` on both VPS instances. No more "fresh container start could divert the bootstrap user" risk.
- `npm run db:fresh-install:dev|prod` script added (`SCHEMA.sql → migrate → setup-perms → smoke`). Single command for clean-DB rebuild.
- `.playwright-mcp/` added to `.gitignore` (browser-snapshot scratch dumps, not for the repo).

### 2026-05-06 — Deep audit + remediation

**Frontend (`src/`)**
- Sentry Session Replay now masks all text + inputs and denies network details for `directus.kscw.ch` (`src/lib/sentry.ts`).
- OAuth callback rejects token params unless an `oauth_pending` sentinel was set by `loginWithOAuth` within the last 5 min (`src/modules/auth/OAuthCallbackPage.tsx`, `src/hooks/useAuth.tsx`).
- Sponsor `website_url` and BugfixDashboard `pr_url` routed through `sanitizeUrl()` (`src/utils/sanitizeUrl.ts`).
- `RichText` DOMPurify call has explicit `ALLOWED_URI_REGEXP` for http(s) + same-origin only.
- `public/sw.js` pins notification-click URLs to our origin.

**Push worker (`workers/push/`)**
- Bearer-secret comparison switched from `!==` to constant-time XOR-fold (`timingSafeEqualStr` helper).

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- `newsletter.js` `verifyTurnstile` now fails closed when `TURNSTILE_SECRET` is unset (was returning `true`).
- `game-scheduling.js` no longer returns the raw token in the `/register` response body — only emailed.
- `game-scheduling.js` `book-home` wrapped in a transaction with `SELECT … FOR UPDATE` and a cross-team check (`slot.kscw_team === opponent.kscw_team`). Closes both the TOCTOU race and the cross-team sabotage path.
- `index.js` exposes shared helpers `capPayload(payload, max=500)` and `ipRateLimit(map, req, n, ms)`.
- `index.js` `client-error` payload is now capped via `capPayload` (was uncapped → disk fill via 30 req/min).
- `index.js` `team-invites/claim` rate-limited to 5 attempts / 15 min / IP.
- `web-push.js` — removed hardcoded `VAPID_PUBLIC_KEY` fallback; endpoint returns 503 if env unset.

**Custom hooks (`directus/extensions/kscw-hooks/src/index.js`)**
- Announcement audience guard now also blocks `audience_sport`-unset posts unless caller is full admin / superuser. Sport-scoped admins can no longer bypass scope by omitting the field.
- Filter on `members.items.update` strips the `role` field unless caller is admin / superuser. Defense in depth on top of Directus field-level perms.
- Junction-delete pending Maps drained via try/finally + key snapshot — error in `syncMemberRole` no longer leaks orphaned entries.
- `escapeEmailHtml` helper introduced; admin-controlled `rejection_reason` now escaped before email interpolation.
- `clubdesk-update.js` `buildChangesTable` HTML-escapes member-supplied `old_value` / `new_value` before interpolating into the admin email.

**SQL — migration 043**
- `sv_vm_check.read` row-scoped to own member (was unfiltered → cross-member SV licence dump).
- `tasks.read` scoped to assigned/claimed-by self.
- `feedback.read` scoped to own submissions.
- `teams.update` row-scoped for KSCW Coach + KSCW Team Responsible.
- `teams_sponsors.sponsors_id` FK with ON DELETE CASCADE (closes the deferred half of migration 037).
- `member_teams.read` field set narrowed to `id, member, team, season` (drops `guest_level` from cross-team reads).
- `SET search_path = public` added to all 8 messaging trigger functions (`fn_messaging_*`, `messaging_protect_sentinel`).
- `bugfix_jobs` explicit `REVOKE ALL FROM anon, authenticated`.

**Consolidation**
- `directus/scripts/setup-permissions.mjs` rebuilt to match the post-043 live state. Header banner documents the dual-source (script + migrations) policy.

---

## Open / accepted / out-of-scope

| Item | Status | Why |
|---|---|---|
| Cross-member `members.user` UUID readable (PERM-3, 2026-06-25) | Accepted | The directus_users UUID is load-bearing: `ParticipationRosterModal` maps other members' `user` → display name to attribute `last_*_edited_by`. UUIDs are not credentials; removing it breaks roster edit-attribution for a low-tier enumeration finding. |
| LEADER reads `game_scheduling_opponents`/`bookings` club-wide (PERM-4, 2026-06-25) | Accepted | Third-party opponent scheduler contacts (not KSCW-member PII); scoping to the caller's teams would break the cross-team scheduling overlay coaches rely on. Internal-planning data, low sensitivity. |
| `/terminplanung/team-calendar/:teamId` + `/cross-team-conflicts` readable by any Member (EP-SCH-1, 2026-06-25) | Accepted | The team pages are member-facing by design; both endpoints deliberately exclude all opponent contact PII and return only slot dates/halls. Gating would break member-facing team calendars. |
| kscw-website `script-src 'unsafe-inline'` (WEB-SEC-2 / WEB-ADM-4, 2026-06-25) | Deferred | Same item as the existing `unsafe-inline` row below — removing it needs a per-build nonce/hash step on a static CF Pages site with many `is:inline` blocks. The actual stored-XSS sinks that would exploit it are now all closed at source (WEB-ADM-3 / WEB-SEC-3 / WEB-SEC-7) + DOMPurify is local, so this is the safe mitigation. Revisit with Astro experimental CSP. |
| Broadcast TOCTOU on `sent_at` rate-check | Accepted soft-limit | Code comment in `broadcast-helpers.js:364` explicitly accepts the race; the audit table catches abuse. Re-evaluate if abuse is observed. |
| `iCal` feeds (`/kscw/ical/*`) public | Accepted | Designed for calendar embedding. No member PII. |
| In-memory `X-Forwarded-For` rate limiters | Accepted | Only safe behind CF Tunnel — documented in this file. If VPS ports ever go public, all limiters collapse simultaneously and need replacing with a Postgres / Redis store. |
| `Math.max(rs)`-style PKCS8 key wrapping in `workers/push/src/index.ts` | Accepted | Documented inline; used to handle WebCrypto's lack of raw P-256 import. Audited 2026-04-04. |
| Notification triggers fan out without re-checking caller identity | Accepted | Triggers run after Directus RBAC has already gated the parent INSERT/UPDATE. If we ever grant `games`/`trainings`/`events` direct DML to a non-admin role at the PG level, this assumption breaks. |
| `tasks` schema lacks `team` FK | Accepted (43 fixed read-side) | Migration 035 noted the design gap. Read scope now uses assignee FKs which is the right substitute; create a migration that adds `team` if cross-team queries are ever needed. |
| `pgbouncer.get_auth()` lacks `SET search_path = ''` on live prod | Accepted (Supabase-managed) | Audit 2026-05-12 finding #23. Verified `proconfig IS NULL` on live. Patching it from our side risks rollback the next time Supabase bumps the database image, and the function is only callable by the local `pgbouncer` user — not reachable from external traffic. Re-audit if Supabase ever moves the function to a user-modifiable schema. |
| Public `directus_files` /assets PII leak (2026-05-31) | **Resolved** | Anon could fetch any file via `/assets/:id` (incl. feedback screenshots — verified 200 on prod). Fixed with NO env var: public read scoped to folder-less files; feedback screenshots relocated to a private folder (migration 074) + a quarantine hook keeps future ones there. Deployed + verified on dev + prod (anon `/assets/<feedback>` 200 → 403; public photos still 200). Note: anon `/items/directus_files` *listing* is denied regardless (system-collection listing not granted to Public) — `/assets` was the actual leak path. |
| Google Places key referrer lockdown (2026-05-31) | **Operational — required** | `VITE_GOOGLE_MAPS_API_KEY` ships in the client bundle (unavoidable for Places Autocomplete). Lock it down in Google Cloud Console: HTTP-referrer restriction to the app domains, restricted to the Places API only, daily quota cap, no billing/other-API scope. Stronger fix (deferred): proxy Places through an authenticated Directus endpoint. |
| Push-worker `AUTH_SECRET` (2026-05-31) | **Operational — required** | `workers/push` now fails closed if `AUTH_SECRET` is unset/short. Ensure a ≥32-char secret is set via `wrangler secret put AUTH_SECRET` on every worker/env, or `/push` returns 500 by design. |
| `package.json` overrides + SCHEMA.sql baseline (2026-05-31) | **Operational — required** | Run `npm install` to apply the `tmp`/`uuid` overrides into the lockfile, then `npm audit --omit=dev`. After migrations 070–073, run `npm run db:baseline:dev`/`:prod` to regenerate `SCHEMA.sql` (else fresh installs re-introduce the regressions and miss `password_reset_tokens`). |
| PocketBase JWT in git history (2026-05-31, Low) | **Closed — dead credential** | A `.claude/settings.json` committed in 3 historical commits held a PocketBase auth JWT. PocketBase is **decommissioned** (the Directus migration is complete — there is no PocketBase instance to authenticate against), so the token is inert: nothing to rotate. Current tree is clean (`.claude/settings.json` is gitignored and absent; no tracked file contains it). Optional hygiene only — physically purging it from history needs `git filter-repo` + a force-push to `prod` (disruptive; not warranted for a dead credential). |
| Member-create self-scope negative smoke test (2026-05-31) | **Recommended** | `db:smoke` currently exercises only legitimate (own-member) creates. Add a NEGATIVE assertion — Member attempts `participations`/`absences` create with `member` = another member → expect 403 — so the self-scope `permissions` filter is confirmed to actually block impersonation, not just pass legit creates. |
| Access/refresh tokens in localStorage (2026-05-31, Medium) | Accepted (mitigated) | Deliberate for standalone-PWA persistence (iOS clears sessionStorage). Compensating control: strict CSP (no `script-src 'unsafe-inline'`) + DOMPurify on all HTML sinks; tokens are never logged. Deferred follow-up documented in `api.ts`: migrate to Directus cookie session mode (httpOnly) — needs backend CORS-credentials + CSRF work. |
| `style-src 'unsafe-inline'` (both repos) + `script-src 'unsafe-inline'` (kscw-website) | Accepted | wiedisync: Tailwind/React emit runtime inline `style=`; no nonce pipeline. kscw-website: 83 `is:inline` script blocks on a static CF Pages site with no per-build nonce. The two stored-XSS sinks that would have exploited this are closed at source. Removing `unsafe-inline` needs a nonce/hash build step (deferred). |
| Backend CORS / Directus session mode (not in repo) | Verify | Confirm on the VPS that Directus `CORS_ORIGIN` is an exact allowlist (no `*`) and session/auth mode matches the token-in-header model. Document the values in `INFRA.md`. |
| Public-forms member-directory Flow `531dc3c2-…` (#18, 2026-07-02) | **Open — server-side required** | The kscw-website autocomplete hits an unauthenticated Directus Flow that returns the full roster (bypassing the `website_visible`+adults public scope). Client hardened, but the Flow itself must be scoped to the public policy (no internal `id`, opted-out/minors excluded). Flows live in Directus, not the repo — fix in the admin UI. |
| `nodemailer` nested in `imapflow`/`mailparser` (#38, 2026-07-02) | Accepted (not reachable) | Direct send path bumped to 9.0.3. The transitive copy inside imapflow/mailparser is IMAP read/parse, not the vulnerable `sendMail` raw vector; forcing it onto nodemailer 9 via an override risks the LIVE mailbox. Revisit when those packages publish nodemailer-9 support. |
| ClubDesk sync-up commit on prod (#1/#2, 2026-07-02) | Operational — gated | Up-sync now dry-runs first; `CLUBDESK_UP_COMMIT=1` must NOT be set on prod until the ClubDesk import-wizard's blank-overwrite + new-contact-duplicate behavior is validated against a throwaway contact (memory-tracked spike). |
| `never_dun` backfill on shared/family emails (#20, 2026-07-02) | Open — manual review | Migration 146 email-matched the `never_dun` backfill, which may have flagged the wrong member where two share an email. Already applied; needs a manual DB review to re-decide affected rows (auto-reverting risks clearing legitimate opt-outs). |
| Migration 149 not self-wrapped (#39, 2026-07-02, Info) | Accepted (applied) | 149 has two DO blocks with no BEGIN/COMMIT under a runner that doesn't wrap files; already applied (sha-locked, can't edit). New migrations (163–165) self-wrap; fix-forward only if 149 is ever revisited. |

---

## Recurring gotchas

These have bitten before and will bite again:

1. **`setup-permissions.mjs` vs. SQL migrations.** See `CLAUDE.md → "Migration & Permission Policy"` for the authoritative contract (permissions live ONLY in the script; migrations are schema-only). Security-relevant gotcha to keep in mind: fresh installs run only the script, so a permission row that was hand-applied to prod but never folded into the script silently rolls back on the next fresh build (see `feedback_prod_is_canonical.md` memory).

2. **M2M junction permissions.** Flat-id payloads trigger junction-PK lookup (403 for non-admin); use `[{ teams_id: 3 }]` shape. Grant junction CRUD AND base CRUD as a pair. Without both, frontend operations hit 403 silently because `Promise.all` in `loadTeamContext` swallows individual failures.

3. **`$CURRENT_USER` is a UUID; Directus FKs to `members` are integers.** Naive `{ user: { _eq: '$CURRENT_USER' } }` filters on int FKs throw "Invalid numeric value". Always traverse through `members.user` (see `OWN_DU` in `setup-permissions.mjs`).

4. **`_neq` excludes NULLs in Directus.** Use `_or` with `_null: true` if you want NULL rows to match.

5. **Junction tables with `ON DELETE SET NULL`.** Directus serialises the resulting `null` integer as the literal string `"null"` in `_in` filters → 400 errors. All junctions should be `ON DELETE CASCADE`. Migrations 021 + 037 + 043 cover the known set.

6. **Hooks running as admin on user-controlled payloads.** Action hooks that use `database` or `services` with `accountability: null` bypass Directus RBAC entirely. Always re-verify the caller identity before privileged side effects (role-sync, broadcast fanout, dateStr-in-raw-SQL).

7. **Email/HTML interpolation.** Any human-controlled string ending up in an `html:` mail body needs HTML escaping. Helpers: `escapeEmailHtml` in `kscw-hooks/src/index.js`, `escHtml` in `clubdesk-update.js`. Don't add new email templates without one.

8. **Tokenized public flows.** Standard pattern: 16+ bytes of `crypto.randomBytes`, single-use enforced atomically (transaction + `FOR UPDATE`), expiry, revoke endpoint, audit log on issuance. Cross-resource ownership check on every consume.

9. **CSP `style-src 'unsafe-inline'`.** Required by Tailwind v4. Documented gap. Rules out CSS-based exfil mitigations from CSP — be vigilant about user-controlled style attributes.

10. **Sentry replay capture rate is 100% on error.** Always set `maskAllText: true` + `maskAllInputs: true` if any new replay integration is added.

11. **Push notifications need both ends to share VAPID public key.** Worker reads it from `wrangler secret` and Directus reads from `process.env.VAPID_PUBLIC_KEY`. A split-brain (e.g. via the formerly-hardcoded fallback) makes every push silently fail.

---

## Audit cadence

Run the deep audit after any of:

- A milestone bump in `package.json` (`*.0.0` or `*.X.0`).
- A new role / policy addition.
- Any custom endpoint going from auth-required to public (or vice versa).
- A new third-party integration.

The audit pattern is captured as a Claude Code skill — invoke `/kscw-security-audit` (lives in `~/.claude/skills/`). The skill dispatches 6 parallel agents over the same surfaces this doc covers.

After each audit, append a `### YYYY-MM-DD — Deep audit + remediation` block above and check off / move items between "Hardening completed" and "Open / accepted".

---

## Continuous verification (process — not findings)

The deep audit catches drift; an always-on guard rail stops new drift from reaching prod. The declarative-permissions / schema-only-migrations / apply-once-tracker / fresh-install contract is authoritative in **`CLAUDE.md → "Migration & Permission Policy"`** (rules 1–6) — don't restate it here. The runbook is `INFRA.md → "Database Deploy Workflow"`.

Security-relevant note that earns its place in this file: `npm run db:deploy:<env>` runs `db:migrate → db:setup-perms → db:smoke`, and the **smoke test is the safety net for the silent-`Promise.all`-empty class** (the 4.4.4 / 2026-06-07 `fine_rules` incidents). `smoke-test.mjs` logs in as a non-admin Member and probes the read-rows whose loss silently empties `loadTeamContext` / HomePage — `teams_coaches`, `teams_responsibles`, `member_teams`, `fine_rules`, `rankings`, `forms` — plus the `/kscw/messaging/conversations` endpoint (there is deliberately no Member direct `/items/conversations` read grant). A re-granted-then-lost permission row turns the next deploy red the same minute it ships.
