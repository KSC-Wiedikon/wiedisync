import { useCallback } from 'react'
import { useCollection } from '../../../lib/query'
import { useMutation } from '../../../hooks/useMutation'
import { useAuth } from '../../../hooks/useAuth'
import { useRealtime } from '../../../hooks/useRealtime'
import { relId } from '../../../utils/relations'
import type { Carpool, CarpoolPassenger } from '../../../types'

export function useCarpool(gameId: string) {
  const { user } = useAuth()

  const { data: carpoolsRaw, refetch: refetchCarpools, isLoading } = useCollection<Carpool>('carpools', {
    filter: gameId ? { game: { _eq: gameId } } : { id: { _eq: -1 } },
    // Expand `driver` so CarpoolCard can render the driver's name — without this
    // `driver` comes back as a bare ID and the card falls back to a generic label.
    fields: ['*', 'driver.id', 'driver.first_name', 'driver.last_name'],
    all: true,
    enabled: !!gameId,
  })
  const carpools = carpoolsRaw ?? []

  const { data: passengersRaw, refetch: refetchPassengers } = useCollection<CarpoolPassenger>('carpool_passengers', {
    filter: gameId && carpools.length > 0
      ? { carpool: { _in: carpools.map(c => c.id) } }
      : { id: { _eq: -1 } },
    // Expand `passenger` so CarpoolCard can render each passenger's name.
    fields: ['*', 'passenger.id', 'passenger.first_name', 'passenger.last_name'],
    all: true,
    enabled: !!gameId && carpools.length > 0,
  })
  const passengers = passengersRaw ?? []

  const { create: createCarpool, update: updateCarpool } = useMutation<Carpool>('carpools')
  const { create: createPassenger, remove: removePassenger } = useMutation<CarpoolPassenger>('carpool_passengers')

  useRealtime<Carpool>('carpools', (e) => {
    if (e.record.game === gameId) refetchCarpools()
  })
  useRealtime<CarpoolPassenger>('carpool_passengers', () => {
    refetchPassengers()
  })

  const offerRide = useCallback(async (data: { seats_available: number; departure_time: string; departure_location: string; notes?: string }) => {
    if (!user) return
    await createCarpool({
      game: gameId,
      driver: user.id,
      seats_available: data.seats_available,
      departure_time: data.departure_time,
      departure_location: data.departure_location,
      notes: data.notes || '',
      status: 'open',
    })
    refetchCarpools()
  }, [user, gameId, createCarpool, refetchCarpools])

  const joinRide = useCallback(async (carpoolId: string) => {
    if (!user) return
    await createPassenger({
      carpool: carpoolId,
      passenger: user.id,
      status: 'confirmed',
    })
    // Check if full — recompute from freshly-fetched passengers rather than the
    // stale closure. The closed-over `passengers` predates this insert (and any
    // concurrent joins), so `length + 1` can miss the full transition. The
    // refetched list already includes the row we just created, so no `+ 1`.
    const { data: freshPassengers } = await refetchPassengers()
    const carpool = carpools.find(c => c.id === carpoolId)
    const confirmedCount = (freshPassengers ?? []).filter(
      p => p.carpool === carpoolId && p.status === 'confirmed',
    ).length
    if (carpool && confirmedCount >= carpool.seats_available) {
      await updateCarpool(carpoolId, { status: 'full' })
    }
    refetchCarpools()
  }, [user, carpools, createPassenger, updateCarpool, refetchPassengers, refetchCarpools])

  const leaveRide = useCallback(async (carpoolId: string) => {
    if (!user) return
    const myRecord = passengers.find(p => p.carpool === carpoolId && relId(p.passenger) === user.id && p.status === 'confirmed')
    if (myRecord) {
      await removePassenger(myRecord.id)
      // Reopen if was full
      const carpool = carpools.find(c => c.id === carpoolId)
      if (carpool?.status === 'full') {
        await updateCarpool(carpoolId, { status: 'open' })
      }
      refetchPassengers()
      refetchCarpools()
    }
  }, [user, passengers, carpools, removePassenger, updateCarpool, refetchPassengers, refetchCarpools])

  const cancelRide = useCallback(async (carpoolId: string) => {
    await updateCarpool(carpoolId, { status: 'cancelled' })
    refetchCarpools()
  }, [updateCarpool, refetchCarpools])

  // Helpers
  const getPassengersForCarpool = (carpoolId: string) =>
    passengers.filter(p => p.carpool === carpoolId && p.status === 'confirmed')

  const isDriverOfAny = carpools.some(c => relId(c.driver) === user?.id && c.status !== 'cancelled')
  const isPassengerOfAny = passengers.some(p => relId(p.passenger) === user?.id && p.status === 'confirmed')

  return {
    carpools: carpools.filter(c => c.status !== 'cancelled'),
    isLoading,
    offerRide,
    joinRide,
    leaveRide,
    cancelRide,
    getPassengersForCarpool,
    isDriverOfAny,
    isPassengerOfAny,
    currentUserId: user?.id,
  }
}
