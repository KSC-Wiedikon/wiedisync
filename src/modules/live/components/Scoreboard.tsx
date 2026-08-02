import type { BoardState } from '../types'
import BasketballBoard from './BasketballBoard'
import VolleyballBoard from './VolleyballBoard'

/**
 * Renders the board for whichever sport it is running. The `live_scores` row is a
 * superset of all three, so the switch is purely about which columns matter:
 * volleyball and beach share a layout (sets, serve, set history — beach drops
 * substitutions), while basketball has no sets at all and shows period, team
 * fouls + bonus and the possession arrow instead.
 *
 * `state.sport` is already normalised by useLiveMatch, so an unknown value from a
 * newer board firmware lands on the volleyball layout rather than a blank page.
 */
export default function Scoreboard({ state }: { state: BoardState }) {
  return state.sport === 'basketball' ? (
    <BasketballBoard state={state} />
  ) : (
    <VolleyballBoard state={state} />
  )
}
