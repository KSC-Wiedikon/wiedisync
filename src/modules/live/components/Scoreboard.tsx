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
 *
 * `big` = the phone turned sideways: the board fills the screen (LivePage), so the
 * numbers scale with the viewport height instead of the card.
 */
export default function Scoreboard({ state, big = false }: { state: BoardState; big?: boolean }) {
  return state.sport === 'basketball' ? (
    <BasketballBoard state={state} big={big} />
  ) : (
    <VolleyballBoard state={state} big={big} />
  )
}
