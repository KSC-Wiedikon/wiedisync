import { test, expect } from '../../fixtures/auth'

// These tests rely on the desktop sidebar — skip on mobile viewport
// Playwright requires a destructuring pattern as the first arg; only `testInfo` is needed.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop-only: requires sidebar')
})

/**
 * Helper: expand the desktop sidebar by clicking the KSCW logo in the collapsed rail.
 * The sidebar starts collapsed; clicking the logo button slides the full panel open.
 */
async function expandSidebar(page: import('@playwright/test').Page) {
  const logoButton = page.locator('button', { has: page.locator('img[alt="Wiedisync"]') }).first()
  await logoButton.click()
  // Wait for the sidebar slide-in transition (200ms CSS transition)
  await page.waitForTimeout(300)
}

// ── TEST-01: Admin toggle visibility ────────────────────────────────

test.describe('Admin toggle visibility (admin)', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' })

  test('admin user sees the admin mode toggle switch', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Expand the sidebar to reveal the AdminToggle
    await expandSidebar(page)

    // Match both English and German aria-labels
    const toggle = page.getByRole('switch', { name: /admin.?mod|member.?mod|mitglied.?mod/i })
    await expect(toggle).toBeVisible()
  })
})

test.describe('Admin toggle visibility (regular user)', () => {
  test.use({ storageState: 'e2e/.auth/user.json' })

  test('regular user does not see the admin mode toggle switch', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Expand the sidebar to verify the toggle is absent
    await expandSidebar(page)

    // AdminToggle renders null for non-admins, so no switch should exist
    const toggle = page.getByRole('switch', { name: /admin.?mod|member.?mod|mitglied.?mod/i })
    await expect(toggle).toHaveCount(0)
  })
})

// ── TEST-02: Member mode filtering ──────────────────────────────────

test.describe('Member mode filtering', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' })

  test('admin with toggle OFF sees fewer teams than with toggle ON', async ({ page }) => {
    // Start in admin mode ON to get the full team count
    await page.addInitScript(() => {
      localStorage.setItem('wiedisync-admin-mode', 'true')
    })

    await page.goto('/teams')
    await page.waitForLoadState('domcontentloaded')

    // Wait for team cards to render in admin mode (all teams visible)
    await page.locator('a[href^="/teams/"]').first().waitFor({ timeout: 15000 })
    const adminModeCount = await page.locator('a[href^="/teams/"]').count()

    // Admin mode must show multiple teams
    expect(adminModeCount).toBeGreaterThanOrEqual(2)

    // Switch to member mode by clicking the toggle in the sidebar
    await expandSidebar(page)
    const toggle = page.getByRole('switch', { name: /admin.?mod|member.?mod|mitglied.?mod/i })
    await toggle.click()

    // Wait for React to re-render the teams list after mode change
    await page.waitForTimeout(2000)

    // Close sidebar so it doesn't interfere with counting
    await page.locator('body').click({ position: { x: 800, y: 400 } })
    await page.waitForTimeout(300)

    const memberModeCount = await page.locator('a[href^="/teams/"]').count()

    // Admin sees fewer teams (or none) with toggle OFF
    expect(adminModeCount).toBeGreaterThan(memberModeCount)
  })
})

// ── TEST-03: Admin mode inline controls ─────────────────────────────

test.describe('Admin mode controls', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' })

  test('member mode hides admin nav and gold bar', async ({ page }) => {
    // Pre-set member mode OFF before navigating
    await page.addInitScript(() => {
      localStorage.setItem('wiedisync-admin-mode', 'false')
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Gold border should NOT be present on main element
    await expect(page.locator('main')).not.toHaveClass(/border-gold-400/)

    // Expand sidebar to verify admin nav links are hidden
    await expandSidebar(page)

    // Admin link should not appear when in member mode
    const adminLink = page.locator('a[href="/admin/spielplanung"]')
    await expect(adminLink).toHaveCount(0)
  })

  test('admin mode shows admin nav and gold bar', async ({ page }) => {
    // Pre-set admin mode ON before navigating
    await page.addInitScript(() => {
      localStorage.setItem('wiedisync-admin-mode', 'true')
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Gold border should be present on main element
    await expect(page.locator('main')).toHaveClass(/border-gold-400/)

    // Expand sidebar to verify admin nav links are visible
    await expandSidebar(page)

    await expect(page.locator('a[href="/admin/spielplanung"]')).toBeVisible()
    await expect(page.locator('a[href="/admin/hallenplan"]')).toBeVisible()
    await expect(page.locator('a[href="/admin/terminplanung"]')).toBeVisible()
  })
})
