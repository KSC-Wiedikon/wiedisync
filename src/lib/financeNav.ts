import type { ComponentType } from 'react'
import { Wallet, Gavel, ReceiptText, HandCoins, ClipboardCheck, Landmark } from 'lucide-react'

/**
 * THE single source of the Finances navigation — consumed by the desktop
 * dropdown (`TopNav` via `useNavItems`) and the mobile sheet (`MoreSheet`).
 * Modelled on `adminNav.ts` for the same reason: before 2026-09-15 the list was
 * copy-pasted between the two surfaces and had already drifted (mobile lacked
 * "Confirm expenses"). Add a finance page HERE and both surfaces get it.
 *
 * Three labelled groups. Empty groups are dropped, so a member with no team
 * never sees a "Team finance" header, and a plain member never sees "Club
 * finance". NO route is renamed here — guided tours match exact pathnames.
 *
 * Entries keep `to` as a plain string that may carry a query (`/fines?scope=…`);
 * `navPathMatches` / `navItemActive` below know how to highlight those.
 */

/** Which gate the entry sits behind — documentation, not enforcement. */
export type FinanceAccess = 'member' | 'team' | 'tk' | 'finance'

export interface FinanceNavEntry {
  to: string
  /** i18n key. A `ns:` prefix (e.g. `finance:title`) selects another namespace; bare keys are `nav`. */
  labelKey: string
  /** Lucide-style component — consumers size it themselves. */
  icon: ComponentType<{ className?: string }>
  access: FinanceAccess
}

export interface FinanceNavGroup {
  /** `nav` namespace key for the group sub-header. */
  labelKey: string
  items: FinanceNavEntry[]
}

export interface FinanceNavFlags {
  /** Member of / coach of / captain of at least one team — unlocks Team finance. */
  hasTeam: boolean
  /** Section TK (vb_admin / bb_admin) or finance/board — the expense confirmation queue. */
  isTk: boolean
  /** Board OR finance role — the club-finances dashboard. */
  canAccessFinance: boolean
}

export function buildFinanceGroups({ hasTeam, isTk, canAccessFinance }: FinanceNavFlags): FinanceNavGroup[] {
  const groups: FinanceNavGroup[] = [
    {
      labelKey: 'memberFinance',
      items: [
        // The page title key lives in the `finance` namespace with the page.
        { to: '/finance/dues', labelKey: 'finance:myDuesTitle', icon: Wallet, access: 'member' },
        { to: '/fines?scope=mine', labelKey: 'myFines', icon: Gavel, access: 'member' },
        { to: '/finance/expense', labelKey: 'uploadInvoice', icon: ReceiptText, access: 'member' },
      ],
    },
    {
      labelKey: 'teamFinance',
      items: hasTeam ? [
        { to: '/finance/team', labelKey: 'teamFinancePage', icon: HandCoins, access: 'team' },
        { to: '/fines?scope=team', labelKey: 'teamFines', icon: Gavel, access: 'team' },
      ] : [],
    },
    {
      labelKey: 'clubFinance',
      items: [
        ...(isTk ? [{ to: '/finance/tk-expenses', labelKey: 'finance:tkExpensesNav', icon: ClipboardCheck, access: 'tk' as const }] : []),
        ...(canAccessFinance ? [{ to: '/admin/finance', labelKey: 'finance:title', icon: Landmark, access: 'finance' as const }] : []),
      ],
    },
  ]
  return groups.filter((g) => g.items.length > 0)
}

// ── Active-state helpers ───────────────────────────────────────────────────
// Shared by TopNav (dropdown trigger + items) and MoreSheet so both surfaces
// highlight the same thing for the same URL.

/**
 * Pathname-only match: `to`'s query string is ignored, so `/fines?scope=mine`
 * matches `/fines` and `/fines/anything`. Use for "is this section open?".
 */
export function navPathMatches(pathname: string, to: string): boolean {
  const path = to.split('?')[0]
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(path + '/')
}

/**
 * Item-level match: the pathname must match AND, when `to` carries a query,
 * every param in it must equal the current URL's. So on `/fines?scope=team`
 * only "Team fines" lights up, and on bare `/fines` neither scoped item does
 * (the section trigger still does, via `navPathMatches`).
 */
export function navItemActive(location: { pathname: string; search: string }, to: string): boolean {
  if (!navPathMatches(location.pathname, to)) return false
  const query = to.split('?')[1]
  if (!query) return true
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(location.search)
  for (const [k, v] of want) if (have.get(k) !== v) return false
  return true
}
