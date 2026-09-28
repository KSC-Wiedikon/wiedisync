import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from '../../utils/dateHelpers'
import { useCarpoolBoard, type CarpoolActivityType } from './carpoolApi'
import { entryCount } from './carpoolFormat'
import CarpoolPanel from './CarpoolPanel'

const TYPES: CarpoolActivityType[] = ['game', 'training', 'event']
const ACTIVITY_PATH: Record<CarpoolActivityType, string> = { game: 'games', training: 'trainings', event: 'events' }

/**
 * /carpool/:type/:id — where car pooling notifications and pushes land, so a
 * "X joined your car" tap opens the board itself rather than the activity page
 * it hangs off.
 */
export default function CarpoolPage() {
  const { t } = useTranslation('carpool')
  const navigate = useNavigate()
  const params = useParams<{ type: string; id: string }>()
  const type = TYPES.includes(params.type as CarpoolActivityType) ? (params.type as CarpoolActivityType) : null
  const id = params.id && /^\d+$/.test(params.id) ? params.id : null
  const { data, isError, isLoading } = useCarpoolBoard(type ?? 'game', id, !!type && !!id)
  const a = data?.activity

  const typeLabel = type ? t(type === 'game' ? 'typeGame' : type === 'training' ? 'typeTraining' : 'typeEvent') : ''

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 sm:px-0">
      <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2 gap-1">
        <ArrowLeft className="h-4 w-4" /> {t('back')}
      </Button>
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        {a && (
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
            {type ? (
              <Link to={`/${ACTIVITY_PATH[type]}/${a.id}`} className="hover:underline">
                {[typeLabel, a.label, a.date ? formatDate(a.date) : null, a.time].filter(Boolean).join(' · ')}
              </Link>
            ) : null}
          </p>
        )}
      </div>
      {(!type || !id || isError) && !isLoading && (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('notAvailable')}
        </p>
      )}
      {data && data.in_scope === false && (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('errorNotInScope')}
        </p>
      )}
      {a && data.in_scope !== false && !a.enabled && entryCount(data.data) === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('errorDisabled')}
        </p>
      )}
      {type && id && <CarpoolPanel type={type} id={id} standalone />}
    </div>
  )
}
