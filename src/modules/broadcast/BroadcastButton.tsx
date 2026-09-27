import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canBroadcast, type ActivityWithTeam, type MemberLike } from './canBroadcast'
import BroadcastDialog from './BroadcastDialog'

interface BroadcastButtonProps {
  activity: ActivityWithTeam
  member: MemberLike | null
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  size?: 'sm' | 'default' | 'lg'
  /** Optional override label (defaults to i18n `broadcast:button.label`). */
  label?: string
  /** Show the text label at all breakpoints (default: hidden below md). */
  labelAlwaysVisible?: boolean
  className?: string
}

/**
 * Entry-point button — only renders when `canBroadcast(activity, member)` is true.
 * Opens `BroadcastDialog` on click.
 */
export default function BroadcastButton({
  activity,
  member,
  variant = 'outline',
  size = 'default',
  label,
  labelAlwaysVisible = false,
  className,
}: BroadcastButtonProps) {
  const { t } = useTranslation('broadcast')
  const [open, setOpen] = useState(false)

  if (!canBroadcast(activity, member)) return null

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        aria-label={label ?? t('button.label')}
        // Height comes from the Button scale (44px touch / 36px sm+) — the same
        // as Share and Cancel next to it, so the header row never steps.
        className={className}
      >
        <Send aria-hidden />
        <span className={labelAlwaysVisible ? 'inline' : 'hidden md:inline'}>{label ?? t('button.label')}</span>
      </Button>
      {open && (
        <BroadcastDialog
          open={open}
          onOpenChange={setOpen}
          activity={activity}
        />
      )}
    </>
  )
}
