import { useTranslation } from 'react-i18next'
import { Clock, MapPin, MessageSquare, UserCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Carpool, CarpoolPassenger } from '../../types'
import { asObj, relId } from '../../utils/relations'

type DriverInfo = { first_name: string; last_name: string }
type PassengerInfo = { first_name: string; last_name: string }

interface CarpoolCardProps {
  carpool: Carpool & { driver: DriverInfo | string }
  passengers: Array<CarpoolPassenger & { passenger: PassengerInfo | string }>
  currentUserId?: string
  onJoin: (carpoolId: string) => void
  onLeave: (carpoolId: string) => void
  onCancel: (carpoolId: string) => void
}

export default function CarpoolCard({ carpool, passengers, currentUserId, onJoin, onLeave, onCancel }: CarpoolCardProps) {
  const { t } = useTranslation('carpool')

  const driverObj = asObj<DriverInfo>(carpool.driver)
  const driverName = driverObj
    ? `${driverObj.first_name} ${driverObj.last_name}`
    : t('driver')

  const taken = passengers.length
  const total = carpool.seats_available
  const isFull = carpool.status === 'full'
  // relId handles both the expanded-object and bare-ID shapes, so no manual casts.
  const isDriver = !!currentUserId && relId(carpool.driver) === currentUserId
  const isPassenger = !!currentUserId && passengers.some(p => relId(p.passenger) === currentUserId)
  const progressPct = Math.min((taken / total) * 100, 100)

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
      {/* Header: driver + departure time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCircle className="h-5 w-5 text-kscw-blue dark:text-kscw-yellow" />
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{driverName}</span>
          {isDriver && (
            <span className="rounded-full bg-kscw-blue/10 px-2 py-0.5 text-xs font-medium text-kscw-blue dark:bg-kscw-yellow/10 dark:text-kscw-yellow">
              {t('driver')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <Clock className="h-4 w-4" />
          <span>{carpool.departure_time}</span>
        </div>
      </div>

      {/* Departure location */}
      <div className="mt-2 flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300">
        <MapPin className="h-4 w-4 shrink-0" />
        <span>{carpool.departure_location}</span>
      </div>

      {/* Notes */}
      {carpool.notes && (
        <div className="mt-2 flex items-start gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{carpool.notes}</span>
        </div>
      )}

      {/* Seats progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {isFull
              ? t('seatsFull')
              : t('seatsTaken', { taken, total })}
          </span>
          <span>{t('seatsAvailable', { available: total - taken })}</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className={`h-full rounded-full transition-all ${isFull ? 'bg-red-500' : 'bg-kscw-blue dark:bg-kscw-yellow'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Passenger list */}
      {passengers.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('passengers')}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {passengers.map((p) => {
              const passengerObj = asObj<PassengerInfo>(p.passenger)
              const name = passengerObj
                ? `${passengerObj.first_name} ${passengerObj.last_name}`
                : '...'
              return (
                <span
                  key={p.id}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                >
                  {name}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        {!isDriver && !isPassenger && !isFull && (
          <Button size="sm" onClick={() => onJoin(carpool.id)}>
            {t('joinRide')}
          </Button>
        )}
        {isPassenger && !isDriver && (
          <Button size="sm" variant="outline" onClick={() => onLeave(carpool.id)}>
            {t('leaveRide')}
          </Button>
        )}
        {isDriver && (
          <Button size="sm" variant="destructive" onClick={() => onCancel(carpool.id)}>
            {t('cancelRide')}
          </Button>
        )}
      </div>
    </div>
  )
}
