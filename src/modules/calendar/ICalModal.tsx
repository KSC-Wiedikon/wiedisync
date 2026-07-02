import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import { teamNameToColorKey } from '../../utils/teamColors'
import { relId } from '../../utils/relations'
import { useTeams } from '../../hooks/useTeams'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { downloadICal } from '../../utils/icalGenerator'
import type { CalendarEntry } from '../../types/calendar'
import { API_URL, kscwApi } from '../../lib/api'
import { toast } from 'sonner'


// iCal feeds are served from THIS origin (the wiedisync host) via the
// /kscw/ical Pages Function, so subscribers only ever see the on-brand URL.
// Localhost has no Function, so fall back to the Directus API origin there.
const isLocalhostIcal =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local'))
const BASE_URL = isLocalhostIcal ? API_URL : window.location.origin

type ICalMode = 'subscribe' | 'download'

interface ICalModalProps {
  open: boolean
  mode: ICalMode
  onClose: () => void
  /** Current visible entries (used for download mode) */
  entries: CalendarEntry[]
}

type SourceCategory = 'trainings' | 'games' | 'events'

/** Map each checkbox to the iCal API source values */
const categoryToSources: Record<SourceCategory, string[]> = {
  trainings: ['trainings'],
  games: ['games-home', 'games-away'],
  events: ['events'],
}

function categoryMatchesEntry(categories: SourceCategory[], entry: CalendarEntry): boolean {
  for (const cat of categories) {
    if (cat === 'games' && entry.type === 'game') return true
    if (cat === 'trainings' && entry.type === 'training') return true
    if (cat === 'events' && entry.type === 'event') return true
  }
  return false
}

