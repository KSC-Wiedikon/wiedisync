import type { ComponentType } from 'react'
import {
  Building2, CalendarClock, ClipboardList, Gavel, Banknote, UserPlus, ArrowRightLeft,
  Megaphone, Flag, MessageSquare, Mail, MailOpen, KeyRound, Database, BarChart3,
  Activity, HeartPulse, Bug, ScrollText, FileWarning, Terminal,
} from 'lucide-react'

/**
 * THE single source of the Admin navigation — consumed by the desktop mega-menu
 * (`TopNav`), the mobile sheet (`MoreSheet`) and the `/admin` hub table
 * (`AdminHubPage`). Before 2026-08-19 the list was copy-pasted between the first
 * two and had already drifted (superadmin order), which is exactly what this
 * module exists to prevent: add an admin page HERE and all three surfaces get it.
 *
 * Items are gated INDIVIDUALLY, not by one section-wide isAdmin: every entry is
 * AdminRoute-guarded (isAdmin) except the club mailbox, which is
 * GlobalAdminRoute-guarded (isGlobalAdmin = admin || superuser) to mirror the
 * server's authForAccount('admin'). isAdmin is the WIDER set — it also holds
 * vb_admin / bb_admin, whom the server 403s on the mailbox — so the two cannot
 * share a gate. Empty groups are dropped so a sport admin never sees a section
 * whose only entry would bounce them back to '/'.
 */

/** Which route guard the entry sits behind — rendered as the hub's Access column. */
export type AdminAccess = 'admin' | 'globalAdmin' | 'superadmin'

export interface AdminNavEntry {
  to: string
  /** i18n key. A `ns:` prefix (e.g. `admin:egNav`) selects another namespace; bare keys are `nav`. */
  labelKey: string
  /** Lucide-style component — consumers size it themselves (nav 5, table 4). */
  icon: ComponentType<{ className?: string }>
  access: AdminAccess
  /** Absolute URL for entries that live on another origin (scheduling subdomain). */
  href?: string
  external?: boolean
}

export interface AdminNavGroup {
  labelKey: string
  items: AdminNavEntry[]
}

export interface AdminNavFlags {
  isAdmin: boolean
  isGlobalAdmin: boolean
  isSuperAdmin: boolean
  /**
   * Game scheduling — built by the caller because its target and origin depend on
   * role + SCHEDULING_ORIGIN. Leads the "Planning & halls" group for admins.
   */
  scheduling?: AdminNavEntry | null
}

/** The admin sections, minus superadmin (which renders as its own block). */
export function buildAdminGroups({ isAdmin, isGlobalAdmin, scheduling }: AdminNavFlags): AdminNavGroup[] {
  return [
    {
      labelKey: 'adminGroupPlanning',
      items: [
        ...(scheduling ? [scheduling] : []),
        ...(isAdmin ? [
          { to: '/admin/hallenplan', labelKey: 'hallenplan', icon: Building2, access: 'admin' as const },
          { to: '/admin/hallenfinder', labelKey: 'hallenfinder', icon: CalendarClock, access: 'admin' as const },
        ] : []),
      ],
    },
    {
      labelKey: 'adminGroupGames',
      items: isAdmin ? [
        { to: '/admin/scorer-assign', labelKey: 'scorerAssign', icon: ClipboardList, access: 'admin' as const },
        { to: '/admin/vb-referees', labelKey: 'vbReferees', icon: Gavel, access: 'admin' as const },
        { to: '/admin/referee-expenses', labelKey: 'refereeExpenses', icon: Banknote, access: 'admin' as const },
      ] : [],
    },
    {
      labelKey: 'adminGroupMembers',
      items: isAdmin ? [
        { to: '/admin/anmeldungen', labelKey: 'anmeldungen', icon: UserPlus, access: 'admin' as const },
        // International transfers (AdminRoute). The label lives in the `admin`
        // namespace with the rest of that page's strings, hence the prefix.
        { to: '/admin/transfers', labelKey: 'admin:trNavTransfers', icon: ArrowRightLeft, access: 'admin' as const },
        { to: '/admin/announcements', labelKey: 'announcements', icon: Megaphone, access: 'admin' as const },
        { to: '/admin/reports', labelKey: 'moderationReports', icon: Flag, access: 'admin' as const },
        { to: '/admin/volley-feedback', labelKey: 'volleyFeedback', icon: MessageSquare, access: 'admin' as const },
      ] : [],
    },
    {
      // Club email — the mailbox plus the two things that shape what leaves it.
      // Split out of "Members & communication" (2026-08-18): the template editor
      // holds exactly one template (registration_docs_request × 5 locales) and the
      // garage is a credential store, so neither earned a top-level slot on its
      // own, but together they are one coherent destination.
      //
      // ⚠ The gates inside DIFFER and must stay that way — grouping is layout
      // only, it does not unify access. See the module header.
      labelKey: 'adminGroupEmail',
      items: [
        // Club mailbox: admin || superuser only. NOT isAdmin (that includes vb/bb
        // admins, whom the server 403s) and NOT isVorstand (board was rejected).
        ...(isGlobalAdmin ? [{ to: '/admin/mailbox', labelKey: 'clubMailbox', icon: Mail, access: 'globalAdmin' as const }] : []),
        ...(isAdmin ? [
          // Editable transactional email copy (migration 287). isAdmin, matching
          // the route's AdminRoute guard and the policy grants (Sport Admin +
          // Vorstand hold email_templates CRUD).
          { to: '/admin/email-templates', labelKey: 'admin:etTitle', icon: MailOpen, access: 'admin' as const },
          // Emails Garage (migration 326) — isAdmin, matching the route's
          // AdminRoute guard and the endpoint's read gate. A sport admin sees it
          // and gets their own section's accounts read-only.
          { to: '/admin/emails-garage', labelKey: 'admin:egNav', icon: KeyRound, access: 'admin' as const },
        ] : []),
      ],
    },
    {
      labelKey: 'adminGroupData',
      items: isAdmin ? [
        { to: '/admin/explore', labelKey: 'adminExplorer', icon: Database, access: 'admin' as const },
        { to: '/admin/club-stats', labelKey: 'clubStats', icon: BarChart3, access: 'admin' as const },
      ] : [],
    },
  ].filter((g) => g.items.length > 0)
}

/** Superadmin-only tools — rendered as their own block below the sections. */
export function buildSuperadminItems(isSuperAdmin: boolean): AdminNavEntry[] {
  if (!isSuperAdmin) return []
  return [
    { to: '/admin/infra', labelKey: 'infraHealth', icon: Activity, access: 'superadmin' },
    // ClubDesk sync merged into Data health (2026-08-13) — one destination.
    { to: '/admin/data-health', labelKey: 'dataHealth', icon: HeartPulse, access: 'superadmin' },
    { to: '/admin/audit-log', labelKey: 'auditLog', icon: ScrollText, access: 'superadmin' },
    { to: '/admin/error-logs', labelKey: 'errorLogs', icon: FileWarning, access: 'superadmin' },
    { to: '/admin/sql', labelKey: 'sqlWorkspace', icon: Terminal, access: 'superadmin' },
    { to: '/bugfixes', labelKey: 'bugfixes', icon: Bug, access: 'superadmin' },
  ]
}

/** Every section the user can reach, superadmin folded in as a final group. */
export function buildAdminNav(flags: AdminNavFlags): AdminNavGroup[] {
  const superadmin = buildSuperadminItems(flags.isSuperAdmin)
  return [
    ...buildAdminGroups(flags),
    ...(superadmin.length > 0 ? [{ labelKey: 'superadmin', items: superadmin }] : []),
  ]
}
