"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

// `repositionInputs` is off: vaul lifts the sheet by the keyboard height while
// iOS Safari ALSO pans the viewport to the focused input, so the sheet ends up
// lifted twice and floats over an empty band above the keyboard. DrawerContent
// pins itself to the visual viewport instead (useKeyboardInset below).
const Drawer = ({
  shouldScaleBackground = true,
  repositionInputs = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root
    shouldScaleBackground={shouldScaleBackground}
    repositionInputs={repositionInputs}
    {...props}
  />
)
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-sm dark:bg-black/70", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

/**
 * Keeps an open bottom sheet sitting on top of the on-screen keyboard. The
 * sheet is `position: fixed` to the LAYOUT viewport; with the keyboard up the
 * visible area is the visual viewport, which iOS may also have panned. The part
 * of the layout viewport hidden below the visible area is
 * `innerHeight - vv.height - vv.offsetTop` — lift the sheet by exactly that and
 * cap its height to what is visible, so its body scrolls instead of the sheet
 * sliding under the keyboard or leaving a gap.
 */
function useKeyboardInset(active: boolean): React.CSSProperties | undefined {
  const [inset, setInset] = React.useState<{ bottom: number; maxHeight: number } | null>(null)
  React.useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !active) return
    const update = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // Under ~80px is browser chrome settling, not a keyboard.
      setInset(hidden < 80 ? null : { bottom: hidden, maxHeight: vv.height - 8 })
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
      setInset(null)
    }
  }, [active])
  return inset ?? undefined
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  // The sheet only mounts while open — track mount via a callback ref so the
  // keyboard listener attaches on every open, not just the first render.
  const [mounted, setMounted] = React.useState(false)
  const setRefs = React.useCallback((el: HTMLDivElement | null) => {
    setMounted(!!el)
    if (typeof ref === "function") ref(el)
    else if (ref) ref.current = el
  }, [ref])
  const keyboardStyle = useKeyboardInset(mounted)
  return (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={setRefs}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-2xl border border-hairline bg-card text-card-foreground shadow-xl",
        className
      )}
      style={keyboardStyle ? { ...style, ...keyboardStyle } : style}
      {...props}
    >
      <div className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-border" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1 p-4 text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-bold leading-tight tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
