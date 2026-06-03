const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.AUDIT_URL || 'http://localhost:19006';
const OUT_DIR = process.env.AUDIT_OUT || process.cwd();

function isNonFatalConsoleNoise(message) {
  const value = String(message || '');
  return (
    value.includes('favicon') ||
    value.includes('Download the React DevTools') ||
    value.startsWith('Failed to load resource: net::')
  );
}

function outFile(name) {
  return path.join(OUT_DIR, name);
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 20000 });
}

async function clickText(page, text, exact = true, which = 'first') {
  const locator = page.getByText(text, { exact });
  const count = await locator.count();
  expect(count, `${text} should exist`).toBeGreaterThan(0);
  const target = which === 'last' ? locator.last() : locator.first();
  await expect(target).toBeVisible({ timeout: 20000 });
  await target.click();
}

async function clickBottomTab(page, label) {
  await clickText(page, label, true, 'last');
}

async function isTextDisabled(page, text) {
  const locator = page.getByText(text, { exact: true }).first();
  await expect(locator).toBeVisible({ timeout: 20000 });
  return locator.evaluate((el) => Boolean(
    el.closest('[aria-disabled="true"]') ||
    el.closest('button:disabled') ||
    el.closest('[disabled]')
  ));
}

async function expectCards(page, label) {
  await page.waitForTimeout(6000);
  const text = await bodyText(page);
  expect(text, `${label} should not show an error`).not.toContain('Error:');
  expect(text, `${label} should render source cards`).toMatch(/MD · ID|MangaDex|Bato|Komikindo|Baca|K\.Station|Komiku|M\.Read/);
}

async function ensureFiltersOpen(page) {
  const sortLabel = page.getByText('Sort', { exact: true });
  if ((await sortLabel.count()) > 0 && await sortLabel.first().isVisible()) {
    return;
  }
  await clickText(page, 'Filters');
  await expect(sortLabel).toBeVisible({ timeout: 10000 });
}

test.describe.configure({ mode: 'serial' });

