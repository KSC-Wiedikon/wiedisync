import { test, expect } from '../../fixtures/auth'

// Runs in 'chromium' project which uses storageState: user.json (authenticated)
test.describe('Profile page (authenticated)', () => {
  test('loads user profile without error', async ({ page }) => {
    await page.goto('/profile')

    // ProfilePage shows the user's name and the edit button. The acting member
    // runs with language=english, so the label is "Edit profile" (Sentence case —
    // CLAUDE.md forbids Title Case); matched case-insensitively to stay robust.
    await expect(page.getByRole('button', { name: /edit profile|profil bearbeiten/i })).toBeVisible({
      timeout: 20_000,
    })

    const body = page.locator('body')
    await expect(body).not.toContainText('Error')
  })
})
