import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to an explicitly authorized running deployment.');

test('login page is reachable without backend credentials in the browser bundle', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Selamat datang kembali' })).toBeVisible();
  await expect(page.getByLabel(/Username/)).toBeVisible();
  await expect(page.getByLabel(/Password/)).toBeVisible();
});

test('test admin can log in and reach the real dashboard', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await page.goto('/login');
  await page.getByLabel(/Username/).fill(process.env.E2E_ADMIN_USERNAME!);
  await page.getByLabel(/Password/).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Masuk ke dashboard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Selamat datang di CerdasNet' })).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Selamat datang kembali' })).toBeVisible();
});
