/**
 * Every button in the identity-document section must be type="button".
 *
 * This section renders inside ProfileEditForm's <form> (the `beforeActions` slot) and
 * shadcn's Button sets no `type`, so the HTML default `submit` applies. A type-less button
 * therefore does two things on one tap: it runs its onClick AND submits the profile form,
 * whose onSaved navigates away from /profile/edit. For "Upload document" that meant the OS
 * file picker opened, the section unmounted underneath it, and the picked photo landed on a
 * dead onChange handler — no request, no error, no toast. Four members hit it on 2026-08-03
 * and the server saw nothing at all: the POST never left the browser.
 *
 * A source-level assertion rather than a rendered one: the repo's vitest runs in the `node`
 * environment with no DOM and no testing-library. The property is static, and the failure
 * mode is silent in production, so it is worth pinning cheaply. Same `?raw` approach the
 * data-tour audit in useTour.test.ts uses.
 */
import { describe, it, expect } from 'vitest'

import sectionSrc from './IdentityDocumentSection.tsx?raw'
import cropSrc from './IdentityCropDialog.tsx?raw'

const FILES: [string, string][] = [
  ['IdentityDocumentSection.tsx', sectionSrc],
  ['IdentityCropDialog.tsx', cropSrc],
]

/**
 * Opening tags for `name`, e.g. every `<Button …>` in the file.
 *
 * Arrow functions in props (`onClick={() => …}`) put a `>` inside the tag, so a plain
 * `[^>]*` stops early and reads a truncated tag. Blanking `=>` first — it is the only `>`
 * these two files use inside a prop — makes the naive scan exact.
 *
 * Comments go first: the header of IdentityDocumentSection.tsx explains this very rule and
 * writes `<Button>` in prose, which would otherwise read as a type-less button.
 */
function openingTags(src: string, name: string): string[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  return code.replaceAll('=>', '==').match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? []
}

describe('identity document buttons are never implicit submits', () => {
  for (const [name, src] of FILES) {
    it(`${name}: every <Button> carries type="button"`, () => {
      const tags = openingTags(src, 'Button')
      expect(tags.length).toBeGreaterThan(0)
      expect(
        tags.filter((tag) => !tag.includes('type="button"')),
        `type-less <Button> in ${name}`,
      ).toEqual([])
    })

    it(`${name}: every bare <button> carries type="button"`, () => {
      expect(
        openingTags(src, 'button').filter((tag) => !tag.includes('type="button"')),
        `type-less <button> in ${name}`,
      ).toEqual([])
    })
  }

  it('the password field does not let Enter submit the surrounding profile form', () => {
    // Implicit submission fires on Enter in a text-ish input, which would save the profile
    // and navigate away instead of unlocking the key.
    const handler = sectionSrc.match(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\)[^}]*\}/)?.[0] ?? ''
    expect(handler).toContain('preventDefault')
  })
})
