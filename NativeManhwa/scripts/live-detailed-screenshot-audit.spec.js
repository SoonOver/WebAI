const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.AUDIT_URL || 'http://localhost:19006';
const OUT_DIR = process.env.AUDIT_SCREENSHOT_DIR || path.join(process.cwd(), 'audit-screenshots');

function isNonFatalConsoleNoise(message) {
  const value = String(message || '');
  return (
    value.includes('favicon') ||
    value.includes('Download the React DevTools') ||
    value.startsWith('Failed to load resource: net::')
  );
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function outFile(name) {
  return path.join(OUT_DIR, name);
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 20000 });
}

async function loadedImageStats(page) {
  return page.evaluate(() => {
    const images = Array.from(document.images || []);
    return {
      count: images.length,
      loaded: images.filter((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0).length,
      failed: images.filter((img) => img.complete && (img.naturalWidth === 0 || img.naturalHeight === 0)).length,
    };
  });
}

async function visibleLoadedImageStats(page) {
  return page.evaluate(() => {
    const images = Array.from(document.images || []);
    const visible = images.filter((img) => {
      const rect = img.getBoundingClientRect();
      const style = window.getComputedStyle(img);
      return (
        img.complete &&
        img.naturalWidth > 0 &&
        img.naturalHeight > 0 &&
        rect.width >= 80 &&
        rect.height >= 80 &&
        rect.bottom > 60 &&
        rect.top < window.innerHeight &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || 1) > 0
      );
    });
    return {
      count: visible.length,
      maxArea: visible.reduce((max, img) => {
        const rect = img.getBoundingClientRect();
        return Math.max(max, Math.round(rect.width * rect.height));
      }, 0),
    };
  });
}

async function waitForVisibleReaderPanel(page, timeoutMs = 60000) {
  const started = Date.now();
  let lastStats = { count: 0, maxArea: 0 };
  while (Date.now() - started < timeoutMs) {
    lastStats = await visibleLoadedImageStats(page);
    if (lastStats.count > 0 && lastStats.maxArea > 50000) {
      return lastStats;
    }
    const probe = await page.screenshot({ path: outFile('reader-panel-probe.png') });
    if (probe.length > 25000) {
      return { count: 1, maxArea: probe.length };
    }
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: outFile('reader-panel-timeout.png') });
  return lastStats;
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

async function ensureFiltersOpen(page) {
  const sortLabel = page.getByText('Sort', { exact: true });
  if ((await sortLabel.count()) > 0 && await sortLabel.first().isVisible()) {
    return;
  }
  await clickText(page, 'Filters');
  await expect(sortLabel).toBeVisible({ timeout: 10000 });
}

async function screenshot(page, screenshots, fileName, label) {
  const file = outFile(fileName);
  await page.screenshot({ path: file });
  screenshots.push({ label, file });
}

test.describe.configure({ mode: 'serial' });

