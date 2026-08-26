import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../lib/api'
import { formatDateZurich } from '../../utils/dateHelpers'

type ReaderState = 'holds' | 'stale' | 'missing' | 'no_key' | 'former'

interface Reader {
  member: number
  first_name: string | null
  last_name: string | null
  is_self: boolean
  state: ReaderState
}

interface AccessDoc {
  member: number
  first_name: string
  last_name: string
  uploaded_at: string
  readers: Reader[]
}

/** Order matters: this is also the visual severity order in each cell. */
const STATE_ORDER: ReaderState[] = ['holds', 'stale', 'missing', 'no_key', 'former']

const STATE_CLASS: Record<ReaderState, string> = {
  holds: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200',
  stale: 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-200',
  missing: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
  no_key: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  former: 'bg-purple-100 text-purple-900 dark:bg-purple-900/50 dark:text-purple-200',
}

/**
 * Who can actually open each identity document on this team.
 *
 * The reason this is worth a screen of its own: "is on the grant list" and "can open it" are
 * different facts, and every way of finding out the difference used to happen at the hall.
 * A coach whose keypair postdates the upload holds nothing, and looks identical to one who
 * holds everything until the moment it matters.
 *
 * The five states are not decoration — they have different fixes:
 *   Can open      nothing to do
 *   Will not open the key they were wrapped to no longer exists; they must be re-granted
 *   No key yet    entitled, repairable from the team page banner
 *   No setup      has no keypair AT ALL — nobody can repair this until they create one
 *   Former staff  left the team and still holds a key, because removing someone from a team
 *                 does not reach into their device. Only re-uploading revokes it.
 */
export default function TeamIdentityAccessModal({
  teamId, open, onOpenChange,
}: { teamId: string | undefined; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation('teams')
  // Stamped and derived, so reopening for a different team shows a spinner rather than the
  // previous team's readers — and so nothing is written to state during the effect body.
  const [loaded, setLoaded] = useState<{ team: string; docs: AccessDoc[] } | null>(null)

  useEffect(() => {
    if (!open || !teamId) return
    let cancelled = false
    kscwApi<{ data: { documents: AccessDoc[] } }>(`/identity/access/${teamId}`)
      .then((res) => { if (!cancelled) setLoaded({ team: teamId, docs: res.data?.documents ?? [] }) })
      .catch(() => { if (!cancelled) setLoaded({ team: teamId, docs: [] }) })
    return () => { cancelled = true }
  }, [teamId, open])

  const docs = loaded && loaded.team === teamId ? loaded.docs : null

  const name = (r: Reader) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `#${r.member}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('identityAccessTitle')}</DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-relaxed text-muted-foreground">{t('identityAccessHint')}</p>

        {docs === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : docs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('identityAccessEmpty')}</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <TableHead>{t('identityAccessPlayer')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('identityAccessUploaded')}</TableHead>
                  <TableHead>{t('identityAccessReaders')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.member} className="min-h-[44px]">
                    <TableCell className="whitespace-normal break-words font-medium">
                      {d.last_name}<br className="sm:hidden" /><span className="hidden sm:inline"> </span>{d.first_name}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs text-muted-foreground sm:table-cell">
                      {formatDateZurich(d.uploaded_at)}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <div className="flex flex-wrap gap-1">
                        {[...d.readers]
                          .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))
                          .map((r) => (
                            <span
                              key={r.member}
                              title={t(`identityState_${r.state}`)}
                              className={`rounded px-1.5 py-0.5 text-xs ${STATE_CLASS[r.state]}`}
                            >
                              {name(r)}{r.is_self && ` (${t('identityAccessOwner')})`}
                            </span>
                          ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* The legend is load-bearing: without it the colours are decoration, and the
            difference between "repairable" and "they must create a key" is invisible. */}
        <div className="flex flex-wrap gap-2 pt-1">
          {STATE_ORDER.map((s) => (
            <span key={s} className={`rounded px-1.5 py-0.5 text-xs ${STATE_CLASS[s]}`}>
              {t(`identityState_${s}`)}
            </span>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
