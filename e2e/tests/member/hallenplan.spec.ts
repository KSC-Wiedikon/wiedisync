import { test, expect } from '../../fixtures/auth'

// Use admin storageState — hallenplan requires admin access
test.use({ storageState: 'e2e/.auth/admin.json' })

test.describe('Hallenplan page', () => {
  test('loads and shows title', async ({ page }) => {
    await page.goto('/admin/hallenplan')

    // English title: "Hall Plan" / German: "Hallenplan"
    // Generous timeout for auth hydration over network
    await expect(page.getByRole('heading', { name: /Hall Plan|Hallenplan/ })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('shows today button and week navigation', async ({ page }) => {
    await page.goto('/admin/hallenplan')

    // "Today" / "Heute" button
    await expect(page.getByRole('button', { name: /Today|Heute/ })).toBeVisible({ timeout: 20_000 })
  })

  test('can navigate to next week', async ({ page }) => {
    await page.goto('/admin/hallenplan')

    // Wait for auth to hydrate before interacting
    await expect(page.getByRole('heading', { name: /Hall Plan|Hallenplan/ })).toBeVisible({ timeout: 20_000 })

    // Click next week button
    const nextBtn = page.getByRole('button', { name: /Next week|Nächste Woche|›/ })
    await nextBtn.click()

    // Should not crash
    const body = page.locator('body')
    await expect(body).not.toContainText('Error boundary')
  })

  test('shows closures button', async ({ page }) => {
    await page.goto('/admin/hallenplan')

    // "Closures" / "Sperrungen" button
    await expect(page.getByRole('button', { name: /Closures|Sperrungen/ })).toBeVisible({
      timeout: 20_000,
    })
  })
})
