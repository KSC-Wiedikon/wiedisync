import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { hasApiErrorCode } from '@/lib/apiErrorCode'
import { kscwApi } from '../../../lib/api'
import type { DutySeatToFill } from '../../../hooks/useDutyRecheck'

interface Candidate {
  id: number
  first_name: string
  last_name: string
  teams: string
  clash: boolean
  invited: boolean
}

const SEARCH_DELAY_MS = 250

/**
 * The game team's coach or team responsible looks for somebody for an empty seat. The
 * person gets a question and has to accept, as with a delegation; the first yes takes it.
 */
export default function DutyReplacementModal({ seat, roleLabel, onClose, onAsked }: {
  seat: DutySeatToFill
  roleLabel: string
  onClose: () => void
  onAsked: () => void
}) {
  const { t } = useTranslation('scorer')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['duty-recheck', 'candidates', seat.game, seat.role, q],
    queryFn: () => kscwApi<{ data: Candidate[] }>(
      `/duty-recheck/candidates?game=${seat.game}&role=${seat.role}&q=${encodeURIComponent(q)}`,
    ),
  })
  const candidates = data?.data ?? []

  async function ask(c: Candidate) {
    setBusy(c.id)
    try {
      await kscwApi('/duty-recheck/invite', { method: 'POST', body: { game: seat.game, role: seat.role, member: c.id } })
      setAsked((prev) => new Set(prev).add(c.id))
      toast.success(t('fillAskDone', { name: `${c.first_name} ${c.last_name}`.trim() }))
      onAsked()
    } catch (err) {
      toast.error(t(
        hasApiErrorCode(err, 'seat_taken') ? 'recheckSeatGone'
          : hasApiErrorCode(err, 'duty_clash') ? 'fillAskClash'
            : 'fillAskError',
      ))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('fillModalTitle', { role: roleLabel })} size="lg">
      <p className="text-sm text-muted-foreground">
        {seat.home_team} – {seat.away_team}, {seat.date}, {seat.time}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t('fillHint')}</p>
      <Input
        className="mt-3"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('fillSearch')}
        aria-label={t('fillSearch')}
      />
      <div className="mt-3">
        {isError ? (
          <p className="py-6 text-center text-sm text-destructive">{t('fillLoadError')}</p>
        ) : isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground" aria-busy="true">{t('fillLoading')}</p>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('fillEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fillName')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('fillTeam')}</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c) => {
                const done = c.invited || asked.has(c.id)
                return (
                  <TableRow key={c.id} className="min-h-11">
                    <TableCell className="whitespace-normal">
                      <span className="block font-medium text-foreground">{c.last_name}</span>
                      <span className="block text-xs text-muted-foreground">{c.first_name}</span>
                      {c.clash && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {t('fillClash')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-sm text-muted-foreground sm:table-cell">{c.teams}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant={done ? 'outline' : 'default'}
                        disabled={done || c.clash || busy !== null}
                        onClick={() => ask(c)}
                      >
                        {t(done ? 'fillAsked' : 'fillAsk')}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Modal>
  )
}
