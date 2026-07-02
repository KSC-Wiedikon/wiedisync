import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Car, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useCarpool } from './hooks/useCarpool'
import CarpoolCard from './CarpoolCard'
import CarpoolOfferForm from './CarpoolOfferForm'

interface CarpoolSectionProps {
  gameId: string
}

export default function CarpoolSection({ gameId }: CarpoolSectionProps) {
  const { t } = useTranslation('carpool')
  const [formOpen, setFormOpen] = useState(false)

  const {
    carpools,
    isLoading,
    offerRide,
    joinRide,
    leaveRide,
    cancelRide,
    getPassengersForCarpool,
    currentUserId,
  } = useCarpool(gameId)

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-kscw-blue dark:text-kscw-yellow" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t('title')}
          </h3>
          {carpools.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {carpools.length}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('offerRide')}
        </Button>
      </div>

      {/* Content */}
      <div className="mt-3 space-y-3">
        {isLoading && <LoadingSpinner size="sm" />}

        {!isLoading && carpools.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-600">
            <Car className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {t('noRides')}
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              {t('noRidesDescription')}
            </p>
          </div>
        )}

        {carpools.map((carpool) => (
          <CarpoolCard
            key={carpool.id}
            carpool={carpool}
            passengers={getPassengersForCarpool(carpool.id)}
            currentUserId={currentUserId}
            onJoin={joinRide}
            onLeave={leaveRide}
            onCancel={cancelRide}
          />
        ))}
      </div>

      <CarpoolOfferForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={offerRide}
      />
    </div>
  )
}
