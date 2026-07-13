import { test, expect } from '../../fixtures/auth'
import { AUTH_ROUTES, VIEWPORTS } from '../../fixtures/test-data'

// Runs in 'chromium' and 'mobile' projects (authenticated as test_user)
test.describe('Overflow — authenticated pages at 320px', () => {
  for (const route of AUTH_ROUTES) {
    test(`${route.name} (${route.path}) — no horizontal overflow at 320px`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.xs)
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasOverflow).toBe(false)
    })
  }
})

test.describe('Overflow — scorer page', () => {
  test('scorer filters wrap to single column on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/scorer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    // ScorerPage filter grid: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    // At xs (320px), should be single column
    const filterGrid = page.locator('.grid.gap-3')
    if (await filterGrid.isVisible()) {
      const cols = await filterGrid.evaluate((el) => getComputedStyle(el).gridTemplateColumns)
      const colCount = cols.split(' ').filter((c: string) => c !== '0px').length
      expect(colCount).toBe(1)
    }
  })

  test('scorer content not behind tab bar on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/scorer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const main = page.locator('main')
    const paddingBottom = await main.evaluate((el) => parseInt(getComputedStyle(el).paddingBottom))
    expect(paddingBottom).toBeGreaterThanOrEqual(90)
  })
})

test.describe('Overflow — More sheet', () => {
  test('More sheet fits within viewport on xs screen', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    if (!(await moreBtn.isVisible())) return
    await moreBtn.click()

    await expect(page.getByRole('link', { name: /Scorer/ })).toBeVisible({ timeout: 5_000 })

    // Sheet should not exceed viewport height
    const sheet = page.locator('.rounded-t-2xl').first()
    const sheetBox = await sheet.boundingBox()
    const viewport = page.viewportSize()!

    expect(sheetBox).not.toBeNull()
    expect(sheetBox!.height).toBeLessThanOrEqual(viewport.height)
  })
})
