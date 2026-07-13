import { test, expect } from '../../fixtures/auth'
import { runAxe } from '../../fixtures/axe-helper'
import { AUTH_ROUTES } from '../../fixtures/test-data'

// Runs in 'chromium' and 'mobile' projects (authenticated as test_user)
test.describe('Accessibility — authenticated pages (axe-core)', () => {
  for (const route of AUTH_ROUTES) {
    test(`${route.name} (${route.path}) — no critical WCAG violations`, async ({ page }) => {
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)

      const violations = await runAxe(page)

      if (violations.length > 0) {
        const all = violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        )
        console.log(`[a11y] ${route.name}: ${violations.length} total, ${all.length} critical/serious`)
        for (const v of violations) {
          console.log(`  - [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`)
        }
      }

      // Only fail on critical (not serious — color-contrast is a known tracked issue)
      const critical = violations.filter((v) => v.impact === 'critical')
      expect(critical, `Critical a11y violations on ${route.path}`).toHaveLength(0)
    })
  }
})

test.describe('Accessibility — keyboard navigation (authenticated)', () => {
  test('nav links are keyboard focusable', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // `domcontentloaded` fires before React paints the nav (and the boot overlay
    // masks it during session restore) — wait for the nav to actually exist,
    // otherwise this counts 0 items and passes/fails on a race.
    const navLinks = page.locator('nav a, nav button')
    await expect(navLinks.first()).toBeAttached({ timeout: 20_000 })

    const count = await navLinks.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const tabIndex = await navLinks.nth(i).getAttribute('tabindex')
      expect(tabIndex, `nav item ${i} should not be tabindex="-1"`).not.toBe('-1')
    }
  })

  test('modal traps focus when open', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Radix Dialog (desktop) / vaul Drawer (mobile) both trap focus inside
    const focusInDialog = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][data-state="open"]')
      return d?.contains(document.activeElement) ?? false
    })
    expect(focusInDialog).toBe(true)
  })

  test('Escape key closes modal', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 3_000 })
  })
})
