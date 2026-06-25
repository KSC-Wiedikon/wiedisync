import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollection } from '../../lib/query'
import { formatDateZurich } from '../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DashboardSection from './components/DashboardSection'
import { useReportPageLoading } from '../../hooks/usePageReady'

// ── Types ────────────────────────────────────────────────────────

interface VolleyFeedback {
  id: string
  date_created: string
  season: string
  is_anonymous: boolean
  name: string | null
  functions: string[] | null
  teams: string[] | null
  other_function: string | null
  other_team: string | null
  rating_verein: number | null
  rating_vorstand: number | null
  rating_tk_leitung: number | null
  rating_training: number | null
  rating_kommunikation: number | null
  feedback_text: string | null
  ideas_text: string | null
  other_text: string | null
  locale: string | null
}

const RATING_KEYS = [
  'rating_verein',
  'rating_vorstand',
  'rating_tk_leitung',
  'rating_training',
  'rating_kommunikation',
] as const

const RATING_I18N_KEYS: Record<(typeof RATING_KEYS)[number], string> = {
  rating_verein: 'vfRatingClub',
  rating_vorstand: 'vfRatingBoard',
  rating_tk_leitung: 'vfRatingTk',
  rating_training: 'vfRatingTraining',
  rating_kommunikation: 'vfRatingComm',
}

const TEAM_COLORS: Record<string, { bg: string; text: string }> = {
  H1: { bg: '#1e40af', text: '#fff' },
  H2: { bg: '#2563eb', text: '#fff' },
  H3: { bg: '#3b82f6', text: '#fff' },
  Legends: { bg: '#1e3a5f', text: '#fff' },
  D1: { bg: '#be123c', text: '#fff' },
  D2: { bg: '#e11d48', text: '#fff' },
  D3: { bg: '#f43f5e', text: '#1a1a2e' },
  D4: { bg: '#fb7185', text: '#1a1a2e' },
  'DU23-1': { bg: '#fda4af', text: '#881337' },
  'DU23-2': { bg: '#fda4af', text: '#881337' },
  HU23: { bg: '#60a5fa', text: '#1e3a8a' },
  HU20: { bg: '#93c5fd', text: '#1e3a8a' },
}

// ── Helpers ──────────────────────────────────────────────────────

