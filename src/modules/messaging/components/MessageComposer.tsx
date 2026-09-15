import { useCallback, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'
import { shouldSubmitOnKeyDown } from '../utils/composerSubmit'
import ComposerExtrasMenu from './ComposerExtrasMenu'

type Props = {
  onSend: (body: string) => Promise<void> | void
  disabled?: boolean
  conversationId?: string
}

export default function MessageComposer({ onSend, disabled = false, conversationId }: Props) {
  const { t } = useTranslation('messaging')
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await onSend(trimmed)
      setValue('')
    } finally {
      setSending(false)
    }
  }, [onSend, sending, value])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSubmitOnKeyDown(e)) {
      e.preventDefault()
      submit()
    }
  }, [submit])

  return (
    <div className="flex gap-2 items-end border-t border-border bg-background p-3">
      {conversationId && <ComposerExtrasMenu conversationId={conversationId} />}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('composerPlaceholder')}
        rows={1}
        disabled={disabled || sending}
        className="
          flex-1 min-h-[44px] max-h-40 resize-none rounded-md border border-input
          bg-background text-foreground text-sm leading-5 p-2
          focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring
          disabled:opacity-60
        "
        aria-label={t('composerPlaceholder')}
      />
      <Button
        type="button"
        onClick={submit}
        disabled={disabled || sending || value.trim().length === 0}
        className="h-11 min-w-11"
      >
        {sending ? (
          <span className="text-xs">{t('sending')}</span>
        ) : (
          <>
            <Send className="h-4 w-4 md:mr-1" />
            <span className="hidden md:inline">{t('send')}</span>
          </>
        )}
      </Button>
    </div>
  )
}
