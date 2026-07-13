import { test, expect } from '../../fixtures/auth'

// Runs in 'chromium' and 'mobile' projects (authenticated as test_user)
test.describe('Readability — authenticated pages', () => {
  test('scorer page filter labels are at least 10px', async ({ page }) => {
    await page.goto('/scorer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const labels = page.locator('label')
    const count = await labels.count()
    if (count === 0) return

    for (let i = 0; i < Math.min(count, 10); i++) {
      if (!(await labels.nth(i).isVisible())) continue
      const size = await labels.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(size).toBeGreaterThanOrEqual(10)
    }
  })

  test('BottomTabBar labels are at least 10px', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const tabBar = page.locator('nav.fixed.bottom-0')
    if (!(await tabBar.isVisible())) return // desktop project

    const tabItems = tabBar.locator('a, button')
    const count = await tabItems.count()

    for (let i = 0; i < count; i++) {
      const size = await tabItems.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(size).toBeGreaterThanOrEqual(10)
    }
  })

  test('truncated elements have correct CSS', async ({ page }) => {
    await page.goto('/games')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const truncated = page.locator('.truncate')
    const count = await truncated.count()
    if (count === 0) return

    const styles = await truncated.first().evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
      }
    })
    expect(styles.overflow).toContain('hidden')
    expect(styles.textOverflow).toBe('ellipsis')
  })
})
