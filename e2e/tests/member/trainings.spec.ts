import { test, expect } from '../../fixtures/auth'

// Helper: navigate to /trainings and wait for the page to load.
// Auth hydration from storageState can be slow — if the page is blank,
// reload once to give the app another chance to pick up the token.
async function gotoTrainings(page: import('@playwright/test').Page) {
  await page.goto('/trainings')
  await page.waitForLoadState('domcontentloaded')

  const heading = page.getByRole('heading', { name: 'Trainings', exact: true })

  // First attempt: wait up to 10s for the heading
  try {
    await heading.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    // If the page is blank (auth not hydrated), reload and try again
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await heading.waitFor({ state: 'visible', timeout: 15_000 })
  }
}

// Runs in 'chromium' and 'mobile' projects (authenticated as test_user)
test.describe('Trainings page', () => {
  test('loads and shows page title', async ({ page }) => {
    await gotoTrainings(page)
    await expect(page.getByRole('heading', { name: 'Trainings', exact: true })).toBeVisible()
  })

  test('shows content after loading', async ({ page }) => {
    await gotoTrainings(page)

    // Page rendered without crashing
    const body = page.locator('body')
    await expect(body).not.toContainText('Error boundary')
  })

  test('page does not crash on navigation', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    await page.goto('/trainings')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: 'Trainings', exact: true })).toBeVisible({ timeout: 20_000 })
    const body = page.locator('body')
    await expect(body).not.toContainText('Error boundary')
  })
})
