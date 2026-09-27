/* Row tokens shared by ActivityRow.tsx and surfaces that build their own
 * rails (see /kscw-ui → "Rows"). Kept out of the component file so fast
 * refresh keeps working. */
export type RowTone = 'brand' | 'green' | 'amber' | 'red' | 'sky' | 'violet' | 'gray'

export const ROW_TONE_TEXT: Record<RowTone, string> = {
  brand: 'text-brand-700 dark:text-brand-300',
  green: 'text-green-700 dark:text-green-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  sky: 'text-sky-700 dark:text-sky-300',
  violet: 'text-violet-700 dark:text-violet-300',
  gray: 'text-gray-700 dark:text-gray-300',
}

export const ROW_TONE_STRIPE: Record<RowTone, string> = {
  brand: 'bg-brand-500 dark:bg-brand-400',
  green: 'bg-green-500 dark:bg-green-500',
  amber: 'bg-amber-400 dark:bg-amber-500',
  red: 'bg-red-500 dark:bg-red-500',
  sky: 'bg-sky-500 dark:bg-sky-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  gray: 'bg-gray-200 dark:bg-gray-700',
}

/** Rail width — ONE value for every row in the app. */
export const RAIL_WIDTH = 'w-14 sm:w-[4.5rem]'
/**
 * Left indent that lines something up under the row body:
 * row px + rail + gap + stripe + gap  (6+56+10+2+10 = 84px, sm: 8+72+12+2+12 = 106px).
 */
export const ROW_BODY_INDENT = 'pl-[5.25rem] sm:pl-[6.625rem]'


/** Highlight wash + 1px ring via box-shadow — no layout shift against neighbours. */
export const ROW_HIGHLIGHT: Record<'brand' | 'amber' | 'red' | 'sky', string> = {
  brand: 'rounded-md bg-brand-50/70 shadow-[0_0_0_1px_var(--color-brand-300)] dark:bg-brand-950/30 dark:shadow-[0_0_0_1px_var(--color-brand-700)]',
  amber: 'rounded-md bg-amber-50/70 shadow-[0_0_0_1px_var(--color-amber-300)] dark:bg-amber-950/30 dark:shadow-[0_0_0_1px_var(--color-amber-700)]',
  red: 'rounded-md bg-red-50/70 shadow-[0_0_0_1px_var(--color-red-300)] dark:bg-red-950/30 dark:shadow-[0_0_0_1px_var(--color-red-800)]',
  sky: 'rounded-md bg-sky-50/70 shadow-[0_0_0_1px_var(--color-sky-300)] dark:bg-sky-950/30 dark:shadow-[0_0_0_1px_var(--color-sky-700)]',
}
