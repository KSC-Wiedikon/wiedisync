// Slot time display rule (app-wide for scheduling).
//
// A slot is just the hall window (e.g. 19:30–21:30). We never show the range —
// only the game's START time:
//   • Weekday (Mon–Fri) home games always start at 20:00, regardless of the
//     window, so they render "20:00".
//   • Weekend slots (Spielsamstag / junior Sunday) keep their actual start time.
//
// Mirrors the backend (vm-push, emails) so every surface agrees.

const hm = (s: string | null | undefined): string => (s ? String(s).slice(0, 5) : '')

const isWeekday = (dow: number): boolean => dow >= 1 && dow <= 5 // 0=Sun..6=Sat

/** Start-time label from a weekday number (e.g. hall_slots.day_of_week). */
export function gameStartForDow(dow: number, startTime: string | null | undefined): string {
  return isWeekday(dow) ? '20:00' : hm(startTime)
}

/** Start-time label from a YYYY-MM-DD date. */
export function gameStartForDate(dateYmd: string | null | undefined, startTime: string | null | undefined): string {
  const ymd = String(dateYmd ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return hm(startTime)
  return gameStartForDow(new Date(`${ymd}T00:00:00Z`).getUTCDay(), startTime)
}
