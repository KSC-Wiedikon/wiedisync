import type { ComponentType } from 'react'
import {
  LayoutDashboard, Wallet, FileText, BellRing, Landmark, BookOpen, ListTree, Scale, TrendingUp,
  Building2, PiggyBank, Archive, Users, Shirt, Receipt, GitCompareArrows, ArrowRightLeft, RefreshCw,
  Settings2, Zap, ClipboardCheck, HandCoins, Flag,
} from 'lucide-react'

/**
 * THE navigation of accounting.wiedisync.kscw.ch — the sidebar, the mobile menu, the
 * search box, the page headers and the old /admin/finance?tab= redirect all read this
 * list, so a page added here can be found everywhere at once.
 *
 * Every page has a one-line description (shown under its title and searched), and
 * `keywords` in German AND English, so "Mahnung", "Bilanz" or "Quittung" find the
 * right page whatever the UI language is.
 */

export type AccountingGroupKey = 'overview' | 'billing' | 'books' | 'reports' | 'people' | 'parallel' | 'settings'

export interface AccountingPage {
  key: string
  /** Route inside the accounting app. */
  path: string
  group: AccountingGroupKey
  /** Label and description: `finance` namespace `accNav_<key>` / `accNavDesc_<key>`. */
  icon: ComponentType<{ className?: string }>
  /** Search synonyms, both languages, lower case. */
  keywords: string
  /** Auditors (read-only `revisor`) do not get it: member PII or a pure write action. */
  hiddenForRevisor?: boolean
  /** The page reads the fiscal year picked in the header. */
  usesFiscalYear?: boolean
}

export const ACCOUNTING_GROUPS: AccountingGroupKey[] = ['overview', 'billing', 'books', 'reports', 'people', 'parallel', 'settings']

export const ACCOUNTING_PAGES: AccountingPage[] = [
  { key: 'dashboard', path: '/', group: 'overview', icon: LayoutDashboard, usesFiscalYear: true,
    keywords: 'übersicht dashboard start home kennzahlen overview kontostand to do aufgaben' },

  { key: 'dues', path: '/dues', group: 'billing', icon: Wallet, usesFiscalYear: true,
    keywords: 'mitgliederbeitrag beiträge beitrag jahresbeitrag dues membership fee tarif rates' },
  { key: 'invoices', path: '/invoices', group: 'billing', icon: FileText, usesFiscalYear: true,
    keywords: 'rechnung rechnungen invoice invoices debitor debitoren qr einzahlungsschein offen bezahlt paid open' },
  { key: 'reminders', path: '/reminders', group: 'billing', icon: BellRing,
    keywords: 'mahnung mahnungen mahnwesen dunning reminder reminders überfällig overdue zahlungserinnerung' },

  { key: 'bank', path: '/bank', group: 'books', icon: Landmark, usesFiscalYear: true,
    keywords: 'bank kontoauszug camt camt.053 ubs zahlungen payments statement import regeln rules verbuchen' },
  { key: 'journal', path: '/journal', group: 'books', icon: BookOpen, usesFiscalYear: true,
    keywords: 'journal buchung buchungen booking bookings entry entries beleg belege quittung receipt hauptbuch' },
  { key: 'accounts', path: '/accounts', group: 'books', icon: ListTree, usesFiscalYear: true,
    keywords: 'konto konten account accounts kontoblatt saldo balance kontostand ledger' },
  { key: 'trialBalance', path: '/trial-balance', group: 'books', icon: Scale, usesFiscalYear: true,
    keywords: 'probebilanz saldenliste trial balance summenbilanz' },

  { key: 'incomeStatement', path: '/income-statement', group: 'reports', icon: TrendingUp, usesFiscalYear: true,
    keywords: 'erfolgsrechnung income statement profit loss gewinn verlust ertrag aufwand einnahmen ausgaben result' },
  { key: 'balanceSheet', path: '/balance-sheet', group: 'reports', icon: Building2, usesFiscalYear: true,
    keywords: 'bilanz balance sheet aktiven passiven assets liabilities vermögen eigenkapital equity' },
  { key: 'budget', path: '/budget', group: 'reports', icon: PiggyBank, usesFiscalYear: true,
    keywords: 'budget voranschlag plan soll ist' },
  { key: 'yearEnd', path: '/year-end', group: 'reports', icon: Archive, usesFiscalYear: true,
    keywords: 'jahresabschluss year end jahresrechnung annual accounts pdf archiv archive eröffnung eröffnungsbilanz opening abschluss close revision' },

  { key: 'members', path: '/members', group: 'people', icon: Users, hiddenForRevisor: true,
    keywords: 'mitglied mitglieder member members person adresse rechnungen zahlungen' },
  { key: 'teams', path: '/teams', group: 'people', icon: Shirt, usesFiscalYear: true,
    keywords: 'team teams mannschaft sponsoring sponsor teamkasse' },
  { key: 'expenses', path: '/expenses', group: 'people', icon: Receipt,
    keywords: 'spesen expenses auslagen rückerstattung reimbursement quittung auszahlung payout' },

  { key: 'parallel', path: '/parallel', group: 'parallel', icon: GitCompareArrows, usesFiscalYear: true,
    keywords: 'parallel clubdesk vergleich comparison monat month abnahme sign off differenz difference' },
  { key: 'switch', path: '/switch', group: 'parallel', icon: ArrowRightLeft,
    keywords: 'umstellung switch wechsel bereit readiness checkliste checklist' },
  { key: 'sync', path: '/sync', group: 'parallel', icon: RefreshCw, hiddenForRevisor: true,
    keywords: 'sync synchronisation clubdesk import abgleich aktualisieren' },

  { key: 'chartOfAccounts', path: '/settings/accounts', group: 'settings', icon: Settings2,
    keywords: 'kontenplan chart of accounts konto anlegen new account kontonummer' },
  { key: 'autopost', path: '/settings/automatic-postings', group: 'settings', icon: Zap,
    keywords: 'automatisch automatic auto posting verbuchung einstellungen settings ertragskonto income account' },
]

