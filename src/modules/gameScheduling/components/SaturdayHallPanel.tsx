import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Wand2, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { kscwApi } from '../../../lib/api'

interface MovedGame {
  slotId: number
  bookingId: number
  date: string
  from: number
  to: number
}

/**
 * Saturday hall rule control. A lone Saturday home game only needs one court, so
 * it belongs in the single hall (KWI C) — freeing the double hall (KWI A+B) for
 * basketball. Two games at the same time take A+B, three fill A+B+C. The rule runs
 * automatically on every booking change; this card is the "run it now / show me
 * what moved" trigger. Backed by /terminplanung/admin/rebalance-saturday-halls.
 */
export default function SaturdayHallPanel({ seasonId }: { seasonId: string }) {
  const { t } = useTranslation('gameScheduling')
  const [running, setRunning] = useState(false)

  const optimize = async () => {
    setRunning(true)
    try {
      const { moved } = await kscwApi<{ moved: number; details: MovedGame[] }>(
        '/terminplanung/admin/rebalance-saturday-halls',
        { method: 'POST', body: { season: seasonId } },
      )
      toast.success(moved > 0 ? t('saturdayHallMoved', { count: moved }) : t('saturdayHallNone'))
    } catch (e) {
      toast.error((e as { body?: { error?: string } })?.body?.error || t('saturdayHallError'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <Wand2 className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('saturdayHallTitle')}</h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('saturdayHallDescription')}</p>
      <Button type="button" size="sm" onClick={optimize} disabled={running} className="gap-1.5">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {t('saturdayHallButton')}
      </Button>
    </div>
  )
}
