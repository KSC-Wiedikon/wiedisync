import { test, expect } from '@playwright/test'
import { PUBLIC_ROUTES, AUTH_ROUTES } from '../../fixtures/test-data'

// Only run in 'mobile' project — these tests require a mobile viewport
test.beforeEach(async (_fixtures, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only tests')
})

test.describe('Mobile UI — navigation', () => {
  test('bottom tab bar is visible', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const tabBar = page.locator('nav').filter({ has: page.getByRole('link', { name: /Home|Startseite/ }) })
    await expect(tabBar).toBeVisible({ timeout: 10_000 })
  })

  test('bottom tab bar shows all primary tabs for authenticated user', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // 5 primary tabs + 1 More button for authenticated users
    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible({ timeout: 10_000 })

    const tabItems = tabBar.locator('a, button')
    await expect(tabItems).toHaveCount(6)
  })

  test('desktop sidebar is NOT visible on mobile', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const sidebarRail = page.locator('div.flex.h-screen > div.w-16.shrink-0')
    await expect(sidebarRail).toHaveCount(0)
  })

  test('More button opens bottom sheet', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    await moreBtn.click()

    await expect(page.getByRole('link', { name: /Scorer/ })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('link', { name: /Absences|Absenzen/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Events/ })).toBeVisible()
  })

  test('More sheet shows profile and logout', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    await moreBtn.click()

    await expect(page.getByRole('link', { name: /My Profile|Mein Profil/ })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /Logout|Abmelden/ })).toBeVisible()
  })

  test('More sheet closes on backdrop tap', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    await moreBtn.click()

    await expect(page.getByRole('link', { name: /Scorer/ })).toBeVisible({ timeout: 5_000 })

    await page.locator('.fixed.inset-0 > .absolute.inset-0').click({ position: { x: 10, y: 10 } })

    await expect(page.getByRole('link', { name: /Scorer/ })).not.toBeVisible({ timeout: 3_000 })
  })

  test('tab navigation works — tapping tabs changes route', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const calendarTab = page.locator('nav.fixed.bottom-0').getByRole('link', { name: /Calendar|Kalender/ })
    await calendarTab.click()
    await expect(page).toHaveURL('/calendar')

    const gamesTab = page.locator('nav.fixed.bottom-0').getByRole('link', { name: /Games|Spiele/ })
    await gamesTab.click()
    await expect(page).toHaveURL('/games')
  })
})

test.describe('Mobile UI — layout checks', () => {
  const pagesToCheck = [
    ...PUBLIC_ROUTES,
    ...AUTH_ROUTES,
  ]

  for (const route of pagesToCheck) {
    test(`${route.name} (${route.path}) — no horizontal overflow`, async ({ page }) => {
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(500)

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(hasOverflow).toBe(false)
    })
  }

  test('main content has bottom padding for tab bar', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const main = page.locator('main')
    await expect(main).toBeVisible({ timeout: 10_000 })

    const paddingBottom = await main.evaluate((el) => {
      return parseInt(getComputedStyle(el).paddingBottom, 10)
    })
    expect(paddingBottom).toBeGreaterThanOrEqual(90)
  })
})

test.describe('Mobile UI — touch targets', () => {
  test('bottom tab bar items meet minimum touch target size', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible({ timeout: 10_000 })

    const tabBarBox = await tabBar.boundingBox()
    expect(tabBarBox).not.toBeNull()
    expect(tabBarBox!.height).toBeGreaterThanOrEqual(60)

    const firstTab = tabBar.locator('a').first()
    const firstTabBox = await firstTab.boundingBox()
    expect(firstTabBox).not.toBeNull()
    expect(firstTabBox!.width).toBeGreaterThanOrEqual(44)
    expect(firstTabBox!.height).toBeGreaterThanOrEqual(44)
  })

  test('More sheet items meet minimum touch target size (48px)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    await moreBtn.click()

    const scorerLink = page.getByRole('link', { name: /Scorer/ })
    await expect(scorerLink).toBeVisible({ timeout: 5_000 })

    const scorerBox = await scorerLink.boundingBox()
    expect(scorerBox).not.toBeNull()
    expect(scorerBox!.height).toBeGreaterThanOrEqual(44)
  })
})

test.describe('Mobile UI — screenshots', () => {
  test('home page mobile snapshot', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    await expect(page).toHaveScreenshot('home-mobile.png', {
      maxDiffPixelRatio: 0.1,
    })
  })

  test('games page mobile snapshot', async ({ page }) => {
    await page.goto('/games')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    await expect(page).toHaveScreenshot('games-mobile.png', {
      maxDiffPixelRatio: 0.1,
    })
  })

  test('more sheet mobile snapshot', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    await moreBtn.click()
    await expect(page.getByRole('link', { name: /Scorer/ })).toBeVisible({ timeout: 5_000 })

    await expect(page).toHaveScreenshot('more-sheet-mobile.png', {
      maxDiffPixelRatio: 0.05,
    })
  })
})
