import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { GameSchedulingGapConfig } from '../../../types'

const DEFAULTS: GameSchedulingGapConfig = { home: 4, proposal: 4, proposal3: 2 }

interface Props {
  gapConfig: GameSchedulingGapConfig | null
  onUpdate: (cfg: GameSchedulingGapConfig) => Promise<void>
}

// Per-season game-spacing gaps (days). The min distance between two of a team's
// games. Home games and away proposals can differ; the lenient 3rd proposal can
// use a smaller gap. Mirrors the backend DEFAULT_GAPS in game-scheduling.js.
export default function GapConfigPanel({ gapConfig, onUpdate }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [home, setHome] = useState(() => ({ ...DEFAULTS, ...(gapConfig || {}) }).home)
  const [proposal, setProposal] = useState(() => ({ ...DEFAULTS, ...(gapConfig || {}) }).proposal)
  const [proposal3, setProposal3] = useState(() => ({ ...DEFAULTS, ...(gapConfig || {}) }).proposal3)
  const [saving, setSaving] = useState(false)

  // Re-seed the inputs when the season's saved config changes (identity compare —
  // same trigger the old `useEffect(..., [gapConfig])` had). Adjusting state
  // during render instead of in an effect: React re-runs this component before
  // committing, so the inputs never paint with the previous season's values.
  const [prevGapConfig, setPrevGapConfig] = useState(gapConfig)
  if (prevGapConfig !== gapConfig) {
    setPrevGapConfig(gapConfig)
    const c = { ...DEFAULTS, ...(gapConfig || {}) }
    setHome(c.home)
    setProposal(c.proposal)
    setProposal3(c.proposal3)
  }

  const clamp = (n: number) => Math.max(0, Math.min(30, Math.floor(Number.isFinite(n) ? n : 0)))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate({ home: clamp(home), proposal: clamp(proposal), proposal3: clamp(proposal3) })
      toast.success(t('gapSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, hint: string, value: number, set: (n: number) => void) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <input
        type="number"
        min={0}
        max={30}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-20 shrink-0 rounded-lg border border-input bg-card px-2 py-1.5 text-sm text-foreground tabular-nums dark:bg-input/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )

  return (
    <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{t('gapTitle')}</h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">{t('gapHint')}</p>
      <div className="space-y-3">
        {field(t('gapHome'), t('gapHomeHint'), home, setHome)}
        {field(t('gapProposal'), t('gapProposalHint'), proposal, setProposal)}
        {field(t('gapProposal3'), t('gapProposal3Hint'), proposal3, setProposal3)}
      </div>
      <Button onClick={handleSave} disabled={saving} size="sm" className="mt-4">
        {saving ? '...' : t('common:save')}
      </Button>
    </div>
  )
}
