import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en/guide-content'
import de from '../../i18n/locales/de/guide-content'
import fr from '../../i18n/locales/fr/guide-content'
import it_ from '../../i18n/locales/it/guide-content'
import gsw from '../../i18n/locales/gsw/guide-content'
import enPage from '../../i18n/locales/en/guide'
import dePage from '../../i18n/locales/de/guide'
import frPage from '../../i18n/locales/fr/guide'
import itPage from '../../i18n/locales/it/guide'
import gswPage from '../../i18n/locales/gsw/guide'
import { GUIDE_GROUPS, guideSections, sectionForPath } from './sections'
import type { GuideBlock, GuideSectionContent } from './types'

const LOCALES = { en, de, fr, it: it_, gsw } as const
const BLOCK_TYPES = new Set(['p', 'h', 'ul', 'ol', 'tip', 'note'])

function sectionsOf(locale: keyof typeof LOCALES): Record<string, GuideSectionContent> {
  return (LOCALES[locale] as { sections: Record<string, GuideSectionContent> }).sections
}

describe('guide — page strings', () => {
  it('every locale labels every group and audience the registry uses', () => {
    for (const [locale, page] of Object.entries({ en: enPage, de: dePage, fr: frPage, it: itPage, gsw: gswPage })) {
      for (const g of GUIDE_GROUPS) expect(page.page.groups[g], `${locale} group ${g}`).toBeTruthy()
      for (const s of guideSections) expect(page.page.audience[s.audience], `${locale} audience ${s.audience}`).toBeTruthy()
      // Every key GuidePage / GuideHelpButton / GuideStart read.
      for (const k of ['title', 'subtitle', 'searchPlaceholder', 'clearSearch', 'contents', 'noResults', 'backToTop',
        'openSection', 'helpButton', 'loading', 'openGuide', 'openPage', 'matchOne', 'matchMany', 'linkCopied', 'loadError'] as const) {
        expect(typeof page.page[k], `${locale} page.${k}`).toBe('string')
      }
      for (const k of ['title', 'rolesTitle', 'checklistTitle', 'progress'] as const) expect(typeof page.start[k], `${locale} start.${k}`).toBe('string')
      for (const k of ['player', 'coach', 'tr', 'captain', 'spielplaner', 'finance', 'vorstand', 'admin', 'superadmin', 'member'] as const) expect(typeof page.start.roles[k], `${locale} start.roles.${k}`).toBe('string')
      for (const k of ['install', 'installDesktop', 'push', 'pushUnsupported', 'pushDenied', 'profile', 'photo', 'iban'] as const) expect(typeof page.start.items[k], `${locale} start.items.${k}`).toBe('string')
      for (const k of ['showHow', 'turnOn', 'open'] as const) expect(typeof page.start.actions[k], `${locale} start.actions.${k}`).toBe('string')
    }
  })
})

describe('guide — registry', () => {
  it('has unique section ids in known groups', () => {
    const ids = guideSections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of guideSections) expect(GUIDE_GROUPS).toContain(s.group)
  })

  it('maps a page to the section that explains it (longest prefix wins)', () => {
    expect(sectionForPath('/games')?.id).toBe('games')
    expect(sectionForPath('/games/123')?.id).toBe('games')
    expect(sectionForPath('/')?.id).toBe('home')
    expect(sectionForPath('/finance/team')?.id).toBe('teamfinance')
    expect(sectionForPath('/finance/dues')?.id).toBe('dues')
    expect(sectionForPath('/admin/explore')?.id).toBe('explorer')
    expect(sectionForPath('/forms/new')?.id).toBe('formsauthoring')
    expect(sectionForPath('/forms/42/edit')?.id).toBe('formsauthoring')
    expect(sectionForPath('/forms')?.id).toBe('forms')
    expect(sectionForPath('/teams/h1/roster/edit')?.id).toBe('roster')
    expect(sectionForPath('/teams/h1')?.id).toBe('teams')
    expect(sectionForPath('/admin/hallenplan')?.id).toBe('hallbooking')
    expect(sectionForPath('/admin/hallenplan/halls')?.id).toBe('hallenplanadmin')
    expect(sectionForPath('/admin/audit-log')?.id).toBe('admintools')
    expect(sectionForPath('/nowhere')).toBeNull()
  })

  it('every "open" target resolves back to a section that explains it', () => {
    for (const s of guideSections) {
      if (!s.open) continue
      expect(s.open.startsWith('/'), `${s.id}.open`).toBe(true)
      expect(sectionForPath(s.open), `${s.id}.open (${s.open}) has no section`).not.toBeNull()
    }
  })
})

describe('guide — content completeness', () => {
  for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
    it(`${locale}: every registered section has title, summary and a well-formed body`, () => {
      const sections = sectionsOf(locale)
      const missing = guideSections.map((s) => s.id).filter((id) => !sections[id])
      expect(missing, `missing sections in ${locale}`).toEqual([])
      for (const s of guideSections) {
        const c = sections[s.id]
        expect(typeof c.title, `${locale}:${s.id}.title`).toBe('string')
        expect(c.title.trim().length, `${locale}:${s.id}.title empty`).toBeGreaterThan(0)
        expect(typeof c.summary, `${locale}:${s.id}.summary`).toBe('string')
        expect(Array.isArray(c.body), `${locale}:${s.id}.body`).toBe(true)
        expect(c.body.length, `${locale}:${s.id}.body empty`).toBeGreaterThan(0)
        for (const b of c.body as GuideBlock[]) {
          expect(BLOCK_TYPES.has(b.t), `${locale}:${s.id} unknown block type ${String((b as { t: string }).t)}`).toBe(true)
          if ('items' in b) {
            expect(Array.isArray(b.items) && b.items.length > 0, `${locale}:${s.id} empty list`).toBe(true)
            for (const item of b.items) expect(typeof item).toBe('string')
          } else {
            expect(typeof b.text, `${locale}:${s.id} block text`).toBe('string')
          }
        }
      }
    })

    it(`${locale}: no section content for ids that are not registered`, () => {
      const known = new Set(guideSections.map((s) => s.id))
      const orphans = Object.keys(sectionsOf(locale)).filter((id) => !known.has(id))
      expect(orphans).toEqual([])
    })

    it(`${locale}: inline markup is balanced (**bold** and \`code\`)`, () => {
      const sections = sectionsOf(locale)
      for (const [id, c] of Object.entries(sections)) {
        const texts = c.body.flatMap((b) => ('items' in b ? b.items : [b.text])).concat([c.title, c.summary])
        for (const t of texts) {
          expect((t.match(/\*\*/g) ?? []).length % 2, `${locale}:${id} unbalanced ** in: ${t.slice(0, 60)}`).toBe(0)
          expect((t.match(/`/g) ?? []).length % 2, `${locale}:${id} unbalanced \` in: ${t.slice(0, 60)}`).toBe(0)
        }
      }
    })
  }

  it('the removed messaging feature is not documented', () => {
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const blob = JSON.stringify(sectionsOf(locale)).toLowerCase()
      // The club e-mail mailbox is a real feature; only the chat-era terms are banned.
      for (const word of ['/inbox', 'direct message', 'team chat', 'group chat', 'message request', 'direktnachricht', 'teamchat', 'gruppenchat']) {
        expect(blob.includes(word), `${locale} mentions "${word}"`).toBe(false)
      }
    }
  })
})
