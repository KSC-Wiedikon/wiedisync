import {
  Hand, Smartphone, KeyRound, Compass, Home, Bell, Calendar, Trophy, Dumbbell,
  PartyPopper, UserX, PenSquare, Users, User, HeartHandshake, ScrollText, BarChart3,
  MessageSquare, Wallet, ReceiptText, Gavel, ClipboardList, FileText, Send,
  Landmark, Scale, CalendarClock, Building2, GraduationCap, ShieldCheck,
  CalendarRange, Radio, ClipboardCheck, Megaphone, Database, LayoutGrid,
} from 'lucide-react'
import type { AuthContextValue } from '../../hooks/useAuth'
import type { GuideGroup, GuideSectionDef } from './types'

export const GUIDE_GROUPS: GuideGroup[] = ['basics', 'everyday', 'finance', 'teams', 'admin']

// Role predicates — mirror the nav gating (useNavItems / adminNav / financeNav),
// not the admin-mode toggle: the guide describes what a role CAN do.
const everyone = () => true
const leads = (a: AuthContextValue) => a.isCoach || a.teamResponsibleIds.length > 0 || a.isAdmin
const captain = (a: AuthContextValue) => a.captainTeamIds.length > 0 || leads(a)
const spielplaner = (a: AuthContextValue) => a.is_spielplaner || a.isAdmin
const finance = (a: AuthContextValue) => a.canAccessFinance
const vorstand = (a: AuthContextValue) => a.isVorstand || a.isAdmin
const admin = (a: AuthContextValue) => a.isAdmin

/**
 * Every section of the guide, in reading order. Content for `sections.<id>`
 * must exist in all five locales (a vitest asserts it).
 *
 * `routes` are path patterns (a `*` matches one path segment) that the "?"
 * help button resolves against; the longest matching pattern wins, so
 * `/admin/hallenplan/halls` beats `/admin/hallenplan`. `open` is the page the
 * section's "Go to this page" action leads to — omitted where there is no
 * single page (navigation, welcome) or the reader is already on it (account).
 */
