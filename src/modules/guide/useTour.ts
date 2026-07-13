import { useContext } from 'react'
import { TourContext } from './tourContext'

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within TourProvider')
  return ctx
}
