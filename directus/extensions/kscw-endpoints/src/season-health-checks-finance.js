/**
 * Season health — finance: dues, fee categories, fines, referee fees, team
 * ledgers. One static SQL per check; see season-health-sql.js for the tokens
 * and season-health-checks.js for the row contract.
 *
 * Domain rules every check here leans on (each one bit somebody once):
 *   - A dues invoice is identified by SUBJECT — 'Mitgliederbeitrag' plus the
 *     season written long ('2026/2027', ClubDesk) or short ('2026/27', native).
 *     Never by fiscal_year (assigned by invoice_date at import; ClubDesk's
 *     July batch sat in the previous FY) and never by fee_category (that is the
 *     CONTACT's category stamped on every invoice, camp fees included).
 *   - Two status vocabularies share finance_invoices.status: native
 *     open|pending_confirmation|partial|paid|cancelled and ClubDesk's German
 *     verbatim ('Gestellt', 'Bezahlt', 'Bezahlt (teilw. abgeschrieben)',
 *     'Teilweise bezahlt', 'Storniert', …). Every status predicate below
 *     handles both.
 *   - Who owes CHF 0 by rule (resolveFeeWaivers + isExemptCategory): category
 *     'Gratis' (member, free) or 'Kein Beitrag' (non-member bucket),
 *     Ehrenmitglied, the vorstand role, coach of an ACTIVE team. A team
 *     responsible is NOT free. Zwischenjahr is deliberately not evaluated.
 *   - Money columns are numeric → strings in JS; every one is selected ::text
 *     and named *_chf so the UI never does arithmetic on them.
 *   - members.dues_paid/_season/_at are trigger-derived (migration 360). The
 *     unpaid check recomputes from the ledger instead of trusting the flag,
 *     and two checks watch the flag itself.
 */
import {
  ACTIVE_TEAM, CORE_PLAYER, REAL_PERSON, MEMBER_COLS, TEAM_COLS, GAME_COLS,
} from './season-health-sql.js'

// ── Local predicates (finance-only; season-health-sql.js is shared and frozen) ──

/** `{{now}}` is a tz-naive Zurich wall-clock — this is the same instant as timestamptz. */
const NOW_TZ = `({{now}} AT TIME ZONE 'Europe/Zurich')`

/** Calendar year the season started (2026 for '2026/27'), from the rollover anchor. */
const SEASON_YEAR = `EXTRACT(YEAR FROM {{rollover}})::int`
/**
 * The subject regex refresh_members_dues_paid() uses, rebuilt from the
 * anchors: season written long ('2026/2027') or short ('2026/27'), not
 * glued to another digit.
 */
const DUES_SEASON_RE = `('(^|[^0-9])' || (${SEASON_YEAR})::text || '/(' || (${SEASON_YEAR} + 1)::text || '|' || lpad(((${SEASON_YEAR} + 1) % 100)::text, 2, '0') || ')([^0-9]|$)')`
/** A membership-dues invoice for THIS season. Alias finance_invoices as `fi`. */
const DUES_INVOICE = `fi.subject ILIKE '%mitgliederbeitrag%' AND fi.subject ~ ${DUES_SEASON_RE}`

/**
 * Status predicates are NULL-safe on purpose: `status` is nullable and every
 * one of them is negated somewhere below, where a NULL would drop the row
 * instead of listing it. Alias finance_invoices as `fi`.
 */
/** Cancelled in either vocabulary. */
const INVOICE_CANCELLED = `(COALESCE(fi.status, '') ILIKE 'storn%' OR COALESCE(fi.status, '') = 'cancelled')`
/** Settled in either vocabulary — mirrors the trigger ('Bezahlt (teilw. abgeschrieben)' counts, 'Teilweise bezahlt' does not). */
const INVOICE_PAID = `(COALESCE(fi.status, '') ILIKE 'bezahlt%' OR COALESCE(fi.status, '') = 'paid')`
/** Still owed: not cancelled, not settled, money outstanding (useFinance.isOpenInvoice). */
const INVOICE_OPEN = `NOT ${INVOICE_CANCELLED} AND NOT ${INVOICE_PAID} AND COALESCE(fi.open_amount, 0) > 0`

// feeBreakdown()'s surcharge gate, copied verbatim from clubdesk-update.js:
// adult categories always owe scorer duty, youth categories only from U16
// (birth year <= this year - 15); intro tiers, Passiv, Gratis never.
const SURCHARGE_ADULT = [
  'VB Erwerbstätige',
  'VB Student*in Meisterschaft', 'VB Studenten/Lehrlinge',
  'BB Erwerbstätige', 'BB Erwerbstätig',
  'BB Erwerbstätige 1. Liga', 'BB Erwerbstätig 1. Liga',
  'BB Lernende/Studierende', 'BB Student/Lehrling', 'BB Studenten/Lehrlinge',
  'BB Lernende/Studierende 1. Liga', 'BB Student/Lehrling 1. Liga',
]
const SURCHARGE_YOUTH = [
  'VB Schüler*in Meisterschaft', 'VB Schüler Meisterschaft',
  'VB Schüler*in Turnier', 'VB Schüler Turnier',
  'BB Jugend Meisterschaft', 'BB Junior:innen', 'BB 2 Trainings',
  'BB Minis Turnier', 'BB Minis', 'BB 1 Trainings',
]
const sqlList = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')
/** feeBreakdown()'s trimmed category key. */
const FEE_CAT = `btrim(COALESCE(m.beitragskategorie, ''))`
/**
 * The rule branch of the CHF 100 surcharge, exactly as feeBreakdown() applies
 * it when fee_surcharge_override is NULL: category eligible (adult always,
 * youth only when U16+ — unknown birthdate never surcharges) AND no licence
 * flag for the category's sport (VB → scorer_vb, else any BB table licence;
 * all five flags are NOT NULL). Alias members as `m`.
 */
