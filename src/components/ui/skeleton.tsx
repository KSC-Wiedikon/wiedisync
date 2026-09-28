import * as React from "react"

import { cn } from "@/lib/utils"

// Loading placeholder (svrz finish): warm stone in light, muted navy in dark.
// Pills: pass `rounded-full`.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-stone-200/80 dark:bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
