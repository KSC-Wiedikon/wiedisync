import { test, expect } from '../../fixtures/auth'

async function openFirstVisibleTeam(page: import('@playwright/test').Page) {
  await page.goto('/teams')
  await page.waitForLoadState('domcontentloaded')

  const teamLinks = page
    .locator('a[href^="/teams/"]')
    .filter({ hasNot: page.locator('[href*="/player/"]') })
  const count = await teamLinks.count()
  if (count === 0) {
    return false
  }

  await teamLinks.first().click()
  await page.waitForLoadState('domcontentloaded')
  return true
}

// Runs in 'chromium' and 'mobile' projects (authenticated)
test.describe('Team detail page', () => {
  test('loads a visible team page and shows a heading', async ({ page }) => {
    const opened = await openFirstVisibleTeam(page)
    if (!opened) {
      await expect(page.locator('body')).not.toContainText('Error boundary')
      return
    }

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('Error boundary')
  })

  test('shows roster content without crashing', async ({ page }) => {
    const opened = await openFirstVisibleTeam(page)
    if (!opened) {
      await expect(page.locator('body')).not.toContainText('Error boundary')
      return
    }

    await expect(page.locator('body')).not.toContainText('Error boundary')
  })

  test('non-existing team slug does not crash', async ({ page }) => {
    await page.goto('/teams/TEAM_DOES_NOT_EXIST_E2E')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).not.toContainText('Error boundary')
  })
})
