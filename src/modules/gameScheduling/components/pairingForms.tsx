import { useCallback } from 'react'
import HomeProposalForm from './HomeProposalForm'
import AwayProposalForm from './AwayProposalForm'

// Per-card proposal-form bridges. The proposal forms report their current picks
// upward through an `onChange` effect that depends on the callback's identity, so
// each card needs an onChange that is STABLE across renders — a fresh inline
// closure per render would re-fire those effects every render (set-state loop).
// These bridges hold that per-card callback in a useCallback keyed on the card,
// which refs can't do (refs may not be read or written during render).

type HomeFormProps = React.ComponentProps<typeof HomeProposalForm>
type HomePicks = Parameters<NonNullable<HomeFormProps['onChange']>>[0]

export function HomeProposalFormForCard({
  cardKey,
  onPick,
  ...rest
}: Omit<HomeFormProps, 'onChange'> & {
  cardKey: string
  onPick: (key: string, picks: HomePicks) => void
}) {
  const onChange = useCallback((picks: HomePicks) => onPick(cardKey, picks), [cardKey, onPick])
  return <HomeProposalForm {...rest} onChange={onChange} />
}

type AwayFormProps = React.ComponentProps<typeof AwayProposalForm>
type AwayProposals = Parameters<NonNullable<AwayFormProps['onChange']>>[0]

export function AwayProposalFormForCard({
  cardKey,
  onPick,
  ...rest
}: Omit<AwayFormProps, 'onChange'> & {
  cardKey: string
  onPick: (key: string, proposals: AwayProposals) => void
}) {
  const onChange = useCallback((proposals: AwayProposals) => onPick(cardKey, proposals), [cardKey, onPick])
  return <AwayProposalForm {...rest} onChange={onChange} />
}
