import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMessageReactions } from '../hooks/useReactions'
import { SmilePlus } from 'lucide-react'

const COMMON_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '😮', '🙏']

type Props = { messageId: string; className?: string }

export default function ReactionBar({ messageId, className = '' }: Props) {
  const { t } = useTranslation('messaging')
  const { groupedCounts, myReactions, toggle } = useMessageReactions(messageId)
  const [pickerOpen, setPickerOpen] = useState(false)

  const hasAny = groupedCounts.size > 0

  if (!hasAny && !pickerOpen) {
    return (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity ${className}`}
        aria-label={t('addReaction')}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <div className={`flex flex-wrap gap-1 items-center mt-1 ${className}`}>
      {[...groupedCounts.entries()].map(([emoji, count]) => {
        const mine = myReactions.has(emoji)
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle(emoji)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs
              ${mine ? 'bg-primary/20 text-foreground ring-1 ring-primary/40' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            aria-label={t(mine ? 'removeReaction' : 'addReaction', { emoji })}
          >
            <span>{emoji}</span>
            <span className="text-[10px]">{count}</span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => setPickerOpen(p => !p)}
        className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
        aria-label={t('addReaction')}
      >
        <SmilePlus className="h-3 w-3" />
      </button>
      {pickerOpen && (
        <div className="flex flex-wrap gap-1 ml-1 p-1 rounded-md bg-background border border-border shadow-sm">
          {COMMON_EMOJIS.map(e => (
            <button
              key={e} type="button"
              onClick={() => { toggle(e); setPickerOpen(false) }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted"
              aria-label={t('addReaction', { emoji: e })}
            >{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}
