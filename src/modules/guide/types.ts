import type { LucideIcon } from 'lucide-react'
import type { AuthContextValue } from '../../hooks/useAuth'

/**
 * The written in-app guide (replaced the guided tours on 2026-09-15).
 *
 * Section METADATA (id, icon, group, who may read it, which routes it explains)
 * lives in `sections.ts`; section CONTENT lives in
 * `src/i18n/locales/<lang>/guide-content.ts` as `sections.<id>` =
 * `{ title, summary, body: GuideBlock[] }`, loaded lazily by `useGuideContent`.
 * The page strings (`page.*`, `start.*`) are the eager `guide` namespace.
 */

export type GuideGroup = 'basics' | 'everyday' | 'finance' | 'teams' | 'admin'

/** The narrowest role a section is written for — shown as a badge. */
export type GuideAudience =
  | 'everyone'
  | 'coach'
  | 'captain'
  | 'spielplaner'
  | 'finance'
  | 'vorstand'
  | 'admin'

export interface GuideSectionDef {
  id: string
  group: GuideGroup
  icon: LucideIcon
  audience: GuideAudience
  /** Whether this reader should see the section at all. */
  canAccess: (auth: AuthContextValue) => boolean
  /**
   * Route patterns this section explains (`*` = one path segment). The "?"
   * help button on a page shows the longest-matching section; `/` matches
   * only exactly.
   */
  routes: string[]
  /** The page the section's "Go to this page" action opens, if it has one. */
  open?: string
}

/** One paragraph-level element of a section body (i18n `sections.<id>.body`). */
export type GuideBlock =
  | { t: 'p'; text: string }
  | { t: 'h'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'tip'; text: string }
  | { t: 'note'; text: string }

export interface GuideSectionContent {
  title: string
  summary: string
  body: GuideBlock[]
}
