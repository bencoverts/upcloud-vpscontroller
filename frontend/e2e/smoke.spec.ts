import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to an explicitly authorized running deployment.');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/Username/).fill(process.env.E2E_ADMIN_USERNAME!);
  await page.getByLabel(/Password/).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Masuk ke dashboard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Selamat datang di/ })).toBeVisible();
}

test('login page is reachable without backend credentials in the browser bundle', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Selamat datang kembali' })).toBeVisible();
  await expect(page.getByLabel(/Username/)).toBeVisible();
  await expect(page.getByLabel(/Password/)).toBeVisible();
});

test('test admin can log in and open the new management pages', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await login(page);
  for (const [link, heading] of [
    ['Deploy VPS', 'Deploy VPS'],
    ['Proxmox VE', 'Proxmox VE'],
    ['Panel API Keys', 'Panel API Keys'],
    ['Documentation', 'API & integration documentation'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('heading', { name: 'Selamat datang kembali' })).toBeVisible();
});

test('mobile bottom navigation reaches settings', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const mobileNavigation = page.getByRole('navigation', { name: 'Navigasi mobile' });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
});
