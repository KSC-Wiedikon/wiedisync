import { test, expect } from '../../fixtures/auth'

// Use admin storageState for admin route tests
test.use({ storageState: 'e2e/.auth/admin.json' })

test.describe('Admin pages (admin user)', () => {
  test('Spielplanung loads', async ({ page }) => {
    await page.goto('/admin/spielplanung')
    await page.waitForLoadState('domcontentloaded')

    // Should NOT redirect away — admin has access
    await expect(page).toHaveURL('/admin/spielplanung')
    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })

  test('Hallenplan loads', async ({ page }) => {
    await page.goto('/admin/hallenplan')
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveURL('/admin/hallenplan')
    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })

  test('Scorer Assign loads', async ({ page }) => {
    await page.goto('/admin/scorer-assign')
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveURL('/admin/scorer-assign')
    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })

  test('Terminplanung Setup loads', async ({ page }) => {
    await page.goto('/admin/terminplanung')
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveURL('/admin/terminplanung')
    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })

  test('Terminplanung Dashboard loads', async ({ page }) => {
    await page.goto('/admin/terminplanung/dashboard')
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveURL('/admin/terminplanung/dashboard')
    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })
})
