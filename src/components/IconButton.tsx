import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'icon'> {
  /** Required: becomes aria-label AND title (title never shows on touch — keep it short). */
  label: string
  /** The lucide icon. Sized by the button (`[&_svg]:size-4`, `size-5` for `lg`). */
  children: ReactNode
  /** `md` = 44px touch / 36px from sm (default). `sm` = dense rows: 36 / 32. */
  size?: 'md' | 'sm'
}

/**
 * The ONE icon-only button. Never hand-roll `rounded-lg p-2` icon buttons —
 * they come out 32px and without a label. Defaults to the ghost variant.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = 'md', variant = 'ghost', title, children, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size === 'sm' ? 'icon-sm' : 'icon'}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      {children}
    </Button>
  ),
)
IconButton.displayName = 'IconButton'

export default IconButton