export const guideSections: GuideSectionDef[] = [
  // ── Basics ────────────────────────────────────────────────────────────
  { id: 'welcome', group: 'basics', icon: Hand, audience: 'everyone', canAccess: everyone, routes: [] },
  { id: 'install', group: 'basics', icon: Smartphone, audience: 'everyone', canAccess: everyone, routes: [] },
  { id: 'account', group: 'basics', icon: KeyRound, audience: 'everyone', canAccess: everyone, routes: ['/login', '/signup', '/set-password', '/pending', '/join'] },
  { id: 'navigation', group: 'basics', icon: Compass, audience: 'everyone', canAccess: everyone, routes: [] },
  { id: 'home', group: 'basics', icon: Home, audience: 'everyone', canAccess: everyone, routes: ['/'], open: '/' },
  { id: 'notifications', group: 'basics', icon: Bell, audience: 'everyone', canAccess: everyone, routes: ['/news'], open: '/news' },

  // ── Everyday ──────────────────────────────────────────────────────────
  { id: 'calendar', group: 'everyday', icon: Calendar, audience: 'everyone', canAccess: everyone, routes: ['/calendar'], open: '/calendar' },
  { id: 'games', group: 'everyday', icon: Trophy, audience: 'everyone', canAccess: everyone, routes: ['/games', '/live', '/embed/games'], open: '/games' },
  { id: 'trainings', group: 'everyday', icon: Dumbbell, audience: 'everyone', canAccess: everyone, routes: ['/trainings'], open: '/trainings' },
  { id: 'events', group: 'everyday', icon: PartyPopper, audience: 'everyone', canAccess: everyone, routes: ['/events', '/e'], open: '/events' },
  { id: 'absences', group: 'everyday', icon: UserX, audience: 'everyone', canAccess: everyone, routes: ['/absences'], open: '/absences' },
  { id: 'scorer', group: 'everyday', icon: PenSquare, audience: 'everyone', canAccess: everyone, routes: ['/scorer'], open: '/scorer' },
  { id: 'teams', group: 'everyday', icon: Users, audience: 'everyone', canAccess: everyone, routes: ['/teams'], open: '/teams' },
  { id: 'profile', group: 'everyday', icon: User, audience: 'everyone', canAccess: everyone, routes: ['/profile'], open: '/profile' },
  { id: 'household', group: 'everyday', icon: HeartHandshake, audience: 'everyone', canAccess: everyone, routes: [], open: '/profile' },
  { id: 'forms', group: 'everyday', icon: ScrollText, audience: 'everyone', canAccess: everyone, routes: ['/forms', '/f'], open: '/forms' },
  { id: 'polls', group: 'everyday', icon: BarChart3, audience: 'everyone', canAccess: everyone, routes: [], open: '/' },
  { id: 'feedback', group: 'everyday', icon: MessageSquare, audience: 'everyone', canAccess: everyone, routes: ['/feedback', '/status', '/changelog', '/support', '/datenschutz', '/impressum'], open: '/feedback' },

  // ── Finance (member level) ────────────────────────────────────────────
  { id: 'dues', group: 'finance', icon: Wallet, audience: 'everyone', canAccess: everyone, routes: ['/finance/dues'], open: '/finance/dues' },
  { id: 'expenses', group: 'finance', icon: ReceiptText, audience: 'everyone', canAccess: everyone, routes: ['/finance/expense'], open: '/finance/expense' },
  { id: 'fines', group: 'finance', icon: Gavel, audience: 'everyone', canAccess: everyone, routes: ['/fines'], open: '/fines' },

  // ── Teams & coaching ──────────────────────────────────────────────────
  { id: 'roster', group: 'teams', icon: ClipboardList, audience: 'coach', canAccess: leads, routes: ['/teams/*/roster/edit'], open: '/teams' },
  { id: 'coaching', group: 'teams', icon: Dumbbell, audience: 'coach', canAccess: leads, routes: [], open: '/trainings' },
  { id: 'matchsheet', group: 'teams', icon: FileText, audience: 'captain', canAccess: captain, routes: [], open: '/games' },
  { id: 'broadcast', group: 'teams', icon: Send, audience: 'coach', canAccess: leads, routes: [] },
  // Team finance is on the nav for anyone on a team (financeNav `hasTeam`), so
  // players may read this section too; the badge still says who runs it.
  { id: 'teamfinance', group: 'teams', icon: Landmark, audience: 'captain', canAccess: (a) => a.memberTeamIds.length > 0 || captain(a), routes: ['/finance/team'], open: '/finance/team' },
  { id: 'finerules', group: 'teams', icon: Scale, audience: 'coach', canAccess: leads, routes: [], open: '/fines' },
  { id: 'formsauthoring', group: 'teams', icon: ScrollText, audience: 'coach', canAccess: leads, routes: ['/forms/new', '/forms/*/edit'], open: '/forms' },
  { id: 'hallbooking', group: 'teams', icon: CalendarClock, audience: 'coach', canAccess: leads, routes: ['/admin/hallenplan', '/admin/hallenfinder'], open: '/calendar' },
  { id: 'teamabsences', group: 'teams', icon: Building2, audience: 'coach', canAccess: leads, routes: [], open: '/absences' },
  { id: 'jsexport', group: 'teams', icon: GraduationCap, audience: 'coach', canAccess: leads, routes: ['/js-export'], open: '/js-export' },
  { id: 'documents', group: 'teams', icon: ShieldCheck, audience: 'coach', canAccess: leads, routes: [], open: '/teams' },

  // ── Admin & scheduling ────────────────────────────────────────────────
  { id: 'spielplanung', group: 'admin', icon: CalendarRange, audience: 'spielplaner', canAccess: spielplaner, routes: ['/admin/spielplanung', '/admin/terminplanung', '/terminplanung'], open: '/admin/spielplanung' },
  { id: 'hallenplanadmin', group: 'admin', icon: Radio, audience: 'admin', canAccess: admin, routes: ['/admin/hallenplan/closures', '/admin/hallenplan/halls'], open: '/admin/hallenplan/halls' },
  { id: 'scorerassign', group: 'admin', icon: ClipboardCheck, audience: 'admin', canAccess: admin, routes: ['/admin/scorer-assign'], open: '/admin/scorer-assign' },
  { id: 'registrations', group: 'admin', icon: Users, audience: 'admin', canAccess: admin, routes: ['/admin/anmeldungen'], open: '/admin/anmeldungen' },
  { id: 'announcements', group: 'admin', icon: Megaphone, audience: 'admin', canAccess: admin, routes: ['/admin/announcements', '/admin/email-templates', '/admin/mailbox', '/admin/emails-garage'], open: '/admin/announcements' },
  { id: 'clubfinance', group: 'admin', icon: Landmark, audience: 'finance', canAccess: finance, routes: ['/admin/finance', '/finance/tk-expenses', '/admin/referee-expenses'], open: '/admin/finance' },
  { id: 'explorer', group: 'admin', icon: Database, audience: 'admin', canAccess: admin, routes: ['/admin/explore', '/admin/sql', '/admin/data-health'], open: '/admin/explore' },
  { id: 'admintools', group: 'admin', icon: LayoutGrid, audience: 'vorstand', canAccess: vorstand, routes: ['/admin', '/bugfixes'], open: '/admin' },
]

function patternMatches(pattern: string, pathname: string): boolean {
  if (pattern === '/') return pathname === '/'
  if (!pattern.includes('*')) return pathname === pattern || pathname.startsWith(pattern + '/')
  const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '(/|$)')
  return re.test(pathname)
}

/** The section whose `routes` best matches a pathname (longest pattern wins). */
export function sectionForPath(pathname: string): GuideSectionDef | null {
  let best: GuideSectionDef | null = null
  let bestLen = -1
  for (const s of guideSections) {
    for (const r of s.routes) {
      if (patternMatches(r, pathname) && r.length > bestLen) { best = s; bestLen = r.length }
    }
  }
  return best
}
