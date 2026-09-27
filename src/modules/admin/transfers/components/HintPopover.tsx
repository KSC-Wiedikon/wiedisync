import { useTranslation } from 'react-i18next'
import IconButton from '@/components/IconButton'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/popover'

/**
 * A tap-reachable replacement for the `title=` attributes this page used to
 * carry its explanations in.
 *
 * A dozen load-bearing sentences ("not found in VIS" ≠ "does not exist", why a
 * row was ruled out, what the settled tally counts) lived ONLY in `title=`,
 * which no touch device ever shows. The `title=` attributes stay where they
 * were — they are a free desktop extra — and this is the surface that actually
 * works on a phone.
 *
 * ⚠ Built on Popover, NOT on `src/components/ui/tooltip.tsx`: Radix Tooltip does
 * not open on touch, and `TooltipProvider` is not mounted anywhere in the app
 * (it is only defined, at tooltip.tsx:8), so a Tooltip here would be dead on a
 * phone AND would throw without a provider.
 *
 * The caller passes an already-translated sentence — every hint string is an
 * existing tr* key and stays in one place.
 */
export function HintPopover({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation('admin')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          size="sm"
          label={label ?? t('trWhatIsThis')}
          title={text}
          // Stops the tap from also firing a row-detail toggle or a Collapsible
          // trigger it sits inside. Radix still receives its own click — this
          // does not preventDefault.
          onClick={(e) => { e.stopPropagation() }}
          className="shrink-0 text-gray-400 hover:bg-transparent hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs p-3 text-xs whitespace-normal break-words">
        {text}
      </PopoverContent>
    </Popover>
  )
}
