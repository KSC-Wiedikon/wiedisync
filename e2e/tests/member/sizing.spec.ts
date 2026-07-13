import { test, expect } from '../../fixtures/auth'
import { VIEWPORTS } from '../../fixtures/test-data'

// Runs in 'chromium' and 'mobile' projects (authenticated as test_user)
test.describe('Sizing — interactive elements', () => {
  test('scorer page select inputs meet minimum height (42px)', async ({ page }) => {
    await page.goto('/scorer')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    const selects = page.locator('select')
    const count = await selects.count()

    for (let i = 0; i < count; i++) {
      const box = await selects.nth(i).boundingBox()
      if (!box) continue
      expect(box.height).toBeGreaterThanOrEqual(42)
    }
  })

  test('MoreSheet nav links meet 46px minimum height', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const moreBtn = page.locator('nav.fixed.bottom-0 button')
    if (!(await moreBtn.isVisible())) return
    await moreBtn.click()

    const links = page.locator('.rounded-t-2xl nav a')
    await expect(links.first()).toBeVisible({ timeout: 5_000 })

    const count = await links.count()
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(46)
    }
  })
})

test.describe('Sizing — modal fits viewport', () => {
  test('profile edit modal fits within xs viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    const dialogBox = await dialog.boundingBox()
    const viewport = page.viewportSize()!

    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.width).toBeLessThanOrEqual(viewport.width)
  })

  test('modal close button meets touch target on mobile (42px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.xs)
    await page.goto('/profile')
    await page.waitForLoadState('domcontentloaded')

    const editBtn = page.getByRole('button', { name: /edit profile|profil bearbeiten/i })
    await expect(editBtn).toBeVisible({ timeout: 20_000 })
    await editBtn.click()

    const dialog = page.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Modal close button has min-h-[44px] min-w-[44px] on mobile
    const closeBtn = dialog.locator('button').filter({ has: page.locator('svg') }).first()
    const closeBtnBox = await closeBtn.boundingBox()
    expect(closeBtnBox).not.toBeNull()
    expect(closeBtnBox!.width).toBeGreaterThanOrEqual(42)
    expect(closeBtnBox!.height).toBeGreaterThanOrEqual(42)
  })
})
