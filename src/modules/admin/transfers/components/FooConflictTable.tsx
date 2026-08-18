import { useTranslation } from 'react-i18next'
import { AlertTriangle, Ban, Clock } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../../../components/ui/table'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '../../../../components/ui/card'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { countryFlag, countryLabel } from '../../../../utils/countries'
import { memberName } from '../../../../utils/relations'
import { ClearStatusButton, TransferStatusButton } from './TransferStatusButton'
import type { FooConflict, FooConflictKind, TransferMember, TransferStatus } from '../types'

/** What each direction of the disagreement means, and how loudly to say it.
 *  `vmSaysForeign` is the dangerous one — we record CH and Swiss Volley records
 *  a foreign federation, so nobody is chasing a transfer that may be required. */
const MEANING_KEY: Record<FooConflictKind, string> = {
  vmSaysForeign: 'trFooConflictMeaningMissing',
  bothForeign: 'trFooConflictMeaningDiffers',
  vmSaysSwiss: 'trFooConflictMeaningNotNeeded',
}
const MEANING_VARIANT: Record<FooConflictKind, 'danger' | 'warning' | 'info'> = {
  vmSaysForeign: 'danger',
  bothForeign: 'warning',
  vmSaysSwiss: 'info',
}

/**
 * Where Swiss Volley's own federation of origin disagrees with ours.
 *
 * Swiss Volley works from THEIR value, not ours, so a disagreement is either a
 * transfer nobody is chasing or a transfer nobody needed.
 *
 * ⚠⚠ REPORTED, NEVER APPLIED. Nothing on this table may write
 * `federation_of_origin`: the disagreement IS the evidence that one of the two
 * registers needs fixing, and which one is a human question with two different
 * remedies (ask Swiss Volley to correct the register, or correct the member
 * here). A page that quietly adopted one side would destroy exactly that
 * evidence.
 *
 * The rows stay sorted dangerous-direction-first by the caller — `fooConflicts`
 * orders them, and this component preserves the order it is given.
 */
export function FooConflictTable({ conflicts, savingId, onSetStatus, onShowInWorklist }: {
  conflicts: readonly FooConflict[]
  savingId: string | null
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
  onShowInWorklist: (m: TransferMember) => void
}) {
  const { t } = useTranslation('admin')
  if (conflicts.length === 0) return null

  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
      <CardHeader className="p-4">
        <CardTitle className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="min-w-0">{t('trFooConflictBanner', { count: conflicts.length })}</span>
        </CardTitle>
        <CardDescription className="text-xs text-amber-800 dark:text-amber-200">
          {t('trFooConflictDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {/* ⚠ No `overflow-x-auto` wrapper: the Table primitive already renders
            its own `relative w-full overflow-x-auto` container, and two nested
            horizontal scroll containers make the touch swipe target ambiguous. */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('trFooConflictColMember')}</TableHead>
              <TableHead>{t('trFooConflictColOurs')}</TableHead>
              <TableHead>{t('trFooConflictColVm')}</TableHead>
              {/* The longest string on the page, and the ours-vs-theirs pair to
                  its left already carries the fact — so it goes at md and the
                  description above explains the semantics. */}
              <TableHead className="hidden md:table-cell">{t('trFooConflictColMeaning')}</TableHead>
              <TableHead>{t('trFooConflictColDecision')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conflicts.map((c) => {
              const saving = savingId === String(c.m.id)
              return (
                <TableRow key={String(c.m.id)}>
                  <TableCell className="align-top">
                    {/* ⚠ The 44px floor lives on this block child, not on the
                        `<td>`: min-height on a `display: table-cell` box is
                        unreliable — the row box governs the height. */}
                    <div className="flex min-h-[44px] min-w-0 flex-col justify-center whitespace-normal break-words">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {memberName(c.m)}
                      </span>
                      {/* From the disagreement back to the row that is being
                          worked — the two are on different tabs now. */}
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto w-fit justify-start px-0 text-xs"
                        onClick={() => { onShowInWorklist(c.m) }}
                      >
                        {t('trShowInWorklist')}
                      </Button>
                    </div>
                  </TableCell>
                  {/* ⚠ The flag is decorative and `aria-hidden`: the country name
                      is always rendered beside it, so a screen reader says
                      "Italy" once instead of "flag of Italy, Italy" — and on
                      Windows, where the glyph is missing, the two
                      regional-indicator letters degrade gracefully. */}
                  <TableCell className="align-top">
                    <span aria-hidden="true" className="mr-1">{countryFlag(c.ourIso)}</span>
                    {countryLabel(c.ourIso) || c.ourIso}
                  </TableCell>
                  <TableCell className="align-top">
                    <span aria-hidden="true" className="mr-1">{countryFlag(c.vmIso)}</span>
                    {countryLabel(c.vmIso) || c.vmIso}
                    <span className="ml-1 font-mono text-xs text-gray-500 dark:text-gray-400">
                      ({c.vmCode})
                    </span>
                  </TableCell>
                  <TableCell className="hidden align-top md:table-cell">
                    <Badge
                      variant={MEANING_VARIANT[c.kind]}
                      className="whitespace-normal break-words"
                    >
                      {t(MEANING_KEY[c.kind])}
                    </Badge>
                  </TableCell>
                  {/* The decision, taken where the evidence is. Both remedies the
                      description offers — correct our record, or ask Swiss Volley
                      to correct theirs — are slow and happen elsewhere; meanwhile
                      the member is on, or off, a worklist. These two buttons say
                      which, on the row that raised the question.

                      ⚠ Nothing here touches `federation_of_origin`. The row stays
                      in this table after a decision, showing what was decided.

                      ⚠ Deliberately a SUBSET of the worklist's control: only
                      'not needed' and 'pending' plus the clear. 'Done' is a claim
                      about a certificate arriving and is not answerable from a
                      register disagreement. */}
                  <TableCell className="align-top whitespace-normal">
                    <div className="inline-flex flex-col gap-1.5 sm:flex-row sm:items-center">
                      <TransferStatusButton
                        member={c.m}
                        value="not_needed"
                        label={t('trStatusNotNeeded')}
                        icon={Ban}
                        disabled={saving}
                        onSelect={onSetStatus}
                      />
                      <TransferStatusButton
                        member={c.m}
                        value="pending"
                        label={t('trStatusPending')}
                        icon={Clock}
                        disabled={saving}
                        onSelect={onSetStatus}
                      />
                      {c.m.transfer_status && (
                        <ClearStatusButton
                          disabled={saving}
                          onClear={() => { onSetStatus(c.m, null) }}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
