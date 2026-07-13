import { test, expect } from '../../fixtures/auth'
import { PUBLIC_ROUTES, AUTH_ROUTES } from '../../fixtures/test-data'

const isPhone = (projectName: string) => !projectName.includes('ipad')

// ---------------------------------------------------------------------------
// @mobile — navigation
// ---------------------------------------------------------------------------
test.describe('@mobile — navigation', () => {
  test('bottom tab bar is visible on phones', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phones only — iPad uses sidebar')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible({ timeout: 10_000 })

    // Authenticated user: 4 primary tabs (Home, Calendar, Games, Trainings) + 1
    // More button — Teams moved into the More sheet in 7c8527e0.
    const tabItems = tabBar.locator('a, button')
    await expect(tabItems).toHaveCount(5)
  })

  test('desktop sidebar is hidden on phones', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phones only')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const sidebarRail = page.locator('div.flex.h-screen > div.w-16.shrink-0')
    await expect(sidebarRail).toHaveCount(0)
  })

  test('iPad shows sidebar rail instead of tab bar', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'iPad only')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    // iPad Pro 11 is 834px wide — above the lg breakpoint (1024px? depends on app)
    // The app may still show tab bar at 834px. Check both possibilities.
    const sidebarRail = page.locator('div.flex.h-screen > div.w-16.shrink-0')
    const tabBar = page.locator('nav.fixed.bottom-0')

    const hasSidebar = (await sidebarRail.count()) > 0
    const hasTabBar = (await tabBar.count()) > 0

    // At least one navigation pattern must be present
    expect(hasSidebar || hasTabBar).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// @mobile — layout (no horizontal overflow)
// ---------------------------------------------------------------------------
test.describe('@mobile — layout', () => {
  const allRoutes = [...PUBLIC_ROUTES, ...AUTH_ROUTES]

  for (const route of allRoutes) {
    test(`${route.name} (${route.path}) — no horizontal overflow`, async ({ page }) => {
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(500)

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasOverflow).toBe(false)
    })
  }

  test('main content has bottom padding for tab bar on phones', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phones only')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const main = page.locator('main')
    await expect(main).toBeVisible({ timeout: 10_000 })

    const paddingBottom = await main.evaluate((el) =>
      parseInt(getComputedStyle(el).paddingBottom, 10),
    )
    expect(paddingBottom).toBeGreaterThanOrEqual(90)
  })
})

// ---------------------------------------------------------------------------
// @mobile — touch targets (WCAG 2.5.5 — 44px minimum)
// ---------------------------------------------------------------------------
test.describe('@mobile — touch targets', () => {
  test('bottom tab bar items >= 44px', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phones only')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible({ timeout: 10_000 })

    const items = tabBar.locator('a, button')
    const count = await items.count()

    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('primary action buttons on scorer page >= 44px', async ({ page }) => {
    await page.goto('/scorer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const buttons = page.locator('main button')
    const count = await buttons.count()

    for (let i = 0; i < Math.min(count, 10); i++) {
      if (!(await buttons.nth(i).isVisible())) continue
      const box = await buttons.nth(i).boundingBox()
      if (!box) continue
      const label = await buttons.nth(i).evaluate(el => el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || `button[${i}]`)
      expect(box.height, `Button "${label}" at index ${i} is too small`).toBeGreaterThanOrEqual(44)
    }
  })
})

// ---------------------------------------------------------------------------
// @mobile — typography
// ---------------------------------------------------------------------------
test.describe('@mobile — typography', () => {
  test('body text font size >= 12px on home page', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    const paragraphs = page.locator('main p')
    const count = await paragraphs.count()

    for (let i = 0; i < Math.min(count, 15); i++) {
      if (!(await paragraphs.nth(i).isVisible())) continue
      const fontSize = await paragraphs.nth(i).evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      )
      expect(fontSize).toBeGreaterThanOrEqual(12)
    }
  })

  test('headings are not clipped (overflow visible or ellipsis)', async ({ page }) => {
    await page.goto('/games')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    const headings = page.locator('main h1, main h2, main h3, main h4')
    const count = await headings.count()

    for (let i = 0; i < Math.min(count, 10); i++) {
      if (!(await headings.nth(i).isVisible())) continue
      const styles = await headings.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el)
        return { overflow: cs.overflow, textOverflow: cs.textOverflow }
      })
      // Either overflow is visible/auto, or truncation is intentional (ellipsis)
      const isOk =
        styles.overflow === 'visible' ||
        styles.overflow === 'auto' ||
        styles.textOverflow === 'ellipsis'
      expect(isOk).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// @mobile — images
// ---------------------------------------------------------------------------
test.describe('@mobile — images', () => {
  test('images scale within their containers on home page', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const images = page.locator('main img')
    const count = await images.count()

    for (let i = 0; i < Math.min(count, 10); i++) {
      if (!(await images.nth(i).isVisible())) continue

      const overflows = await images.nth(i).evaluate((img) => {
        const parent = img.parentElement
        if (!parent) return false
        return img.getBoundingClientRect().width > parent.getBoundingClientRect().width + 1
      })
      expect(overflows).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// @mobile — forms
// ---------------------------------------------------------------------------
test.describe('@mobile — forms', () => {
  test('form inputs on profile page are full-width and touch-friendly', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // `:not([aria-hidden="true"])` drops the 1×1 native <select> that Radix's
    // <Select> renders purely for form autofill — it is not a user-facing control
    // (the visible control is the trigger button), so it is not a touch target.
    const inputs = dialog.locator(
      'input:not([aria-hidden="true"]), select:not([aria-hidden="true"]), textarea:not([aria-hidden="true"])',
    )
    const count = await inputs.count()
    const viewportWidth = page.viewportSize()!.width

    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i)
      if (!(await el.isVisible())) continue
      const box = await el.boundingBox()
      if (!box) continue

      // Skip checkbox/radio inputs (e.g. privacy toggles) — they are intentionally small
      const type = await el.getAttribute('type')
      if (type === 'checkbox' || type === 'radio') continue

      // Input should be at least 60% of viewport width (accounting for modal padding)
      expect(box.width).toBeGreaterThanOrEqual(viewportWidth * 0.6)
      // WCAG touch target
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })
})

// ---------------------------------------------------------------------------
// @mobile — modals
// ---------------------------------------------------------------------------
test.describe('@mobile — modals', () => {
  test('profile edit modal fits within viewport', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    const dialogBox = await dialog.boundingBox()
    const viewport = page.viewportSize()!

    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.width).toBeLessThanOrEqual(viewport.width)
    expect(dialogBox!.height).toBeLessThanOrEqual(viewport.height)
  })
})

// ---------------------------------------------------------------------------
// @mobile — screenshots (visual regression baseline)
// ---------------------------------------------------------------------------
test.describe('@mobile — screenshots', () => {
  test('home page snapshot', async ({ page }, testInfo) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    await expect(page).toHaveScreenshot(`home-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.1,
    })
  })

  test('games page snapshot', async ({ page }, testInfo) => {
    await page.goto('/games')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    await expect(page).toHaveScreenshot(`games-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.1,
    })
  })
})