test('NativeManhwa button-by-button interaction audit', async ({ page }) => {
  test.setTimeout(360000);
  const consoleErrors = [];
  const dialogs = [];
  const results = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept().catch(() => {});
  });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Discover', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(9000);

  expect(await isTextDisabled(page, 'All ID')).toBeTruthy();
  expect(await isTextDisabled(page, 'Komikindo')).toBeTruthy();
  expect(await isTextDisabled(page, 'Baca')).toBeTruthy();
  await clickText(page, 'MangaDex');
  await expectCards(page, 'MangaDex source');
  await clickText(page, 'MD · ID');
  await expectCards(page, 'MangaDex ID source');
  results.push('Home source selector: web providers active; native-only providers locked');

  await ensureFiltersOpen(page);
  for (const option of ['Popular', 'Title', 'Updated', 'Manhwa', 'Ongoing', 'Romance', 'Safe+', 'All']) {
    await ensureFiltersOpen(page);
    await clickText(page, option);
    await page.waitForTimeout(700);
  }
  let text = await bodyText(page);
  expect(text).toContain('Filters');
  await ensureFiltersOpen(page);
  await clickText(page, 'Reset');
  await page.waitForTimeout(700);
  text = await bodyText(page);
  expect(text).toContain('Default');
  await ensureFiltersOpen(page);
  await clickText(page, 'Done');
  await page.waitForTimeout(500);
  results.push('Home filters: every group can change, reset, and close');

  await clickBottomTab(page, 'Search');
  await expect(page.getByText('Search', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  expect(await isTextDisabled(page, 'Go')).toBeTruthy();
  await page.getByPlaceholder('Title or keyword…').fill('unlikely-title-no-match-xyz');
  await page.waitForTimeout(500);
  text = await bodyText(page);
  expect(text).not.toContain('No matches');
  await clickText(page, 'Go');
  await page.waitForTimeout(9000);
  text = await bodyText(page);
  expect(text).toContain('No matches');
  await page.getByPlaceholder('Title or keyword…').fill('osoraku');
  await clickText(page, 'Go');
  await page.waitForTimeout(12000);
  text = await bodyText(page);
  expect(text.toLowerCase()).toContain('osoraku');
  results.push('Search: empty button disabled, typing does not fake no-match, submitted query works');

  await clickText(page, 'Osoraku', false, 'last');
  await expect(page.getByText('Chapters', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(10000);

  const bookmarked = page.getByText('Bookmarked', { exact: true });
  if (await bookmarked.count()) {
    await bookmarked.first().click();
    await expect(page.getByText('Bookmark', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  }
  await clickText(page, 'Bookmark');
  await expect(page.getByText('Bookmarked', { exact: true }).first()).toBeVisible({ timeout: 10000 });

  const readMore = page.getByText('Read more', { exact: true });
  if (await readMore.count()) {
    await readMore.first().click();
    await expect(page.getByText('Show less', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await clickText(page, 'Show less');
    await expect(page.getByText('Read more', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  }

  await page.getByPlaceholder('Search chapter').fill('10');
  await page.waitForTimeout(700);
  text = await bodyText(page);
  expect(text).toContain('Showing');
  await page.getByPlaceholder('Search chapter').fill('');
  await clickText(page, 'Newest');
  await expect(page.getByText('Oldest', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await clickText(page, 'Oldest');
  await expect(page.getByText('Newest', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  expect(await page.getByLabel('Downloads unavailable on web').count()).toBeGreaterThan(0);
  results.push('Details: bookmark, description, chapter search/order, web download lock all logical');

  await clickText(page, 'Start Reading');
  await page.waitForTimeout(18000);
  text = await bodyText(page);
  expect(text).toMatch(/\d+\s*\/\s*\d+|\d+\s*pages?/);
  const toPage = page.getByLabel('Switch to page mode');
  if (await toPage.count()) {
    await toPage.click();
    await page.waitForTimeout(1200);
    await expect(page.getByLabel('Switch to scroll mode')).toBeVisible({ timeout: 10000 });
  }
  const toScroll = page.getByLabel('Switch to scroll mode');
  if (await toScroll.count()) {
    await toScroll.click();
    await page.waitForTimeout(1200);
    await expect(page.getByLabel('Switch to page mode')).toBeVisible({ timeout: 10000 });
  }
  const next = page.getByLabel('Next chapter');
  if (await next.count() && await next.first().isEnabled()) {
    await next.first().click();
    await page.waitForTimeout(12000);
    text = await bodyText(page);
    expect(text).toMatch(/\d+\s*\/\s*\d+/);
  }
  const prev = page.getByLabel('Previous chapter');
  if (await prev.count() && await prev.first().isEnabled()) {
    await prev.first().click();
    await page.waitForTimeout(12000);
    text = await bodyText(page);
    expect(text).toMatch(/\d+\s*\/\s*\d+/);
  }
  results.push('Reader: mode toggle and chapter controls respond');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Discover', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000);

  await clickBottomTab(page, 'History');
  await expect(page.getByText('Recently read chapters', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  text = await bodyText(page);
  expect(text).toContain('Osoraku');

  await clickBottomTab(page, 'Library');
  await expect(page.getByText('Your saved content', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  text = await bodyText(page);
  expect(text).toContain('Bookmarks');
  expect(text).toContain('Downloads');
  await clickText(page, 'Downloads');
  await page.waitForTimeout(800);
  await clickText(page, 'Bookmarks');
  await page.waitForTimeout(800);
  results.push('History and Library tabs/buttons remain coherent');

  await clickBottomTab(page, 'Settings');
  await expect(page.getByText('App preferences', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  const switches = page.locator('[role="switch"]');
  const switchCount = await switches.count();
  expect(switchCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < switchCount; index += 1) {
    const control = switches.nth(index);
    if (!(await control.isEnabled())) continue;
    await control.click();
    await page.waitForTimeout(500);
    await control.click();
    await page.waitForTimeout(500);
  }

  const hasWebtoon = await page.getByText('Webtoon', { exact: true }).count();
  await clickText(page, hasWebtoon ? 'Webtoon' : 'Page');
  await page.waitForTimeout(800);
  await clickText(page, hasWebtoon ? 'Page' : 'Webtoon');
  await page.waitForTimeout(800);
  results.push('Settings: switches and reader mode toggle respond');

  const fatal = consoleErrors.filter((message) => !isNonFatalConsoleNoise(message));
  expect(fatal).toEqual([]);

  fs.writeFileSync(
    outFile('nativemanhwa-live-button-audit-result.json'),
    JSON.stringify({ ok: true, results, dialogs, consoleErrors }, null, 2),
  );
});