const SURCHARGE_DUE = `(
     (${FEE_CAT} IN (${sqlList(SURCHARGE_ADULT)})
      OR (${FEE_CAT} IN (${sqlList(SURCHARGE_YOUTH)})
          AND m.birthdate IS NOT NULL
          AND EXTRACT(YEAR FROM {{today}})::int - EXTRACT(YEAR FROM m.birthdate)::int >= 15))
 AND NOT (CASE WHEN ${FEE_CAT} LIKE 'VB %' THEN m.scorer_vb
               ELSE (m.otr1_bb OR m.otr2_bb OR m.otn1_bb OR m.otn2_bb) END)
)`

/**
 * Owes CHF 0 by rule — resolveFeeWaivers() + the two exempt categories, plus
 * the treasurer's explicit CHF 0: a base override of 0 (migration 308 pinned
 * register totals as base + surcharge=false; 19 active members on dev).
 * ⚠ A base of 0 with the surcharge override left NULL is NOT free: feeBreakdown
 * still applies the rule and bills CHF 100 to an eligible unlicensed member,
 * so the override only counts when the surcharge is waived or cannot land.
 * Alias members as `m`.
 */
const OWES_NOTHING = `(
     lower(${FEE_CAT}) IN ('gratis', 'kein beitrag')
  OR m.register_status = 'Ehrenmitglied'
  OR COALESCE(m.role, '[]'::jsonb) @> '["vorstand"]'::jsonb
  OR (m.fee_base_override IS NOT NULL AND m.fee_base_override <= 0
      AND (m.fee_surcharge_override IS FALSE
           OR (m.fee_surcharge_override IS NULL AND NOT ${SURCHARGE_DUE})))
  OR EXISTS (SELECT 1 FROM teams_coaches tc JOIN teams tt ON tt.id = tc.teams_id AND tt.active WHERE tc.members_id = m.id)
)`
/**
 * A member the club expects dues from: active, a real person, not in a
 * terminal register state, not a gap year (counted elsewhere, never flagged),
 * not free by rule.
 */
const FEE_PAYER = `m.kscw_membership_active
   AND ${REAL_PERSON}
   AND COALESCE(m.register_status, '') NOT IN ('Zwischenjahr', 'Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
   AND NOT ${OWES_NOTHING}`

/** Fiscal year row for the season (label == short season on prod). */
const FY_ID = `(SELECT min(fy.id) FROM finance_fiscal_years fy WHERE fy.label = {{season}})`
/**
 * pickRate() in SQL: an active rate for the member's category, sektion row or
 * category default. Case-insensitive but NOT trimmed — pickRate compares the
 * raw strings, so a category with stray whitespace has no rate there either.
 */
const RATE_FOR_MEMBER = `EXISTS (
  SELECT 1 FROM finance_dues_rates r
   WHERE r.fiscal_year = ${FY_ID} AND r.active
     AND lower(r.category) = lower(COALESCE(m.beitragskategorie, ''))
     AND (NULLIF(r.sektion, '') IS NULL OR lower(r.sektion) = lower(COALESCE(m.sektion, '')))
)`

/** Core roster row on an active team — "is this member a player this season". */
const ON_ROSTER = `EXISTS (
  SELECT 1 FROM member_teams mt JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
   WHERE mt.member = m.id AND ${CORE_PLAYER}
)`

/**
 * Written off in either vocabulary: ClubDesk 'Abgeschrieben' (a native
 * write-off entry settles the row to 'paid' via deriveSettlement, so it needs
 * no branch). NOT paid for the dues_paid trigger, but nothing left to collect.
 */
const INVOICE_WRITTEN_OFF = `COALESCE(fi.status, '') ILIKE 'abgeschrieben%'`

/** Paid / settled / billed dues for the season, per member. */
const HAS_PAID_DUES = `EXISTS (SELECT 1 FROM finance_invoices fi WHERE fi.member = m.id AND ${DUES_INVOICE} AND ${INVOICE_PAID})`
const HAS_SETTLED_DUES = `EXISTS (SELECT 1 FROM finance_invoices fi WHERE fi.member = m.id AND ${DUES_INVOICE} AND (${INVOICE_PAID} OR ${INVOICE_WRITTEN_OFF}))`
const HAS_DUES_INVOICE = `EXISTS (SELECT 1 FROM finance_invoices fi WHERE fi.member = m.id AND ${DUES_INVOICE} AND NOT ${INVOICE_CANCELLED})`

/** Zurich calendar date of a timestamptz, as text. */
const zurichDate = (col) => `to_char(${col} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`
/** Whole days between a timestamptz and today (Zurich). */
const daysSince = (col) => `({{today}} - (${col} AT TIME ZONE 'Europe/Zurich')::date)`

