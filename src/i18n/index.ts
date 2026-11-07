import i18n, { type BackendModule } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en'

/**
 * Only the member's own language is downloaded. All five together were about 2 MB of
 * the first load, for a member who reads one of them, and on a slow connection the
 * app took 20 s to start.
 *
 * English stays bundled: it is the fallback for any missing key, and exports read it
 * directly through `getFixedT('en', …)`. So a German speaker downloads English and
 * German. `changeLanguage` waits for the chunk and only then switches, so its callers
 * need no change and nothing flashes in the wrong language.
 */
const LANGUAGE_CHUNKS: Record<string, () => Promise<{ default: Record<string, object> }>> = {
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  it: () => import('./locales/it'),
  gsw: () => import('./locales/gsw'),
}

const languageChunkBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = LANGUAGE_CHUNKS[language]
    if (!load) {
      callback(null, {})
      return
    }
    // A failed chunk leaves the keys to the English fallback, never a blank app.
    load().then(
      (chunk) => callback(null, chunk.default[namespace] ?? {}),
      (err: Error) => callback(err, false),
    )
  },
}

function getInitialLanguage(): string {
  if (typeof window === 'undefined') return 'de'
  const saved = localStorage.getItem('wiedisync-lang')
  if (saved) return saved
  // Detect browser language. English-first: unrecognised browsers fall back
  // to 'en' rather than 'de'. German speakers still get German because their
  // browser.language starts with 'de'.
  const browserLang = navigator.language?.slice(0, 2)
  const supported = ['de', 'en', 'fr', 'it']
  return supported.includes(browserLang) ? browserLang : 'en'
}

const savedLng = getInitialLanguage()

/** Settles once the first language is in, loaded or not. The first render waits for it. */
export const i18nReady = i18n.use(languageChunkBackend).use(initReactI18next).init({
  lng: savedLng,
  fallbackLng: {
    gsw: ['de', 'en'],
    default: ['en'],
  },
  ns: Object.keys(en),
  defaultNS: 'common',
  resources: { en },
  // `resources` holds English only; the backend fetches the rest.
  partialBundledLanguages: true,
  // `t` works from the very first line, on the English fallback until the chunk lands.
  initAsync: false,
  // Nothing here should ever suspend: the first render waits for i18nReady above, and a
  // later `changeLanguage` keeps the current language on screen while it loads.
  react: { useSuspense: false },
  interpolation: {
    escapeValue: false,
  },
})

// Keep <html lang> in sync with the active locale. A stale lang attribute (the
// index.html default is "en") while content renders in another language is what
// nudges mobile browsers to auto-translate the page — which mutates the DOM out
// of band and crashes React's reconciler with a NotFoundError on insertBefore.
// gsw isn't well supported by assistive tech, so expose it as de-CH.
function syncDocumentLang(lng: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lng === 'gsw' ? 'de-CH' : lng
}
syncDocumentLang(i18n.language || savedLng)
i18n.on('languageChanged', syncDocumentLang)

export default i18n
