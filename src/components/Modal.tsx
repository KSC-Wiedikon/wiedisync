import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  hideClose?: boolean
  /** Optional node rendered in the upper-right of the header (e.g. action button). */
  headerAction?: ReactNode
  /**
   * When true, the dialog/drawer does NOT move focus onto its first control on
   * open. Avoids the browser focus ring landing on (e.g.) an RSVP button and
   * making it look pre-selected. Use for read-first detail modals; leave off for
   * form modals that should focus their first input.
   */
  disableAutoFocus?: boolean
}

const sizeClasses = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
}

export default function Modal({ open, onClose, title, children, size = 'md', hideClose, headerAction, disableAutoFocus }: ModalProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  // Opt-in: keep focus on the trigger when the modal opens (no control gets the
  // browser focus ring). Radix Dialog (desktop) + vaul Drawer (mobile) both
  // honour `onOpenAutoFocus`.
  const focusProps = disableAutoFocus ? { onOpenAutoFocus: (e: Event) => e.preventDefault() } : {}

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && !hideClose && onClose()}>
        <DialogContent
          className={cn(sizeClasses[size], 'max-h-[calc(100vh-4rem)] overflow-y-auto')}
          onInteractOutside={(e) => {
            // Don't close modal when clicking on portalled dropdowns (SearchableSelect, etc.)
            if ((e.target as HTMLElement).closest?.('[data-searchable-select]')) {
              e.preventDefault()
              return
            }
            if (hideClose) e.preventDefault()
          }}
          hideClose={hideClose}
          {...focusProps}
        >
          <DialogHeader
            className={cn(
              headerAction && 'flex-row items-center gap-2 space-y-0',
              headerAction && !hideClose && 'pr-8',
            )}
          >
            <div className="min-w-0 flex-1">
              <DialogTitle className="break-words">{title}</DialogTitle>
              <DialogDescription className="sr-only">{title}</DialogDescription>
            </div>
            {headerAction && <div className="shrink-0">{headerAction}</div>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !hideClose && onClose()}>
      <DrawerContent {...focusProps}>
        <DrawerHeader
          className={cn(headerAction && 'flex flex-row items-center gap-2 space-y-0 text-left')}
        >
          <div className="min-w-0 flex-1">
            <DrawerTitle className="break-words">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{title}</DrawerDescription>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </DrawerHeader>
        <div className="max-h-[calc(100dvh-11rem)] overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
