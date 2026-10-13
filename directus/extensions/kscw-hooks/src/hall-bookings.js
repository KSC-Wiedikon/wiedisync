// Single implementation lives in kscw-endpoints (gcal-sync runs it inline so
// its digest can report the result); the hooks run the same sweep after the
// game sweep and after a closure is deleted.
export { sweepHallBookings } from '../../kscw-endpoints/src/hall-bookings.js'
