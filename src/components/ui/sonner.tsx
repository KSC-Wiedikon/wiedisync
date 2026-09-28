import { useContext, type CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { ThemeContext } from "@/hooks/useTheme"

/**
 * The one configured `<Toaster>` for both apps (member app + Spielplanung).
 *
 * svrz_rc finish: a card-coloured toast with a hairline border and a 4px
 * status-coloured left edge (emerald / red / brand / amber) instead of sonner's
 * fully tinted `richColors`. Sonner's own surface is driven through its CSS
 * vars (so it follows the KSCW tokens in light AND dark); the left edge and
 * radius need `!` because sonner's `[data-sonner-toast][data-styled]` rules
 * out-rank a single utility class.
 *
 * Bottom-right from `sm` up; on phones sonner spans the width, lifted above the
 * member app's bottom tab bar via `mobileOffset` (callers can override).
 */
function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  // Read the context directly: a Toaster mounted outside ThemeProvider should
  // fall back to light rather than throw.
  const theme = useContext(ThemeContext)?.theme ?? "light"

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      mobileOffset={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "0.75rem",
          ...style,
        } as CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast:
            "rounded-xl! border-l-4! gap-2.5! py-3! pl-3! pr-2! text-sm! shadow-lg! font-sans",
          title: "font-medium text-foreground",
          description: "text-xs! text-muted-foreground!",
          success: "border-l-emerald-500! [&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-400",
          error: "border-l-red-500! [&_[data-icon]]:text-red-600 dark:[&_[data-icon]]:text-red-400",
          info: "border-l-primary! [&_[data-icon]]:text-primary dark:[&_[data-icon]]:text-brand-300",
          warning: "border-l-amber-500! [&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-400",
          actionButton: "rounded-lg! bg-primary! text-primary-foreground! font-medium!",
          cancelButton: "rounded-lg! bg-muted! text-muted-foreground!",
          closeButton:
            "border-border! bg-card! text-muted-foreground! hover:bg-accent! hover:text-foreground!",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
