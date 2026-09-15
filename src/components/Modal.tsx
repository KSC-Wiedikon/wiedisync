import { useRef, type ReactNode } from 'react'
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
  /**
   * `full` is edge to edge on every screen, and it is always the Dialog — never the
   * mobile drawer. vaul pins `touch-action: none` on the drawer and preventDefaults
   * two-finger touchmove on iOS, so nothing inside a drawer can be pinch-zoomed;
   * Radix's Dialog lets pinch-zoom through (react-remove-scroll `allowPinchZoom`).
   * Use it for things people READ up close — a match sheet in the hall.
   */
  size?: 'sm' | 'md' | 'lg' | 'full'
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
  full: 'max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] rounded-lg p-4 sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100vh-2rem)] sm:p-6',
}

export default function Modal({ open, onClose, title, children, size = 'md', hideClose, headerAction, disableAutoFocus }: ModalProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const drawerRef = useRef<HTMLDivElement>(null)
  // Opt-in: keep focus on the trigger when the modal opens (no control gets the
  // browser focus ring). Radix Dialog (desktop) + vaul Drawer (mobile) both
  // honour `onOpenAutoFocus`.
  const focusProps = disableAutoFocus ? { onOpenAutoFocus: (e: Event) => e.preventDefault() } : {}

  // Mobile focus trap. vaul leaves focus on the TRIGGER when the drawer opens —
  // deliberate on their side (focusing the first input would summon the on-screen
  // keyboard), but it means focus sits outside the drawer, so the trap never
  // engages and Tab walks the page behind it. Land focus on the drawer container
  // itself instead: it is tabIndex={-1}, so no keyboard and no focus ring, but
  // focus IS inside the drawer and the trap holds. Desktop needs none of this —
  // Radix already focuses the first focusable child.
  const drawerFocusProps = disableAutoFocus
    ? focusProps
    : {
        onOpenAutoFocus: (e: Event) => {
          e.preventDefault()
          drawerRef.current?.focus()
        },
      }

  if (isDesktop || size === 'full') {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && !hideClose && onClose()}>
        <DialogContent
          className={cn('max-h-[calc(100vh-4rem)] overflow-y-auto', sizeClasses[size])}
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
          {/* Title gets its own row and the actions sit beneath it. Sharing one
              row squeezed the title into a narrow column — "Photoday mixed
              tournament" wrapped onto three lines next to two labelled buttons —
              and the more actions a modal grows, the worse it gets. */}
          <DialogHeader
            className={cn(
              headerAction && 'space-y-3',
              headerAction && !hideClose && 'pr-8',
            )}
          >
            <div className="min-w-0">
              <DialogTitle className="break-words">{title}</DialogTitle>
              <DialogDescription className="sr-only">{title}</DialogDescription>
            </div>
            {headerAction && <div className="flex flex-wrap items-center gap-2">{headerAction}</div>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !hideClose && onClose()}>
      <DrawerContent ref={drawerRef} tabIndex={-1} {...drawerFocusProps}>
        <DrawerHeader
          className={cn(headerAction && 'space-y-3 text-left')}
        >
          <div className="min-w-0">
            <DrawerTitle className="break-words">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{title}</DrawerDescription>
          </div>
          {headerAction && <div className="flex flex-wrap items-center gap-2">{headerAction}</div>}
        </DrawerHeader>
        <div className="max-h-[calc(100dvh-11rem)] overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
