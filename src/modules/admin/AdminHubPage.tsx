import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, LayoutGrid, Search } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { buildAdminNav, type AdminAccess, type AdminNavEntry } from '../../lib/adminNav'
import { SCHEDULING_ORIGIN } from '../../lib/api'
import { openExternalApp } from '../../utils/pwa'
import { Input } from '../../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'

/**
 * The admin hub — every admin destination the current user can reach, in one
 * searchable table. Reached from the Admin dropdown's footer link (and directly
 * at /admin). The entries come from `lib/adminNav`, the same definition the
 * navbar mega-menu and the mobile sheet read, so this page can never fall behind
 * a newly added admin page.
 *
 * The list is already role-gated by `buildAdminNav`; the Access column says who
 * ELSE reaches a tool, which is what makes the difference between the sport
 * admins (vb_admin/bb_admin), the club admins and the superadmins legible.
 */

const ACCESS_LABEL: Record<AdminAccess, string> = {
  admin: 'hubAccessAdmin',
  globalAdmin: 'hubAccessGlobal',
  superadmin: 'hubAccessSuper',
}

const ACCESS_STYLE: Record<AdminAccess, string> = {
  admin: 'bg-gray-100 text-gray-600 dark:bg-brand-800 dark:text-gray-300',
  globalAdmin: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  superadmin: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

export default function AdminHubPage() {
  const { t } = useTranslation('admin')
  const { t: tNav } = useTranslation('nav')
  const navigate = useNavigate()
  const { isAdmin, isGlobalAdmin, isSuperAdmin, is_spielplaner } = useAuth()
  const [query, setQuery] = useState('')

  // Scheduling lives on its own subdomain in every deployed environment; on
  // localhost (SCHEDULING_ORIGIN === this origin) it stays an in-app route.
  const schedExternal = typeof window !== 'undefined' && SCHEDULING_ORIGIN.replace(/\/$/, '') !== window.location.origin
  const schedTo = isAdmin || is_spielplaner ? '/admin/terminplanung' : '/admin/spielplanung'

  const groups = useMemo(
    () =>
      buildAdminNav({
        isAdmin,
        isGlobalAdmin,
        isSuperAdmin,
        scheduling: {
          to: schedTo,
          href: schedExternal ? `${SCHEDULING_ORIGIN}${schedTo}` : undefined,
          external: schedExternal,
          labelKey: 'spielplanung',
          icon: CalendarClock,
          access: 'admin',
        },
      }),
    [isAdmin, isGlobalAdmin, isSuperAdmin, schedTo, schedExternal],
  )

  // Flatten to rows once — the table is one list so a search hit in "Club email"
  // and one in "Superadmin" sit next to each other instead of behind headers.
  const rows = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((e) => ({ entry: e, label: tNav(e.labelKey), section: tNav(g.labelKey) })),
      ),
    [groups, tNav],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.label} ${r.section}`.toLowerCase().includes(q))
  }, [rows, query])

  const open = (e: AdminNavEntry) => {
    if (e.external && e.href) openExternalApp(e.href)
    else navigate(e.to)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <LayoutGrid className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('hubTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('hubSubtitle')}</p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder={t('hubSearch')}
          aria-label={t('hubSearch')}
          className="h-11 pl-9 dark:bg-brand-900/40"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('hubColTool')}</TableHead>
              <TableHead>{t('hubColSection')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('hubColAccess')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(({ entry, label, section }) => (
              <TableRow
                key={entry.to}
                onClick={() => open(entry)}
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    open(entry)
                  }
                }}
                className="cursor-pointer"
              >
                <TableCell className="min-h-[44px] whitespace-normal break-words font-medium text-gray-900 dark:text-gray-100">
                  <span className="flex items-center gap-2.5">
                    <entry.icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                    {label}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal break-words text-sm text-gray-500 dark:text-gray-400">
                  {section}
                </TableCell>
                <TableCell className="hidden whitespace-normal sm:table-cell">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACCESS_STYLE[entry.access]}`}>
                    {t(ACCESS_LABEL[entry.access])}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('hubNone')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
