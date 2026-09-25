/**
 * Stable per-member accent colours for the household account switcher.
 *
 * Its own module (not part of HouseholdSwitcher.tsx) because a file may export
 * either React components or non-components, never both —
 * react-refresh/only-export-components, the same rule that splits `useAuth.tsx`
 * from `AuthProvider.tsx`.
 *
 * The token is STORED on `household_members.accent` (migration 348) rather than
 * hashed from the member id, so adding a fourth child never re-shuffles the
 * three colours a parent has already learned. Colour is the fastest of the three
 * signals telling her which daughter she is on — it lands before she reads.
 */
// `ring` is spelled out literally per token so Tailwind emits it — a class
// built at runtime (`ring-${x}`) would never reach the stylesheet.
export const ACCENT_CLASSES: Record<string, { bg: string; dot: string; ring: string }> = {
  sky: { bg: 'bg-sky-600', dot: 'bg-sky-600', ring: 'ring-sky-600' },
  ochre: { bg: 'bg-amber-600', dot: 'bg-amber-600', ring: 'ring-amber-600' },
  plum: { bg: 'bg-purple-700', dot: 'bg-purple-700', ring: 'ring-purple-700' },
  teal: { bg: 'bg-teal-700', dot: 'bg-teal-700', ring: 'ring-teal-700' },
  rose: { bg: 'bg-rose-700', dot: 'bg-rose-700', ring: 'ring-rose-700' },
}

export const accentOf = (token: string | null | undefined) =>
  ACCENT_CLASSES[token ?? 'sky'] ?? ACCENT_CLASSES.sky
