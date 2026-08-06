import { useTranslation } from 'react-i18next'
import { useAuth } from './useAuth'
import { useAdminMode } from './useAdminMode'
import { messagingFeatureEnabled } from '../utils/messagingFeatureFlag'
import { SCHEDULING_ORIGIN } from '../lib/api'
import {
  Home, Calendar, UserX, PenSquare, PartyPopper, Users, Radio,
  Building2, CalendarClock, Activity, ClipboardList, ClipboardCheck,
  HeartPulse, MessageSquare, Inbox, Mail, Banknote, BarChart3, UserPlus, Bug, Database, Megaphone, Newspaper, Flag, ScrollText, Terminal, Gavel, Wallet, Landmark, ReceiptText, FileWarning, FolderSync, GraduationCap, ArrowRightLeft, MailOpen,
} from 'lucide-react'
import WhistleIcon from '../components/WhistleIcon'

export interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  href?: string
  external?: boolean
}

/**
 * Single source of nav entries for the app shell — consumed by the desktop top
 * navbar (`TopNav`). Each group is role-/feature-gated identically to the route
 * guards, so the navbar is always complete for privileged users (the admin-mode
 * toggle only changes data scope, never which pages are listed).
 */
export function useNavItems(isLoggedIn: boolean, isApproved: boolean, memberId?: number | string | null) {
  const { t } = useTranslation('nav')
  const { memberTeamIds, is_spielplaner, spielplanerTeamIds, isAdmin, isGlobalAdmin, isVorstand, canAccessFinance, isVbAdmin, isBbAdmin, coachTeamIds, teamResponsibleIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  // Forms authoring is a leadership tool — gated on ROLE (not the admin-mode
  // toggle), like the Spielplaner items below. Members reach forms-to-fill via
  // the Home page card instead. Coaches/TRs/Sport Admins/Vorstand/Admins manage.
  const canManageForms = isAdmin || isVorstand || coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  const showTeamsPlural = effectiveIsAdmin || effectiveIsVorstand || memberTeamIds.length > 1
  const iconClass = 'h-5 w-5'
  const publicItems: NavItem[] = [
    { to: '/', label: t('home'), icon: <Home className={iconClass} /> },
    { to: '/calendar', label: t('calendar'), icon: <Calendar className={iconClass} /> },
    { to: '/games', label: t('games'), icon: <WhistleIcon className={iconClass} /> },
    // Live scoreboard — public like /games: spectators in the hall follow it
    // without an account (the `live_scores` read is on the Public policy).
    { to: '/live', label: t('live'), icon: <Radio className={iconClass} /> },
  ]
  // Primary = the daily "what's happening" views (these mirror the mobile bottom
  // tab bar). In the desktop top navbar Home stays a direct link and the rest are
  // grouped under the "Activities" dropdown.
  const primaryAuthItems: NavItem[] = [
    {
      to: '/trainings',
      label: t('trainings'),
      icon: (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
          <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
          <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
          <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
        </svg>
      ),
    },
    { to: '/events', label: t('events'), icon: <PartyPopper className={iconClass} /> },
  ]
  // Member tools — lower-frequency tools grouped under one "Member tools" header.
  // Forms is here too (author-only; gated). News (the read feed) lives here too.
  const memberToolsItems: NavItem[] = [
    { to: '/teams', label: t(showTeamsPlural ? 'teams' : 'team'), icon: <Users className={iconClass} /> },
    { to: '/absences', label: t('absences'), icon: <UserX className={iconClass} /> },
    { to: '/scorer', label: t('scorer'), icon: <PenSquare className={iconClass} /> },
    ...(messagingFeatureEnabled(memberId)
      ? [{ to: '/inbox', label: t('inbox'), icon: <Inbox className={iconClass} /> }]
      : []),
    ...(canManageForms ? [{ to: '/forms', label: t('forms'), icon: <ScrollText className={iconClass} /> }] : []),
    // J+S export — coaches and above (same audience as Forms authoring).
    ...(canManageForms ? [{ to: '/js-export', label: t('jsExport'), icon: <GraduationCap className={iconClass} /> }] : []),
    { to: '/news', label: t('news'), icon: <Newspaper className={iconClass} /> },
  ]
  // Finance — own section: personal dues, fines, expense-reimbursement upload (all
  // members), and the board club-finances dashboard (Vorstand only).
  // The section TK (vb_admin / bb_admin) — and finance/board/superadmins
  // (canAccessFinance) — get the expense confirmation queue. Matches TkRoute and
  // the endpoint's canManageFinance, which give finance/board every section.
  const isTk = isVbAdmin || isBbAdmin || canAccessFinance
  const financeItems: NavItem[] = [
    { to: '/finance/dues', label: t('finance:myDuesTitle'), icon: <Wallet className={iconClass} /> },
    { to: '/fines', label: t('fines'), icon: <Gavel className={iconClass} /> },
    { to: '/finance/expense', label: t('uploadInvoice'), icon: <ReceiptText className={iconClass} /> },
    ...(isTk ? [{ to: '/finance/tk-expenses', label: t('finance:tkExpensesNav'), icon: <ClipboardCheck className={iconClass} /> }] : []),
    ...(canAccessFinance ? [{ to: '/admin/finance', label: t('finance:title'), icon: <Landmark className={iconClass} /> }] : []),
  ]
  // Spielplaner tools — their own role-gated section (NOT the Admin section).
  // Gated on ROLE, not the admin-mode toggle (matches the route guards: an admin
  // can open these in either mode). Game scheduling now lives on its own
  // subdomain. When SCHEDULING_ORIGIN is a different origin (prod/dev with the env
  // set), these jump there as external links (seamless via the shared .kscw.ch
  // session cookie / SSO); on localhost or when unset they stay in-app.
  const schedExternal = typeof window !== 'undefined' && SCHEDULING_ORIGIN.replace(/\/$/, '') !== window.location.origin
  // The whole game-scheduling feature opens as ONE entry — it has its own in-app
  // nav (dashboard / manual game calendar / settings) once you're in it. Full &
  // club Spielplaner land on Match scheduling (the dashboard); a per-team
  // Spielplaner who can't reach Terminplanung lands on the manual game calendar,
  // and so do coaches/TRs (read-only planner view in v1).
  const hasSchedulingAccess =
    isAdmin || is_spielplaner || spielplanerTeamIds.length > 0 ||
    coachTeamIds.length > 0 || teamResponsibleIds.length > 0
  const schedTo = isAdmin || is_spielplaner ? '/admin/terminplanung' : '/admin/spielplanung'
  const schedulingItem: NavItem | null = hasSchedulingAccess
    ? {
        to: schedTo,
        href: schedExternal ? `${SCHEDULING_ORIGIN}${schedTo}` : undefined,
        external: schedExternal,
        label: t('spielplanung'),
        icon: <CalendarClock className={iconClass} />,
      }
    : null
  return {
    navItems: isLoggedIn && isApproved ? [...publicItems, ...primaryAuthItems] : publicItems,
    memberToolsItems: isLoggedIn && isApproved ? memberToolsItems : [],
    financeItems: isLoggedIn && isApproved ? financeItems : [],
    schedulingItem,
    // Admin tools grouped into labeled sections — the flat list outgrew the
    // dropdown (11+ entries). Same grouping is mirrored in MoreSheet (mobile).
    //
    // Items are gated INDIVIDUALLY, not by one section-wide isAdmin: every entry
    // here is AdminRoute-guarded (isAdmin) except the club mailbox, which is
    // VorstandRoute-guarded (isVorstand). Neither set contains the other — a
    // vb_admin is isAdmin but NOT isVorstand (server 403s them on the mailbox),
    // while a plain vorstand is the reverse. Empty groups are dropped so a board
    // member who isn't an admin sees just the mailbox instead of a section full
    // of links that would bounce them back to '/'.
    adminGroups: [
      {
        label: t('adminGroupPlanning'),
        items: [
          ...(isAdmin ? [{ to: '/admin/hallenplan', label: t('hallenplan'), icon: <Building2 className={iconClass} /> }] : []),
          ...(isAdmin ? [{ to: '/admin/hallenfinder', label: t('hallenfinder'), icon: <CalendarClock className={iconClass} /> }] : []),
        ] as NavItem[],
      },
      {
        label: t('adminGroupGames'),
        items: [
          ...(isAdmin ? [
            { to: '/admin/scorer-assign', label: t('scorerAssign'), icon: <ClipboardList className={iconClass} /> },
            { to: '/admin/vb-referees', label: t('vbReferees'), icon: <Gavel className={iconClass} /> },
            { to: '/admin/referee-expenses', label: t('refereeExpenses'), icon: <Banknote className={iconClass} /> },
          ] : []),
        ] as NavItem[],
      },
      {
        label: t('adminGroupMembers'),
        items: [
          ...(isAdmin ? [
            { to: '/admin/anmeldungen', label: t('anmeldungen'), icon: <UserPlus className={iconClass} /> },
            // International transfers (AdminRoute). Label lives in the `admin`
            // namespace with the rest of the page's strings, hence the `admin:`
            // prefix — same cross-namespace form as the finance items above.
            { to: '/admin/transfers', label: t('admin:trNavTransfers'), icon: <ArrowRightLeft className={iconClass} /> },
            { to: '/admin/announcements', label: t('announcements'), icon: <Megaphone className={iconClass} /> },
          ] : []),
          // Club mailbox: admin||superuser only — mirrors the server's
          // authForAccount('admin'). NOT isAdmin (that includes vb/bb admins,
          // whom the server 403s) and NOT isVorstand (board was rejected).
          ...(isGlobalAdmin ? [{ to: '/admin/mailbox', label: t('clubMailbox'), icon: <Mail className={iconClass} /> }] : []),
          ...(isAdmin ? [
            // Editable transactional email copy (migration 287). isAdmin, matching
            // the route's AdminRoute guard and the policy grants (Sport Admin +
            // Vorstand hold email_templates CRUD).
            { to: '/admin/email-templates', label: t('admin:etTitle'), icon: <MailOpen className={iconClass} /> },
            { to: '/admin/reports', label: t('moderationReports'), icon: <Flag className={iconClass} /> },
            { to: '/admin/volley-feedback', label: t('volleyFeedback'), icon: <MessageSquare className={iconClass} /> },
          ] : []),
        ] as NavItem[],
      },
      {
        label: t('adminGroupData'),
        items: [
          ...(isAdmin ? [
            { to: '/admin/explore', label: t('adminExplorer'), icon: <Database className={iconClass} /> },
            { to: '/admin/club-stats', label: t('clubStats'), icon: <BarChart3 className={iconClass} /> },
          ] : []),
        ] as NavItem[],
      },
    ].filter((g) => g.items.length > 0),
    superadminItems: [
      { to: '/admin/infra', label: t('infraHealth'), icon: <Activity className={iconClass} /> },
      { to: '/admin/data-health', label: t('dataHealth'), icon: <HeartPulse className={iconClass} /> },
      { to: '/admin/clubdesk-sync', label: t('clubdeskSync'), icon: <FolderSync className={iconClass} /> },
      { to: '/bugfixes', label: t('bugfixes'), icon: <Bug className={iconClass} /> },
      { to: '/admin/audit-log', label: t('auditLog'), icon: <ScrollText className={iconClass} /> },
      { to: '/admin/error-logs', label: t('errorLogs'), icon: <FileWarning className={iconClass} /> },
      { to: '/admin/sql', label: t('sqlWorkspace'), icon: <Terminal className={iconClass} /> },
    ] as NavItem[],
  }
}