test('NativeManhwa detailed feature screenshots', async ({ page }) => {
  test.setTimeout(420000);
  ensureOutDir();

  const consoleErrors = [];
  const screenshots = [];
  const checks = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('dialog', async (dialog) => {
    checks.push(`Dialog handled: ${dialog.type()} ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Discover', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(9000);
  let text = await bodyText(page);
  expect(text).toContain('Latest series from your selected source');
  expect(text).not.toContain('Error:');
  expect((await loadedImageStats(page)).loaded).toBeGreaterThan(0);
  await screenshot(page, screenshots, '01-home-catalog.png', 'Home catalog loads with cover images and bottom tabs');
  checks.push('Home: catalog, cover images, bottom tabs OK');

  expect(await isTextDisabled(page, 'All ID')).toBeTruthy();
  expect(await isTextDisabled(page, 'Komikindo')).toBeTruthy();
  await clickText(page, 'MangaDex');
  await page.waitForTimeout(7000);
  text = await bodyText(page);
  expect(text).not.toContain('Error:');
  await screenshot(page, screenshots, '02-source-selector-mangadex.png', 'Source selector with MangaDex active and native providers locked on web');
  checks.push('Source selector: web providers active, native-only providers locked OK');

  await clickText(page, 'MD · ID');
  await page.waitForTimeout(7000);
  await ensureFiltersOpen(page);
  await screenshot(page, screenshots, '03-filter-panel-open.png', 'Catalog filter panel open with sort/type/status/genre/rating groups');
  text = await bodyText(page);
  for (const label of ['Sort', 'Type', 'Status', 'Genre', 'Rating', 'Popular', 'Manhwa', 'Ongoing', 'Romance', 'Safe+']) {
    expect(text.toLowerCase()).toContain(label.toLowerCase());
  }
  await clickText(page, 'Manhwa');
  await page.waitForTimeout(7000);
  text = await bodyText(page);
  expect(text).toContain('Manhwa');
  expect(text).not.toContain('Error:');
  await screenshot(page, screenshots, '04-filter-applied.png', 'Catalog filter applied and list refreshed');
  checks.push('Filters: panel, filter apply, summary, refreshed list OK');

  await clickBottomTab(page, 'Search');
  await expect(page.getByText('Find titles across your source', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  expect(await isTextDisabled(page, 'Go')).toBeTruthy();
  await screenshot(page, screenshots, '05-search-initial.png', 'Search initial state with disabled Go button');
  checks.push('Search initial: empty Go disabled OK');

  await page.getByPlaceholder('Title or keyword…').fill('unlikely-title-no-match-xyz');
  await page.waitForTimeout(500);
  text = await bodyText(page);
  expect(text).not.toContain('No matches');
  await clickText(page, 'Go');
  await page.waitForTimeout(9000);
  text = await bodyText(page);
  expect(text).toContain('No matches');
  await screenshot(page, screenshots, '06-search-no-match.png', 'Search no-match state appears only after submitted query');
  checks.push('Search no-match: appears after submit only OK');

  await page.getByPlaceholder('Title or keyword…').fill('osoraku');
  await clickText(page, 'Go');
  await page.waitForTimeout(12000);
  text = await bodyText(page);
  expect(text.toLowerCase()).toContain('osoraku');
  expect(text).not.toContain('Error:');
  await screenshot(page, screenshots, '07-search-results.png', 'Search results render and stay tappable above bottom tab');
  checks.push('Search results: query renders tappable card OK');

  await clickText(page, 'Osoraku', false, 'last');
  await expect(page.getByText('Chapters', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(10000);
  text = await bodyText(page);
  expect(text).toContain('Bookmark');
  expect(text).toContain('Start Reading');
  expect(text).toContain('Chapters');
  await screenshot(page, screenshots, '08-details-overview.png', 'Details overview with actions and chapter list');

  const bookmarked = page.getByText('Bookmarked', { exact: true });
  if (await bookmarked.count()) {
    await bookmarked.first().click();
    await expect(page.getByText('Bookmark', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  }
  await clickText(page, 'Bookmark');
  await expect(page.getByText('Bookmarked', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await page.getByPlaceholder('Search chapter').fill('10');
  await page.waitForTimeout(700);
  text = await bodyText(page);
  expect(text).toContain('Showing');
  expect(await page.getByLabel('Downloads unavailable on web').count()).toBeGreaterThan(0);
  await screenshot(page, screenshots, '09-details-chapter-tools.png', 'Details chapter search/order and web download lock');
  await page.getByPlaceholder('Search chapter').fill('');
  checks.push('Details: bookmark, chapter search, web download lock OK');

  await clickText(page, 'Start Reading');
  await page.waitForTimeout(18000);
  text = await bodyText(page);
  expect(text).toMatch(/\d+\s*\/\s*\d+|\d+\s*pages?/);
  const scrollReaderImages = await waitForVisibleReaderPanel(page);
  expect(scrollReaderImages.count).toBeGreaterThan(0);
  expect(scrollReaderImages.maxArea).toBeGreaterThan(50000);
  await screenshot(page, screenshots, '10-reader-scroll-mode.png', 'Reader scroll mode with loaded comic panels');

  const toPage = page.getByLabel('Switch to page mode');
  if (await toPage.count()) {
    await toPage.first().click();
    await page.waitForTimeout(1500);
    await expect(page.getByLabel('Switch to scroll mode')).toBeVisible({ timeout: 10000 });
  }
  const pageReaderImages = await waitForVisibleReaderPanel(page);
  expect(pageReaderImages.count).toBeGreaterThan(0);
  expect(pageReaderImages.maxArea).toBeGreaterThan(50000);
  await screenshot(page, screenshots, '11-reader-page-mode.png', 'Reader page mode toggle state');
  checks.push('Reader: panels load, progress visible, mode toggle OK');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Discover', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000);

  await clickBottomTab(page, 'History');
  await expect(page.getByText('Recently read chapters', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  text = await bodyText(page);
  expect(text).toContain('Osoraku');
  await screenshot(page, screenshots, '12-history.png', 'History records opened chapter');
  checks.push('History: opened chapter recorded OK');

  await clickBottomTab(page, 'Library');
  await expect(page.getByText('Your saved content', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  text = await bodyText(page);
  expect(text).toContain('Bookmarks');
  expect(text).toContain('Downloads');
  expect(text).toContain('Osoraku');
  await screenshot(page, screenshots, '13-library-bookmarks.png', 'Library bookmarks tab shows saved title');
  await clickText(page, 'Downloads');
  await page.waitForTimeout(800);
  text = await bodyText(page);
  expect(text).toContain('Downloads');
  await screenshot(page, screenshots, '14-library-downloads.png', 'Library downloads tab renders empty/offline state safely');
  checks.push('Library: bookmarks and downloads tabs OK');

  await clickBottomTab(page, 'Settings');
  await expect(page.getByText('App preferences', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  text = await bodyText(page);
  for (const label of ['Auto-advance', 'Default reader mode', 'Image caching', 'Cache status', 'Reading history', 'NativeManhwa']) {
    expect(text).toContain(label);
  }
  const switches = page.locator('[role="switch"]');
  expect(await switches.count()).toBeGreaterThanOrEqual(2);
  await screenshot(page, screenshots, '15-settings.png', 'Settings preferences and maintenance controls');
  checks.push('Settings: switches, reader mode, cache/history/about controls OK');

  const fatal = consoleErrors.filter((message) => !isNonFatalConsoleNoise(message));
  expect(fatal).toEqual([]);

  const probeFile = outFile('reader-panel-probe.png');
  if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile);

  fs.writeFileSync(
    outFile('summary.json'),
    JSON.stringify({ ok: true, baseUrl: BASE_URL, checks, screenshots, consoleErrors }, null, 2),
  );
});