function computeAverages(items: VolleyFeedback[]) {
  const avgs: Record<string, number> = {}
  for (const key of RATING_KEYS) {
    const vals = items.map(i => i[key]).filter((v): v is number => v != null)
    avgs[key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  return avgs
}

function formatDate(d: string) {
  return formatDateZurich(d)
}

function TeamChips({ teams }: { teams: string[] | null }) {
  if (!teams || teams.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {teams.map(t => {
        const c = TEAM_COLORS[t] || { bg: '#e2e8f0', text: '#333' }
        return (
          <span
            key={t}
            className="inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
            style={{ backgroundColor: c.bg, color: c.text }}
          >
            {t}
          </span>
        )
      })}
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────

export default function VolleyFeedbackPage() {
  const { t } = useTranslation('admin')
  const [teamFilter, setTeamFilter] = useState('')
  const [selectedItem, setSelectedItem] = useState<VolleyFeedback | null>(null)

  const { data: items = [], isLoading, error } = useCollection<VolleyFeedback>(
    'volley_feedback',
    { sort: ['-date_created'], all: true },
  )

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  const averages = useMemo(() => computeAverages(items), [items])
  const anonCount = useMemo(() => items.filter(i => i.is_anonymous).length, [items])

  const allTeams = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => i.teams?.forEach(t => set.add(t)))
    return [...set].sort()
  }, [items])

  const filtered = useMemo(
    () => teamFilter ? items.filter(i => i.teams?.includes(teamFilter)) : items,
    [items, teamFilter],
  )

  function exportCSV() {
    const headers = ['Date', 'Name', 'Anonymous', 'Functions', 'Teams', 'Club', 'Board', 'TK Leadership', 'Training', 'Communication', 'Feedback', 'Ideas', 'Other']
    const rows = filtered.map(i => [
      i.date_created ? formatDateZurich(i.date_created) : '',
      i.is_anonymous ? t('vfAnon') : (i.name || ''),
      i.is_anonymous ? t('vfYes') : t('vfNo'),
      i.functions?.join(', ') || '',
      i.teams?.join(', ') || '',
      i.rating_verein ?? '', i.rating_vorstand ?? '', i.rating_tk_leitung ?? '',
      i.rating_training ?? '', i.rating_kommunikation ?? '',
      (i.feedback_text || '').replace(/[\r\n]+/g, ' '),
      (i.ideas_text || '').replace(/[\r\n]+/g, ' '),
      (i.other_text || '').replace(/[\r\n]+/g, ' '),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))

    const csv = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kscw-volley-feedback-2025-2026.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Volley Feedback</h1>

      {/* Summary + rating cards */}
      <DashboardSection id="vf-summary" title={t('vfOverview')} icon="📊" isLoading={isLoading} error={error?.message}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-primary/5 p-3 text-center">
            <div className="text-2xl font-bold text-primary">{items.length}</div>
            <div className="text-xs text-muted-foreground">{t('vfResponses')}</div>
          </div>
          <div className="rounded-lg bg-primary/5 p-3 text-center">
            <div className="text-2xl font-bold text-primary">{anonCount}</div>
            <div className="text-xs text-muted-foreground">{t('vfAnonymous')}</div>
          </div>
          {RATING_KEYS.map(key => {
            const avg = averages[key] || 0
            return (
              <div key={key} className="rounded-lg bg-primary/5 p-3 text-center">
                <div className="text-2xl font-bold text-primary">{avg ? avg.toFixed(1) : '–'}</div>
                <div className="text-xs text-muted-foreground">⌀ {t(RATING_I18N_KEYS[key])}</div>
              </div>
            )
          })}
        </div>
      </DashboardSection>

      {/* Response table */}
      <DashboardSection id="vf-responses" title={t('vfIndividualResponses')} icon="💬" isLoading={isLoading} isEmpty={items.length === 0} emptyMessage={t('vfEmpty')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            <option value="">{t('vfAllTeams')}</option>
            {allTeams.map(team => <option key={team} value={team}>{team}</option>)}
          </select>
          <button
            onClick={exportCSV}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            CSV Export
          </button>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="text-xs text-muted-foreground">
              <TableHead>{t('vfDate')}</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Team</TableHead>
              {RATING_KEYS.map(k => (
                <TableHead key={k} className="text-center">{t(RATING_I18N_KEYS[k])}</TableHead>
              ))}
              <TableHead className="text-center">Text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => {
              const hasText = item.feedback_text || item.ideas_text || item.other_text
              return (
                <TableRow
                  key={item.id}
                  className={item.is_anonymous ? 'bg-secondary/10' : ''}
                >
                  <TableCell>{formatDate(item.date_created)}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {item.is_anonymous
                      ? <em className="text-muted-foreground">{t('vfAnon')}</em>
                      : (item.name || '—')}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">{item.is_anonymous ? '—' : <TeamChips teams={item.teams} />}</TableCell>
                  {RATING_KEYS.map(k => (
                    <TableCell key={k} className="text-center">{item[k] ?? '—'}</TableCell>
                  ))}
                  <TableCell className="text-center">
                    {hasText ? (
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="cursor-pointer hover:opacity-70"
                        title={t('vfReadText')}
                      >
                        💬
                      </button>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </DashboardSection>

      {/* Text detail modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-6 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('vfFeedbackDetails')}</h3>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-2xl leading-none text-muted-foreground hover:text-foreground"
              >
                &times;
              </button>
            </div>
            {selectedItem.name && !selectedItem.is_anonymous && (
              <p className="mb-3 text-sm text-muted-foreground">
                {selectedItem.name} — {selectedItem.teams?.join(', ') || ''} — {selectedItem.functions?.join(', ') || ''}
              </p>
            )}
            <div className="mb-4">
              <p className="mb-1 text-sm font-semibold">{t('vfFeedback')}:</p>
              <p className="whitespace-pre-wrap text-sm">{selectedItem.feedback_text && selectedItem.feedback_text !== 'undefined' ? selectedItem.feedback_text : '-'}</p>
            </div>
            <div className="mb-4">
              <p className="mb-1 text-sm font-semibold">{t('vfIdeas')}:</p>
              <p className="whitespace-pre-wrap text-sm">{selectedItem.ideas_text && selectedItem.ideas_text !== 'undefined' ? selectedItem.ideas_text : '-'}</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">{t('vfOther')}:</p>
              <p className="whitespace-pre-wrap text-sm">{selectedItem.other_text && selectedItem.other_text !== 'undefined' ? selectedItem.other_text : '-'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
