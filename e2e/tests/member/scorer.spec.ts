import { test, expect } from '../../fixtures/auth'

// Runs in 'chromium' project (authenticated as test_user, language=english)
test.describe('Scorer page', () => {
  test('loads and shows page title', async ({ page }) => {
    await page.goto('/scorer')

    // English title: "Scorer duty" — generous timeout for auth hydration over network
    await expect(page.getByRole('heading', { name: /Scorer duty|Schreiberdienst/ })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('shows tabs for Games and Overview', async ({ page }) => {
    await page.goto('/scorer')

    // Tab buttons: "Games" / "Overview" (en) or "Spiele" / "Übersicht" (de)
    await expect(page.getByRole('button', { name: /Games|Spiele/ })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /Overview|Übersicht/ })).toBeVisible()
  })

  test('can switch to overview tab', async ({ page }) => {
    await page.goto('/scorer')

    // Wait for auth to hydrate before interacting
    await expect(page.getByRole('heading', { name: /Scorer duty|Schreiberdienst/ })).toBeVisible({ timeout: 20_000 })

    const overviewTab = page.getByRole('button', { name: /Overview|Übersicht/ })
    await overviewTab.click()

    // Should not crash after switching tabs
    const body = page.locator('body')
    await expect(body).not.toContainText('Error boundary')
  })

  test('shows filter controls on games tab', async ({ page }) => {
    await page.goto('/scorer')

    // Wait for auth + page to render
    await expect(page.getByRole('heading', { name: /Scorer duty|Schreiberdienst/ })).toBeVisible({ timeout: 20_000 })

    // Filters are collapsed by default — expand them
    const filterToggle = page.locator('button', { hasText: /Filter|Filter/ })
    await filterToggle.click()

    // Filter section has date input and selects
    await expect(page.locator('[data-testid="datepicker-trigger"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('shows permissions notice for non-coach user', async ({ page }) => {
    await page.goto('/scorer')

    // test_user is not a coach, should see permissions notice
    // English: "Scorer assignments can only be managed by admins and coaches."
    await expect(
      page.getByText(/can only be managed|kann nur von/),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('normal user does not see admin dropdowns on scorer page', async ({ page }) => {
    await page.goto('/scorer')

    // Wait for page to fully load
    await expect(page.getByRole('heading', { name: /Scorer duty|Schreiberdienst/ })).toBeVisible({ timeout: 20_000 })

    // Normal user should NOT see any team/person select dropdowns inside game cards
    // Admin dropdowns use "— Select team —" / "— Team wählen —" placeholders
    const teamDropdowns = page.locator('select').filter({ hasText: /Select team|Team wählen/ })
    await expect(teamDropdowns).toHaveCount(0)

    const personDropdowns = page.locator('select').filter({ hasText: /Select person|Person wählen/ })
    await expect(personDropdowns).toHaveCount(0)
  })
})
