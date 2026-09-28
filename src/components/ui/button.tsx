import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // svrz "btnGhost": white/card fill, hairline border, neutral hover.
        outline:
          "border border-border bg-card text-foreground/80 hover:bg-accent hover:text-foreground dark:bg-transparent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline dark:text-brand-300",
        // Inverted neutral (svrz slate-900 key CTA / FAB) — not a brand action.
        dark: "bg-selected text-selected-foreground hover:bg-selected/90",
        "danger-outline":
          "border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40",
      },
      // KSCW control height scale (see /kscw-ui → "Control heights"):
      //   touch 44px on phones, 36px from sm up — one height for every
      //   standalone button, so a row of mixed buttons never steps.
      //   `sm` is the dense tier (row tools, table cells): 36 → 32.
      //   `tool` = svrz-style row toolbar: equal-width 44px on a phone,
      //   content-width 32px from sm up.
      size: {
        default: "h-11 px-4 sm:h-9 sm:px-3",
        sm: "h-9 px-3 text-xs sm:h-8 sm:px-2.5",
        lg: "h-11 px-6 font-semibold",
        icon: "h-11 w-11 sm:h-9 sm:w-9",
        "icon-sm": "h-9 w-9 sm:h-8 sm:w-8",
        tool: "h-11 flex-1 basis-0 gap-1.5 rounded-md px-2 text-[13px] sm:h-8 sm:flex-none sm:basis-auto sm:px-3 sm:text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  icon?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, icon, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="animate-spin" /> : icon ?? null}
            {children}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
