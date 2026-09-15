import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PollForm from '../../polls/PollForm'
import { useConversationPoll } from '../hooks/useConversationPoll'

type Props = { conversationId: string }

export default function ComposerExtrasMenu({ conversationId }: Props) {
  const { t } = useTranslation('messaging')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const { createPoll, busy } = useConversationPoll(conversationId)

  return (
    <>
      <div className="relative">
        <Button
          type="button" variant="ghost" size="sm"
          className="h-11 w-11 p-0"
          onClick={() => setMenuOpen(o => !o)}
          disabled={busy}
          aria-label={t('composerExtras')}
        >
          <Plus className="h-5 w-5" />
        </Button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-12 left-0 z-50 min-w-[180px] rounded-md border border-border bg-background shadow-md text-sm">
              <button type="button"
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted text-foreground"
                onClick={() => { setMenuOpen(false); setPollOpen(true) }}
              >
                <BarChart3 className="h-4 w-4" />{t('createPoll')}
              </button>
            </div>
          </>
        )}
      </div>
      <PollForm
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onSubmit={async (data) => {
          await createPoll(data)
          setPollOpen(false)
        }}
      />
    </>
  )
}