/** Pages that live in the member app (wiedisync.kscw.ch) — linked, not duplicated. */
export interface MemberAppLink { key: string; path: string; icon: ComponentType<{ className?: string }>; keywords: string }
export const MEMBER_APP_LINKS: MemberAppLink[] = [
  { key: 'tkExpenses', path: '/finance/tk-expenses', icon: ClipboardCheck, keywords: 'spesen bestätigen confirm expenses tk freigabe approve' },
  { key: 'refereeExpenses', path: '/admin/referee-expenses', icon: Flag, keywords: 'schiedsrichter schiri referee spesen expenses entschädigung' },
  { key: 'teamFinance', path: '/finance/team', icon: HandCoins, keywords: 'teamfinanzen team finance teamkasse' },
]

export function pagesFor(isRevisor: boolean): AccountingPage[] {
  return ACCOUNTING_PAGES.filter((p) => !(isRevisor && p.hiddenForRevisor))
}

/** The page a pathname belongs to (most specific path wins; '/' only exactly). */
export function pageForPath(pathname: string): AccountingPage | undefined {
  return ACCOUNTING_PAGES
    .filter((p) => (p.path === '/' ? pathname === '/' : pathname === p.path || pathname.startsWith(p.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

/** Old member-app links (`/admin/finance?tab=bank`) → the page that replaced the tab. */
const TAB_TO_PATH: Record<string, string> = {
  overview: '/', income: '/income-statement', balance: '/balance-sheet', budget: '/budget',
  ledger: '/journal', accounts: '/accounts', invoices: '/invoices', dues: '/dues', dunning: '/reminders',
  expenses: '/expenses', members: '/members', teams: '/teams', sync: '/sync', bank: '/bank',
  year: '/year-end', parallel: '/parallel', switch: '/switch',
}

/** Path + query on the accounting app for an old `/admin/finance` URL's search string.
 *  Keeps every other parameter (e.g. `?m=` = the selected member). */
export function legacyFinanceTarget(search: string): string {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  params.delete('tab')
  const path = (tab && TAB_TO_PATH[tab]) || '/'
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/** Whole-word-ish matching instead of cmdk's letter-by-letter fuzzy score, which let
 *  "mahnung" match half the pages. Every typed word must occur (accents ignored);
 *  a hit in the label (the first keyword) ranks above one in the synonyms. */
export function searchScore(_value: string, search: string, keywords?: string[]): number {
  const words = norm(search).split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  const all = norm((keywords ?? []).join(' '))
  if (!words.every((w) => all.includes(w))) return 0
  const label = norm(keywords?.[0] ?? '')
  return label.startsWith(words[0]) ? 1 : label.includes(words[0]) ? 0.8 : 0.5
}