export default function ICalModal({ open, mode, onClose, entries }: ICalModalProps) {
  const { t } = useTranslation('calendar')
  const { t: tCommon } = useTranslation('common')
  const { data: teams } = useTeams()
  const { memberTeamIds, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()

  const [selectedCategories, setSelectedCategories] = useState<SourceCategory[]>([
    'trainings',
    'games',
    'events',
  ])
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [linkShown, setLinkShown] = useState(false)
  const [copied, setCopied] = useState(false)

  // Personal "my scoring duties" feed — token-scoped to the logged-in member.
  const [personalToken, setPersonalToken] = useState<string | null>(null)
  const [personalShown, setPersonalShown] = useState(false)
  const [personalLoading, setPersonalLoading] = useState(false)
  const [personalCopied, setPersonalCopied] = useState(false)
  const personalUrl = personalToken ? `${BASE_URL}/kscw/ical?source=duties&token=${personalToken}` : ''
  const personalWebcal = personalUrl.replace(/^https?:/, 'webcal:')

  // iCal subscription URL — recomputed live as categories/teams change so the
  // revealed link always matches the current selection.
  const subscribeUrl = useMemo(() => {
    const params = new URLSearchParams()
    // Clean URL: `source=all` when every category is selected, otherwise one
    // `&source=` per value (no encoded-comma soup, e.g. ?source=games-home&source=trainings).
    // `team` likewise repeats per id. The feed still accepts the legacy comma form.
    const allCategories: SourceCategory[] = ['trainings', 'games', 'events']
    if (allCategories.every((c) => selectedCategories.includes(c))) {
      params.append('source', 'all')
    } else {
      for (const s of selectedCategories.flatMap((cat) => categoryToSources[cat])) {
        params.append('source', s)
      }
    }
    for (const id of selectedTeamIds) params.append('team', id)
    return `${BASE_URL}/kscw/ical?${params.toString()}`
  }, [selectedCategories, selectedTeamIds])
  const webcalUrl = subscribeUrl.replace(/^https?:/, 'webcal:')

  const title = mode === 'subscribe' ? t('icalSubscribeTitle') : t('icalDownloadTitle')

  const categoryOptions: { value: SourceCategory; label: string }[] = [
    { value: 'trainings', label: t('sourceTrainings') },
    { value: 'games', label: t('sourceGames') },
    { value: 'events', label: t('sourceEvents') },
  ]

  // Only show user's own teams (member + coach), unless admin
  const userTeamIds = useMemo(() => {
    const set = new Set([...memberTeamIds, ...coachTeamIds])
    return [...set]
  }, [memberTeamIds, coachTeamIds])

  const visibleTeams = useMemo(() => {
    if (effectiveIsAdmin || effectiveIsVorstand) return teams
    return teams.filter((t) => userTeamIds.includes(t.id))
  }, [teams, effectiveIsAdmin, effectiveIsVorstand, userTeamIds])

  function toggleCategory(cat: SourceCategory) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(subscribeUrl)
      setCopied(true)
      toast.success(t('icalLinkCopied'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('icalCopyFailed'))
    }
  }

  function handleConfirm() {
    if (mode === 'subscribe') {
      // Reveal the subscription link + copy it to the clipboard. A direct
      // webcal:// auto-open is unreliable on desktop browsers (Brave/Chrome
      // silently ignore it), so we surface the link for the user to paste into
      // their calendar app.
      setLinkShown(true)
      void copyLink()
      return
    }
    // Download: filter current entries client-side
    let filtered = entries
    if (selectedCategories.length < 3) {
      filtered = entries.filter((e) => categoryMatchesEntry(selectedCategories, e))
    }
    if (selectedTeamIds.length > 0) {
      filtered = filtered.filter((e) => {
        // Games: check source.kscw_team; Trainings: check source.team.
        // kscw_team is EXPANDED to an object by useCalendarData, so extract the
        // id via relId (was compared as an object → filter dropped all games).
        const src = e.source as Record<string, unknown>
        const teamId = relId(src.kscw_team ?? src.team)
        return !teamId || selectedTeamIds.includes(teamId)
      })
    }
    downloadICal(filtered, 'wiedisync-kalender.ics')
    onClose()
  }

  async function revealPersonal() {
    setPersonalLoading(true)
    try {
      let tok = personalToken
      if (!tok) {
        const res = await kscwApi<{ data: { token: string } }>('/me/ical-token')
        tok = res.data.token
        setPersonalToken(tok)
      }
      setPersonalShown(true)
      try {
        await navigator.clipboard.writeText(`${BASE_URL}/kscw/ical?source=duties&token=${tok}`)
        setPersonalCopied(true)
        toast.success(t('icalLinkCopied'))
        window.setTimeout(() => setPersonalCopied(false), 2000)
      } catch {
        toast.error(t('icalCopyFailed'))
      }
    } catch {
      toast.error(t('icalDutiesError'))
    } finally {
      setPersonalLoading(false)
    }
  }

  async function copyPersonal() {
    try {
      await navigator.clipboard.writeText(personalUrl)
      setPersonalCopied(true)
      toast.success(t('icalLinkCopied'))
      window.setTimeout(() => setPersonalCopied(false), 2000)
    } catch {
      toast.error(t('icalCopyFailed'))
    }
  }

  function handleClose() {
    setLinkShown(false)
    setCopied(false)
    setPersonalShown(false)
    setPersonalCopied(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} size="sm">
      <div className="space-y-5">
        {/* Category selection (checkboxes) */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('icalFilterLabel')}
          </p>
          <div className="space-y-1">
            {categoryOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50 sm:min-h-0 dark:hover:bg-gray-700"
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(opt.value)}
                  onChange={() => toggleCategory(opt.value)}
                  className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Team filter — only user's own teams (admins see all) */}
        {visibleTeams.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('icalTeamFilter')}
            </p>
            {(() => {
              const hasVB = visibleTeams.some((tm) => tm.sport === 'volleyball')
              const hasBB = visibleTeams.some((tm) => tm.sport === 'basketball')
              const showGroups = hasVB && hasBB
              const teamOptions = visibleTeams
                .filter((tm) => tm.sport === 'volleyball' || tm.sport === 'basketball')
                .map((tm) => ({
                  value: tm.id,
                  label: showGroups
                    ? (tm.sport === 'volleyball' ? `VB-${tm.name}` : `BB-${tm.name}`)
                    : tm.name,
                  colorKey: teamNameToColorKey(tm.name, tm.sport),
                  group: showGroups
                    ? (tm.sport === 'volleyball' ? 'Volleyball' : 'Basketball')
                    : undefined,
                }))
              return (
                <TeamMultiSelect
                  options={teamOptions}
                  selected={selectedTeamIds}
                  onChange={setSelectedTeamIds}
                  placeholder={tCommon('allTeams')}
                />
              )
            })()}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('icalTeamHint')}</p>
          </div>
        )}

        {/* Confirm button */}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selectedCategories.length === 0}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50"
        >
          {mode === 'subscribe' ? t('icalGenerateLink') : t('exportICal')}
        </button>

        {/* Subscription link — revealed after "Generate link" */}
        {mode === 'subscribe' && linkShown && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('icalLinkReadyLabel')}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={subscribeUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              />
              <button
                type="button"
                onClick={copyLink}
                className="shrink-0 rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700 active:bg-brand-800"
              >
                {copied ? t('icalLinkCopied') : t('icalCopyLink')}
              </button>
            </div>
            <a
              href={webcalUrl}
              className="inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('icalOpenInApp')}
            </a>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('icalSubscribeHint')}</p>
          </div>
        )}

        {/* Personal feed — your own scorer/scoreboard duties (token-scoped) */}
        {mode === 'subscribe' && (
          <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('icalDutiesTitle')}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('icalDutiesHint')}</p>
            </div>
            {!personalShown ? (
              <button
                type="button"
                onClick={revealPersonal}
                disabled={personalLoading}
                className="w-full rounded-lg border border-brand-300 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-50 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50"
              >
                {t('icalDutiesGenerate')}
              </button>
            ) : (
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={personalUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                  />
                  <button
                    type="button"
                    onClick={copyPersonal}
                    className="shrink-0 rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700 active:bg-brand-800"
                  >
                    {personalCopied ? t('icalLinkCopied') : t('icalCopyLink')}
                  </button>
                </div>
                <a
                  href={personalWebcal}
                  className="inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t('icalOpenInApp')}
                </a>
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('icalDutiesPrivacyHint')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
