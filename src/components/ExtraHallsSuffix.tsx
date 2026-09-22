import { useTranslation } from 'react-i18next'
import { useHalls } from '../hooks/useData'
import { describeExtraHalls, parseExtraHalls } from '../utils/extraHalls'

/** " + KWI A (from 18:30)" after a training's primary hall name, for trainings
 *  that also occupy extra halls (migration 370). Renders nothing otherwise. */
export default function ExtraHallsSuffix({ extraHalls }: { extraHalls: unknown }) {
  const { t } = useTranslation('common')
  const hasExtras = parseExtraHalls(extraHalls).length > 0
  const { data: halls } = useHalls()
  if (!hasExtras) return null
  const parts = describeExtraHalls(extraHalls, halls ?? [], t)
  return <>{parts.map((p) => ` + ${p}`).join('')}</>
}