/** cleanIban(): whitespace stripped, upper-cased. */
const cleanIban = (col) => `upper(regexp_replace(COALESCE(${col}, ''), '\\s', '', 'g'))`
/** CH/LI IBAN shape: country + 2 check digits + 17 alphanumerics (both countries are 21 long). */
const CH_LI_IBAN_RE = `'^(CH|LI)[0-9]{2}[A-Z0-9]{17}$'`
/**
 * isChLiIban() in SQL: the shape above AND the ISO 13616 mod-97 check —
 * a mistyped IBAN passes the shape and is still skipped by the payout run.
 * Rearrange (body + country + check digits), spell letters as 10..35, take
 * the ~25-digit integer mod 97 (numeric holds it). The CASE keeps the cast
 * away from strings the regex rejected. `expr` must be a cleaned column.
 */
const ibanOk = (expr) => `(CASE WHEN ${expr} ~ ${CH_LI_IBAN_RE} THEN (
  SELECT string_agg(CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch) - 55)::text ELSE ch END, '' ORDER BY ord)::numeric % 97 = 1
    FROM regexp_split_to_table(substr(${expr}, 5) || substr(${expr}, 1, 4), '') WITH ORDINALITY AS ib(ch, ord)
) ELSE false END)`

export const CHECKS = [
  // ── Dues ────────────────────────────────────────────────────────────────
  {
    key: 'dues_unpaid_active_player',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Active roster player without paid dues this season',
    description: 'A core player on an active team who owes dues by rule and has no settled Mitgliederbeitrag invoice for this season in the ledger (paid, or written off by the treasurer). `billed` splits "dun them" from "never billed" (see the unbilled check); unlinked ClubDesk invoices inflate both. Half the roster mid-September is normal while the July batch is being collected.',
    sql: `
SELECT ${MEMBER_COLS},
       string_agg(DISTINCT t.name, ', ' ORDER BY t.name) AS teams,
       m.sektion, m.beitragskategorie, m.register_status,
       ${HAS_DUES_INVOICE} AS billed,
       COALESCE((SELECT sum(fi.open_amount) FROM finance_invoices fi
                  WHERE fi.member = m.id AND ${DUES_INVOICE} AND ${INVOICE_OPEN}), 0)::text AS open_chf
  FROM members m
  JOIN member_teams mt ON mt.member = m.id AND ${CORE_PLAYER}
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
 WHERE ${FEE_PAYER}
   AND NOT ${HAS_SETTLED_DUES}
 GROUP BY m.id
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'dues_unbilled_active_member',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Active member with no dues invoice for the current season',
    description: 'A fee-owing active member with no non-cancelled invoice whose subject says Mitgliederbeitrag plus the current season. Upper bound: a ClubDesk invoice not linked to the member (own check) reads as unbilled — link it, otherwise bill through a dues run.',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.beitragskategorie, m.register_status,
       ${ON_ROSTER} AS on_roster
  FROM members m
 WHERE ${FEE_PAYER}
   AND NOT ${HAS_DUES_INVOICE}
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'dues_zwischenjahr_not_evaluated',
    section: 'finance',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Gap-year members whose dues are deliberately not evaluated',
    description: 'Members in register status Zwischenjahr are excluded from every unpaid/unbilled check because whether a gap year owes anything is still open with the treasurer. Listed for the count only; `billed` and `paid` show what ClubDesk did anyway.',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.beitragskategorie,
       ${ON_ROSTER} AS on_roster,
       ${HAS_DUES_INVOICE} AS billed,
       ${HAS_PAID_DUES} AS paid
  FROM members m
 WHERE m.kscw_membership_active AND ${REAL_PERSON}
   AND m.register_status = 'Zwischenjahr'
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'dues_invoice_overdue',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Invoice past its due date with an open balance',
    description: 'A member-linked invoice (native or ClubDesk mirror, any subject) whose due date has passed with money still outstanding and no payment reported by the member (those wait in the pending-confirmation check, as in the dunning candidates). Dun it, or record the payment; members flagged never_dun are listed but must not receive a reminder.',
    sql: `
SELECT ${MEMBER_COLS}, fi.number AS invoice_number, fi.subject, fi.status,
       fi.due_date::text AS due_date, ({{today}} - fi.due_date) AS days_overdue,
       fi.open_amount::text AS open_chf, fi.dunning_level, m.never_dun
  FROM finance_invoices fi
  JOIN members m ON m.id = fi.member
 WHERE fi.due_date < {{today}}
   AND ${INVOICE_OPEN}
   AND COALESCE(fi.status, '') <> 'pending_confirmation'
   AND NOT (fi.source = 'clubdesk' AND fi.reported_paid_at IS NOT NULL AND fi.confirmed_at IS NULL)
 ORDER BY fi.due_date, fi.id`,
  },
  {
    key: 'dues_invoice_pending_confirmation_stale',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Payment reported by the member over 14 days ago, still unconfirmed',
    description: 'The member said "I paid" (native pending_confirmation or a mirror row re-applied from a self-report), the books still show an open balance, and neither the treasurer nor the nightly sync confirmed it within two weeks. Confirm it or tell the member the money never arrived.',
    sql: `
SELECT ${MEMBER_COLS}, fi.number AS invoice_number, fi.subject, fi.status,
       to_char(fi.reported_paid_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD HH24:MI') AS reported_at,
       fi.reported_paid_method, ${daysSince('fi.reported_paid_at')} AS days_waiting,
       fi.open_amount::text AS open_chf
  FROM finance_invoices fi
  JOIN members m ON m.id = COALESCE(fi.member, fi.reported_paid_by)
 WHERE fi.reported_paid_at IS NOT NULL
   AND fi.confirmed_at IS NULL
   AND fi.reported_paid_at < ${NOW_TZ} - INTERVAL '14 days'
   AND ${INVOICE_OPEN}
 ORDER BY fi.reported_paid_at, fi.id`,
  },
  {
    key: 'dues_invoice_unlinked_member',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Dues invoice for this season not linked to any member',
    description: 'A Mitgliederbeitrag invoice for the current season with no member link (a team or billing-contact link does not count — only the member link flips dues_paid), so its recipient reads as unbilled and unpaid. Link it to the member from the finance explorer (the link persists through the nightly re-import).',
    sql: `
SELECT fi.id AS invoice_id, fi.number AS invoice_number, fi.subject, fi.recipient_name, fi.recipient_email,
       fi.invoice_date::text AS invoice_date, fi.status,
       fi.amount::text AS amount_chf, fi.open_amount::text AS open_chf
  FROM finance_invoices fi
 WHERE fi.member IS NULL
   AND ${DUES_INVOICE}
   AND NOT ${INVOICE_CANCELLED}
 ORDER BY fi.invoice_date DESC, fi.number, fi.id`,
  },
  {
    key: 'dues_invoice_never_emailed',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Issued native dues invoice never emailed',
    description: 'A billable invoice from an issued dues run whose live send never happened (test-mode sends do not stamp email_sent_at). Send it from the finance explorer or check finance_email_settings.test_mode; CHF 0 free-member documents are filed, not sent, and are not listed.',
    sql: `
SELECT ${MEMBER_COLS}, fi.number AS invoice_number, fi.amount::text AS amount_chf, fi.status,
       dr.label AS run_label, ${zurichDate('dr.date_created')} AS run_date, fi.recipient_email
  FROM finance_invoices fi
  JOIN finance_dues_runs dr ON dr.id = fi.dues_run
  JOIN members m ON m.id = fi.member
 WHERE fi.source = 'native'
   AND dr.status = 'issued'
   AND fi.status NOT IN ('paid', 'cancelled')
   AND COALESCE(fi.amount, 0) > 0
   AND fi.email_sent_at IS NULL
 ORDER BY dr.date_created, fi.id`,
  },
  {
    key: 'dues_paid_stale_season',
    section: 'finance',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'dues_paid flag still refers to a previous season',
    description: 'The derived flag survived the 1 June rollover without the ledger trigger firing — the nightly finance sync did not run. Expect 0 outside the Jun-1 → 04:00 window; otherwise run SELECT refresh_members_dues_paid() and check the local finance-sync cron.',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.dues_paid_season, {{season}} AS current_season,
       m.dues_paid_at::text AS dues_paid_at
  FROM members m
 WHERE m.dues_paid
   AND m.dues_paid_season IS DISTINCT FROM {{season}}
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'dues_paid_flag_drift',
    section: 'finance',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'dues_paid flag disagrees with the invoice ledger',
    description: 'members.dues_paid says one thing and the season\'s settled Mitgliederbeitrag invoices say the other — somebody wrote the derived column by hand or the statement trigger was bypassed. Never edit the flag; run SELECT refresh_members_dues_paid().',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.dues_paid, m.dues_paid_season,
       ${HAS_PAID_DUES} AS ledger_paid
  FROM members m
 WHERE (m.dues_paid AND m.dues_paid_season IS NOT DISTINCT FROM {{season}} AND NOT ${HAS_PAID_DUES})
    OR (NOT m.dues_paid AND ${HAS_PAID_DUES})
 ORDER BY m.last_name, m.first_name, m.id`,
  },

  // ── Fee categories & rates ──────────────────────────────────────────────
  {
    key: 'fee_override_without_reason',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Standing fee discount without a recorded reason',
    description: 'A per-member CHF or % discount that will print on the invoice as a bare "Rabatt" line. Add the reason on the member\'s finance tab so the treasurer of next season knows why.',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.beitragskategorie,
       m.fee_discount::text AS discount_chf, m.fee_discount_pct::text AS discount_pct,
       m.fee_base_override::text AS base_override_chf
  FROM members m
 WHERE m.kscw_membership_active
   AND ((m.fee_discount IS NOT NULL AND m.fee_discount > 0)
        OR (m.fee_discount_pct IS NOT NULL AND m.fee_discount_pct > 0))
   AND NULLIF(btrim(m.fee_discount_reason), '') IS NULL
 ORDER BY m.last_name, m.first_name, m.id`,
  },
  {
    key: 'fee_category_no_rate',
    section: 'finance',
    sport: 'both',
    severity: 'error',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Active member whose fee category has no rate this season',
    description: 'The native dues run would report missing_rate and skip this member: an empty beitragskategorie, a legacy spelling, or a category not seeded for the fiscal year. A per-member base override does not help (the run needs the rate row first), and Gratis needs its CHF 0 row for the free member\'s document. Fix the member\'s category or add the rate under Finance → Dues.',
    sql: `
SELECT ${MEMBER_COLS}, m.sektion, m.beitragskategorie, m.register_status,
       ${ON_ROSTER} AS on_roster, m.fee_base_override::text AS base_override_chf
  FROM members m
 WHERE m.kscw_membership_active
   AND ${REAL_PERSON}
   AND COALESCE(m.register_status, '') NOT IN ('Zwischenjahr', 'Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
   AND lower(${FEE_CAT}) <> 'kein beitrag'
   AND NOT ${RATE_FOR_MEMBER}
 ORDER BY m.beitragskategorie NULLS FIRST, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'dues_rates_missing_for_season',
    section: 'finance',
    sport: 'both',
    severity: 'error',
    grain: 'club',
    title: 'Fee categories in use with no rate this season',
    description: 'A category real active members hold that finance_dues_rates does not price for the current fiscal year (every category lists when the fiscal-year row itself is missing; Gratis needs a CHF 0 row so free members get their document). Add the rate under Finance → Dues.',
    sql: `
SELECT m.beitragskategorie AS category, m.sektion, count(*)::int AS members,
       EXISTS (SELECT 1 FROM finance_fiscal_years fy WHERE fy.label = {{season}}) AS fiscal_year_exists
  FROM members m
 WHERE m.kscw_membership_active
   AND ${REAL_PERSON}
   AND COALESCE(m.register_status, '') NOT IN ('Zwischenjahr', 'Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
   AND NULLIF(${FEE_CAT}, '') IS NOT NULL
   AND lower(${FEE_CAT}) <> 'kein beitrag'
   AND NOT ${RATE_FOR_MEMBER}
 GROUP BY m.beitragskategorie, m.sektion
 ORDER BY count(*) DESC, m.beitragskategorie, m.sektion NULLS FIRST`,
  },
  {
    key: 'fiscal_year_missing_for_season',
    section: 'finance',
    sport: 'both',
    severity: 'error',
    grain: 'club',
    title: 'No open fiscal year labelled with the current season',
    description: 'Without a finance_fiscal_years row whose label equals the season the referee payout run 404s, team ledger entries cannot be booked and dues runs have no schedule. The nightly importer creates it on the first import of a season; before that, add it under Finance → Fiscal years.',
    sql: `
SELECT {{season}} AS season,
       CASE WHEN fy.id IS NULL THEN 'missing' ELSE 'closed' END AS problem,
       fy.starts_on::text AS starts_on, fy.ends_on::text AS ends_on, fy.status,
       (SELECT count(*)::int FROM finance_dues_rates r WHERE r.fiscal_year = fy.id AND r.active) AS active_rates
  FROM (SELECT 1 AS one) x
  LEFT JOIN finance_fiscal_years fy ON fy.label = {{season}}
 WHERE fy.id IS NULL OR fy.status = 'closed'
 ORDER BY fy.id`,
  },
  {
    key: 'fee_surcharge_no_scorer_licence',
    section: 'finance',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    memberIdColumn: 'member_id',
    title: 'Player who would owe the CHF 100 no-scorer-licence surcharge',
    description: 'Not a fault — the licence-vs-fee reconciliation list: core players in a surcharge category (adults always, youth from U16) with no scorer/table licence flag and no per-member waiver, exactly as the fee engine would bill them. A stale licence flag here costs the member CHF 100; the exact figure is on the member\'s fee endpoint.',
    sql: `
SELECT ${MEMBER_COLS}, m.beitragskategorie,
       string_agg(DISTINCT t.name, ', ' ORDER BY t.name) AS teams,
       m.birthdate::text AS birthdate,
       m.fee_surcharge_override AS surcharge_override,
       m.fee_base_override::text AS base_override_chf
  FROM members m
  JOIN member_teams mt ON mt.member = m.id AND ${CORE_PLAYER}
  JOIN teams t ON t.id = mt.team AND ${ACTIVE_TEAM}
 WHERE ${FEE_PAYER}
   AND m.fee_surcharge_override IS DISTINCT FROM false
   AND ${SURCHARGE_DUE}
 GROUP BY m.id
 ORDER BY m.last_name, m.first_name, m.id`,
  },

  // ── Fines ───────────────────────────────────────────────────────────────
  {
    key: 'fines_open_per_member',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Members with open fines',
    description: 'Member-level fines that are neither paid nor waived, one row per member and team, whenever they were issued — a May fine is still owed in June, and the fines pages carry it over. The team leader marks them paid (team or club Kasse) or waives them with a reason.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS},
       count(*)::int AS open_fines, sum(f.amount)::text AS open_chf,
       ${zurichDate('min(f.issued_at)')} AS oldest_issued,
       string_agg(DISTINCT f.category, ', ' ORDER BY f.category) AS categories
  FROM fines f
  JOIN teams t ON t.id = f.team
  JOIN members m ON m.id = f.member
 WHERE f.status = 'open'
 GROUP BY m.id, t.id
 ORDER BY sum(f.amount) DESC, m.last_name, m.first_name, m.id, t.id`,
  },
  {
    key: 'fines_open_team_level',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Open team-level fines',
    description: 'A fine owed by the team as a whole (forfait, missing scorer, deadline sweeps) that is still open. It never appears on a member balance and the team page shows it un-netted — settle it from the team Kasse or waive it.',
    sql: `
SELECT ${TEAM_COLS}, f.category, f.amount::text AS amount_chf, f.reason,
       ${zurichDate('f.issued_at')} AS issued, ${daysSince('f.issued_at')} AS age_days,
       f.activity_type, f.activity_date::text AS activity_date, f.auto_issued
  FROM fines f
  JOIN teams t ON t.id = f.team
 WHERE f.member IS NULL
   AND f.status = 'open'
 ORDER BY f.issued_at, f.id`,
  },
  {
    key: 'fines_open_stale_60d',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'player',
    title: 'Member fines open for more than 60 days',
    description: 'An open member-level fine nobody collected or waived in two months. The team leader should mark it paid or waive it with a reason; team-level fines carry their age in the team-level check.',
    sql: `
SELECT ${MEMBER_COLS}, ${TEAM_COLS}, f.category, f.amount::text AS amount_chf,
       ${zurichDate('f.issued_at')} AS issued, ${daysSince('f.issued_at')} AS age_days,
       f.reason
  FROM fines f
  JOIN teams t ON t.id = f.team
  JOIN members m ON m.id = f.member
 WHERE f.status = 'open'
   AND f.issued_at < ${NOW_TZ} - INTERVAL '60 days'
 ORDER BY f.issued_at, f.id`,
  },
  {
    key: 'fines_rule_without_tiers',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Enabled fine rule with no usable tier',
    description: 'kscw_compute_fine_amount returns no row for this team, category and activity type — tiers empty, not an array, or no tier carrying a numeric amount — so auto-issue (the deadline sweep logs FINE_NO_RULE) and the quote silently produce nothing while the rule reads as enabled. Add at least one priced tier or disable the rule.',
    sql: `
SELECT ${TEAM_COLS}, fr.category, fr.activity_type, fr.reset_window, fr.tiers::text AS tiers
  FROM fine_rules fr
  JOIN teams t ON t.id = fr.team
 WHERE fr.enabled
   AND ${ACTIVE_TEAM}
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(fr.tiers) = 'array' THEN fr.tiers ELSE '[]'::jsonb END) x
      WHERE (x->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$'
   )
 ORDER BY t.name, fr.category, fr.activity_type NULLS FIRST, fr.id`,
  },

  // ── Referee fees (volleyball home games) ────────────────────────────────
  {
    key: 'referee_fee_unpaid_out',
    section: 'finance',
    sport: 'vb',
    severity: 'info',
    grain: 'player',
    title: 'Referee fees not yet reimbursed this season',
    description: 'The treasurer\'s forward liability per paying member: fees on this season\'s games with no payout stamp, the same rows the season-end payout run would pay. Not a fault during the season; after 31 May every remaining row is one.',
    sql: `
SELECT ${MEMBER_COLS}, count(*)::int AS games, sum(re.amount)::text AS total_chf,
       min(g.date)::text AS first_game, max(g.date)::text AS last_game,
       string_agg(DISTINCT t.name, ', ' ORDER BY t.name) AS teams
  FROM referee_expenses re
  JOIN games g ON g.id = re.game
  JOIN members m ON m.id = re.paid_by_member
  LEFT JOIN teams t ON t.id = re.team
 WHERE re.payout IS NULL
   AND COALESCE(re.amount, 0) > 0
   AND g.season = {{season}}
 GROUP BY m.id
 ORDER BY sum(re.amount) DESC, m.last_name, m.first_name, m.id`,
  },
  {
    key: 'referee_fee_payer_unresolvable',
    section: 'finance',
    sport: 'vb',
    severity: 'error',
    grain: 'game',
    title: 'Referee fee the payout run would skip',
    description: 'An unreimbursed fee whose payer cannot be paid: free-text payer (no member, never in the run), non-CHF, no valid CH/LI IBAN at any precedence level (shape and mod-97 checksum, as resolvePayee tests), or no zip/city for the QR creditor block. Fix the member\'s profile or re-record the fee against a member; the dry run (which also skips a member\'s CHF fees when one of theirs is in another currency) gives the exact skip codes.',
    sql: `
SELECT ${GAME_COLS}, t.name AS team, re.amount::text AS amount_chf, re.currency,
       m.id AS member_id, m.first_name, m.last_name, re.paid_by_other,
       CASE
         WHEN re.paid_by_member IS NULL THEN 'no_member'
         WHEN upper(COALESCE(re.currency, 'CHF')) <> 'CHF' THEN 'non_chf'
         WHEN NOT (p.use_billing OR p.own_ok) THEN 'no_iban'
         ELSE 'address_incomplete'
       END AS skip_reason
  FROM referee_expenses re
  JOIN games g ON g.id = re.game
  LEFT JOIN teams t ON t.id = re.team
  LEFT JOIN members m ON m.id = re.paid_by_member
  CROSS JOIN LATERAL (
    SELECT ${cleanIban('m.billing_iban')} AS billing_iban, ${cleanIban('m.iban')} AS own_iban
  ) c
  CROSS JOIN LATERAL (
    SELECT (COALESCE(m.billing_different, false) AND ${ibanOk('c.billing_iban')}) AS use_billing,
           ${ibanOk('c.own_iban')} AS own_ok
  ) p
  CROSS JOIN LATERAL (
    SELECT CASE WHEN p.use_billing THEN COALESCE(NULLIF(btrim(m.billing_name), ''), NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), ''))
                ELSE NULLIF(btrim(concat_ws(' ', m.first_name, m.last_name)), '') END AS payee_name,
           CASE WHEN p.use_billing THEN NULLIF(btrim(m.billing_plz), '') ELSE NULLIF(btrim(m.plz), '') END AS payee_zip,
           CASE WHEN p.use_billing THEN NULLIF(btrim(m.billing_ort), '') ELSE NULLIF(btrim(m.ort), '') END AS payee_city
  ) a
 WHERE re.payout IS NULL
   AND COALESCE(re.amount, 0) > 0
   AND g.season = {{season}}
   AND (re.paid_by_member IS NULL
        OR upper(COALESCE(re.currency, 'CHF')) <> 'CHF'
        OR NOT (p.use_billing OR p.own_ok)
        OR a.payee_name IS NULL OR a.payee_zip IS NULL OR a.payee_city IS NULL)
 ORDER BY g.date, g.time, g.id, re.id`,
  },
  {
    key: 'referee_fee_orphan_or_zero',
    section: 'finance',
    sport: 'vb',
    severity: 'error',
    grain: 'game',
    title: 'Referee fee row with no game, no team or zero amount',
    description: 'A fee the derivations drop or mis-attribute: game NULL (the game was deleted — invisible to the member and team views), team NULL (falls out of the teams summary), or amount empty/0 (excluded from the payout run). Re-attach it or delete the row.',
    sql: `
SELECT re.id AS expense_id, ${GAME_COLS}, t.name AS team,
       re.amount::text AS amount_chf, m.id AS member_id, m.first_name, m.last_name, re.paid_by_other,
       ${zurichDate('re.date_created')} AS recorded,
       CASE WHEN re.game IS NULL THEN 'no_game'
            WHEN re.team IS NULL THEN 'no_team'
            ELSE 'zero_amount' END AS problem
  FROM referee_expenses re
  LEFT JOIN games g ON g.id = re.game
  LEFT JOIN teams t ON t.id = re.team
  LEFT JOIN members m ON m.id = re.paid_by_member
 WHERE re.game IS NULL
    OR re.team IS NULL
    OR COALESCE(re.amount, 0) <= 0
 ORDER BY re.date_created DESC, re.id`,
  },
  {
    key: 'referee_payout_cancelled_but_stamped',
    section: 'finance',
    sport: 'vb',
    severity: 'error',
    grain: 'player',
    title: 'Referee fee stamped with a cancelled payout',
    description: 'The FK only clears the stamp when a payout is deleted; a payout set to cancelled leaves referee_expenses.payout populated, so the fee reads as reimbursed, is frozen for leaders and is invisible to the next run. Delete the cancelled payout (SET NULL) and re-run.',
    sql: `
SELECT ${MEMBER_COLS}, fp.id AS payout_id, fp.status AS payout_status, fp.amount::text AS payout_chf,
       ${zurichDate('fp.date_created')} AS payout_created,
       count(*)::int AS fees, sum(re.amount)::text AS fees_chf,
       string_agg(g.date::text, ', ' ORDER BY g.date) AS game_dates
  FROM referee_expenses re
  JOIN finance_payouts fp ON fp.id = re.payout
  JOIN members m ON m.id = fp.member
  LEFT JOIN games g ON g.id = re.game
 WHERE fp.status = 'cancelled'
 GROUP BY m.id, fp.id
 ORDER BY fp.date_created, fp.id`,
  },

  // ── Team ledgers & invoices ─────────────────────────────────────────────
  {
    key: 'team_finance_negative_net',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Team ledger in the red this fiscal year',
    description: 'Sponsoring plus income minus expense entries is below zero for the fiscal year labelled with the current season (teamTotals arithmetic; referee fees and invoices are deliberately not part of net). The team needs a sponsor entry or the expense moved to the club.',
    sql: `
SELECT ${TEAM_COLS},
       sum(CASE WHEN te.kind <> 'expense' THEN te.amount ELSE 0 END)::text AS income_chf,
       sum(CASE WHEN te.kind = 'expense' THEN te.amount ELSE 0 END)::text AS expense_chf,
       sum(CASE WHEN te.kind <> 'expense' THEN te.amount ELSE -te.amount END)::text AS net_chf,
       count(*)::int AS entries,
       COALESCE((SELECT sum(f.amount) FROM fines f WHERE f.team = t.id AND f.member IS NULL AND f.status = 'open'), 0)::text AS team_fines_open_chf
  FROM finance_team_entries te
  JOIN teams t ON t.id = te.team
 WHERE te.fiscal_year = ${FY_ID}
 GROUP BY t.id
HAVING sum(CASE WHEN te.kind <> 'expense' THEN te.amount ELSE -te.amount END) < 0
 ORDER BY sum(CASE WHEN te.kind <> 'expense' THEN te.amount ELSE -te.amount END), t.name, t.id`,
  },
  {
    key: 'team_invoice_open',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'team',
    title: 'Open native invoice billed to a team',
    description: 'A team-billed native invoice (a federation fine passed on, payable by coach, captain or team responsible) with money still outstanding. Chase the team leader or record the payment.',
    sql: `
SELECT ${TEAM_COLS}, fi.number AS invoice_number, fi.subject, fi.status,
       fi.amount::text AS amount_chf, fi.open_amount::text AS open_chf,
       fi.due_date::text AS due_date, fi.dunning_level
  FROM finance_invoices fi
  JOIN teams t ON t.id = fi.team
 WHERE fi.source = 'native'
   AND fi.status NOT IN ('paid', 'cancelled')
   AND COALESCE(fi.open_amount, 0) > 0
 ORDER BY fi.due_date NULLS LAST, fi.id`,
  },
  {
    key: 'finance_invoice_lines_mismatch',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Native invoice whose line items do not add up to its amount',
    description: 'finance_invoices.lines must sum to amount (the document prints the lines, the ledger books the amount) but nothing enforces it; the PDF silently collapses such a row to one line. Same test as invoiceLines(): lines with a label and a numeric amount, one-rappen tolerance. Re-issue the invoice from the dues run or correct the lines by hand.',
    sql: `
SELECT fi.id AS invoice_id, fi.number AS invoice_number, fi.subject, fi.status, fi.recipient_name,
       fi.amount::text AS amount_chf,
       l.total::text AS lines_chf, l.n AS line_count
  FROM finance_invoices fi
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum((x->>'amount')::numeric), 0) AS total, count(*)::int AS n
      FROM jsonb_array_elements(fi.lines) x
     WHERE NULLIF(btrim(COALESCE(x->>'label', '')), '') IS NOT NULL
       AND (x->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$'
  ) l
 WHERE fi.source = 'native'
   AND fi.lines IS NOT NULL
   AND jsonb_typeof(fi.lines) = 'array'
   AND jsonb_array_length(fi.lines) > 0
   AND abs(COALESCE(fi.amount, 0) - l.total) >= 0.005
 ORDER BY fi.id`,
  },
  {
    key: 'finance_invoice_settlement_drift',
    section: 'finance',
    sport: 'both',
    severity: 'warn',
    grain: 'club',
    title: 'Native invoice whose status or open balance is off its payment ledger',
    description: 'recomputeInvoice() is the single writer of a native invoice\'s status and open_amount, derived from the sum of its finance_payments (deriveSettlement); a row that disagrees was edited by hand or written around the recompute, and the member is shown the wrong balance. Record a ledger entry or cancel the invoice — never edit the columns.',
    sql: `
