import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

// No pinned height: a wrapping strip grows instead of painting over the content
// below it (the old `h-9` trap, see memory "TabsList wrap overlap").
const tabsListVariants = cva(
  "group/tabs-list inline-flex h-auto w-fit items-center text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        // svrz iOS-style segmented control: sunken track, active = card chip.
        default:
          "min-h-11 flex-wrap justify-center gap-1 rounded-xl bg-muted p-1 sm:min-h-9 dark:bg-muted",
        // Underline tabs on a hairline rule.
        line: "gap-4 rounded-none border-b border-border bg-transparent p-0",
        // svrz filter pills: selection is the inverted neutral, never primary.
        pills: "gap-1.5 overflow-x-auto bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-7 sm:text-[13px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // default (segmented)
        "group-data-[variant=default]/tabs-list:hover:bg-stone-200/60 dark:group-data-[variant=default]/tabs-list:hover:bg-white/5 group-data-[variant=default]/tabs-list:data-[state=active]:bg-card group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm dark:group-data-[variant=default]/tabs-list:data-[state=active]:bg-input",
        // line (underline)
        "group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:px-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:font-semibold group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:-bottom-px group-data-[orientation=horizontal]/tabs:after:h-[1.5px] group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        // pills (filter pills, inverted-neutral selection)
        "group-data-[variant=pills]/tabs-list:flex-none group-data-[variant=pills]/tabs-list:h-9 group-data-[variant=pills]/tabs-list:rounded-full group-data-[variant=pills]/tabs-list:border-border group-data-[variant=pills]/tabs-list:bg-card group-data-[variant=pills]/tabs-list:px-3.5 group-data-[variant=pills]/tabs-list:text-xs group-data-[variant=pills]/tabs-list:hover:bg-accent group-data-[variant=pills]/tabs-list:data-[state=active]:border-transparent group-data-[variant=pills]/tabs-list:data-[state=active]:bg-selected group-data-[variant=pills]/tabs-list:data-[state=active]:text-selected-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
