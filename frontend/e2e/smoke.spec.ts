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

test('desktop sidebar scrolls on short screens and dashboard stays constrained on wide screens', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await page.setViewportSize({ width: 1280, height: 600 });
  await login(page);
  const sidebar = page.getByTestId('desktop-navigation-scroll');
  await expect(sidebar).toBeVisible();
  const dimensions = await sidebar.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflowY: getComputedStyle(element).overflowY }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.overflowY).toBe('auto');
  await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const main = page.locator('#main-content');
  await expect(main).toBeVisible();
  expect((await main.boundingBox())?.width).toBeLessThanOrEqual(1440);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile drawer scrolls independently and restores page scrolling', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  const drawer = page.getByTestId('mobile-navigation-scroll');
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const dimensions = await drawer.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await drawer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await drawer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await expect(drawer).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('mobile bottom navigation reaches settings', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_USERNAME || !process.env.E2E_ADMIN_PASSWORD, 'Provide test-only panel credentials for authenticated smoke test.');
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const mobileNavigation = page.getByRole('navigation', { name: 'Navigasi mobile' });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
});