SELECT fi.id AS invoice_id, fi.number AS invoice_number, fi.recipient_name,
       fi.amount::text AS amount_chf, fi.status, fi.open_amount::text AS open_chf,
       d.expected_status, d.expected_open::text AS expected_open_chf, d.entries
  FROM finance_invoices fi
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(CASE WHEN COALESCE(p.entry_type, 'payment') = 'payment' THEN p.amount ELSE 0 END), 0) AS paid,
           COALESCE(sum(CASE WHEN p.entry_type = 'refund' THEN p.amount ELSE 0 END), 0) AS refunded,
           COALESCE(sum(CASE WHEN p.entry_type IN ('credit_note', 'writeoff') THEN p.amount ELSE 0 END), 0) AS non_cash,
           count(*)::int AS entries
      FROM finance_payments p WHERE p.invoice = fi.id
  ) s
  CROSS JOIN LATERAL (
    SELECT round(COALESCE(fi.amount, 0), 2) AS total,
           round(s.paid - s.refunded, 2) AS net_cash,
           round(greatest(0, s.paid - s.refunded) + s.non_cash, 2) AS coverage
  ) c
  CROSS JOIN LATERAL (
    SELECT (c.total <= 0 OR (c.coverage + 0.01 >= c.total AND c.net_cash >= -0.01)) AS settled
  ) t
  CROSS JOIN LATERAL (
    SELECT CASE WHEN t.settled THEN 'paid'
                WHEN c.net_cash < -0.01 THEN 'open'
                WHEN c.coverage > 0.01 THEN 'partial'
                WHEN fi.status = 'pending_confirmation' THEN 'pending_confirmation'
                ELSE 'open' END AS expected_status,
           CASE WHEN t.settled THEN 0
                WHEN c.net_cash < -0.01 THEN c.total
                ELSE greatest(0, c.total - c.coverage) END AS expected_open,
           s.entries
  ) d
 WHERE fi.source = 'native'
   AND fi.status <> 'cancelled'
   AND (fi.status IS DISTINCT FROM d.expected_status
        OR abs(COALESCE(fi.open_amount, 0) - d.expected_open) >= 0.005)
 ORDER BY fi.id`,
  },

  // ── Out-of-pocket reimbursements (TK flow) ──────────────────────────────
  {
    key: 'finance_expenses_pending_stale',
    section: 'finance',
    sport: 'both',
    severity: 'info',
    grain: 'player',
    title: 'Reimbursement request pending for more than 30 days',
    description: 'Money the club owes a member (out-of-pocket expense submitted at /finance/expense) that neither the TK nor the treasurer has moved in a month. Confirm it and pay it out, or reject it with a note.',
    sql: `
SELECT ${MEMBER_COLS},
       CASE fe.section WHEN 'vb' THEN 'volleyball' WHEN 'bb' THEN 'basketball' END AS sport,
       fe.amount::text AS amount_chf, fe.expense_date::text AS expense_date, fe.vendor,
       ${zurichDate('fe.date_created')} AS submitted, ${daysSince('fe.date_created')} AS days_pending,
       (fe.tk_confirmed_at IS NOT NULL) AS tk_confirmed
  FROM finance_expenses fe
  JOIN members m ON m.id = fe.member
 WHERE fe.status = 'pending'
   AND fe.date_created < ${NOW_TZ} - INTERVAL '30 days'
 ORDER BY fe.date_created, fe.id`,
  },
]
