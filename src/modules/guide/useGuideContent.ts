import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { maybeReloadOnStaleChunk } from '../../lib/chunkReload'
import { captureApiError } from '../../lib/sentry'
import type { GuideSectionContent } from './types'

type Sections = Record<string, GuideSectionContent>
type ContentModule = { default: { sections: Sections } }

/**
 * The guide text is ~170 KB per language, so it is NOT part of the `guide`
 * namespace bundled at boot (that holds only the page chrome). Each locale's
 * `guide-content.ts` is a separate chunk, fetched the first time the page is
 * opened in that language and cached for the session.
 */
const loaders = import.meta.glob<ContentModule>('../../i18n/locales/*/guide-content.ts')
const cache = new Map<string, Sections>()

function loaderFor(lang: string) {
  return loaders[`../../i18n/locales/${lang}/guide-content.ts`]
}

/** 'de-CH' → 'de'; unknown → 'en'. Mirrors the i18n fallback chain closely enough. */
function resolveLang(language: string | undefined): string {
  const base = (language ?? 'en').split('-')[0]
  return loaderFor(base) ? base : 'en'
}

export function useGuideContent(): { content: Sections | null; loading: boolean; error: boolean } {
  const { i18n } = useTranslation()
  const lang = resolveLang(i18n.resolvedLanguage ?? i18n.language)
  // Only the FETCH outcome lives in state; a cached language is read straight
  // from the cache during render, so switching between fetched languages never
  // flashes a loading state.
  const [fetched, setFetched] = useState<{ lang: string; content: Sections; error: boolean } | null>(null)

  useEffect(() => {
    if (cache.has(lang)) return
    let cancelled = false
    loaderFor(lang)().then((mod) => {
      cache.set(lang, mod.default.sections)
      if (!cancelled) setFetched({ lang, content: mod.default.sections, error: false })
    }).catch((err: unknown) => {
      // A stale deploy is the usual cause — the chunk-reload helper handles that
      // by reloading; anything else is a real failure worth knowing about.
      if (maybeReloadOnStaleChunk(err)) return
      captureApiError(err, { operation: 'guideContent', endpoint: `guide-content:${lang}` })
      const en = cache.get('en')
      if (!cancelled) setFetched({ lang, content: en ?? {}, error: !en })
    })
    return () => { cancelled = true }
  }, [lang])

  const cached = cache.get(lang)
  if (cached) return { content: cached, loading: false, error: false }
  if (fetched && fetched.lang === lang) return { content: fetched.content, loading: false, error: fetched.error }
  return { content: null, loading: true, error: false }
}
