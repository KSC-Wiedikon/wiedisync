// What goes into the first download, which every member waits for on every release. A
// single static import is enough to undo the split, and nothing would look wrong: on
// 2026-11-07 the first load was about 2 MB and took 20 s on a slow connection. So these
// read the source.
import { describe, it, expect } from 'vitest'
import app from '../App.tsx?raw'
import i18n from '../i18n/index.ts?raw'
import topNav from '../components/TopNav.tsx?raw'
import moreSheet from '../components/MoreSheet.tsx?raw'

describe('the first load', () => {
  it('holds no admin page, which most members never open', () => {
    expect(app).not.toMatch(/^import \w+ from '\.\/modules\/admin\//m)
  })

  it('holds no release notes, by way of the page or its version number', () => {
    expect(app).not.toMatch(/^import \w+ from '\.\/modules\/changelog\//m)
    expect(topNav).not.toMatch(/from '.*modules\/changelog/)
    expect(moreSheet).not.toMatch(/from '.*modules\/changelog/)
  })

  it('holds English and no other language', () => {
    expect(i18n).toMatch(/^import en from '\.\/locales\/en'/m)
    expect(i18n).not.toMatch(/^import .* from '\.\/locales\/(de|fr|it|gsw)/m)
  })

  // The other way round: coaches open these in a hall with no signal, and the service
  // worker caches no assets, so a page that wasn't downloaded up front can't open there.
  it.each(['ShowIdsPage', 'MatchRosterPage'])('keeps %s, needed at the hall offline', (page) => {
    expect(app).toMatch(new RegExp(`^import ${page} from `, 'm'))
    expect(app).not.toMatch(new RegExp(`const ${page} = lazy\\(`))
  })
})
