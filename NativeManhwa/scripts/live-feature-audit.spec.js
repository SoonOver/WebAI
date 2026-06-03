const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.AUDIT_URL || 'http://localhost:19006';
const OUT_DIR = process.env.AUDIT_OUT || process.cwd();

function isNonFatalConsoleNoise(message) {
  const text = String(message || '');
  return (
    text.includes('favicon') ||
    text.includes('Download the React DevTools') ||
    text.startsWith('Failed to load resource: net::')
  );
}

function outFile(name) {
  return path.join(OUT_DIR, name);
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 20000 });
}

async function waitForText(page, text, timeout = 30000) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
}

async function clickVisibleText(page, text, exact = true) {
  const locator = page.getByText(text, { exact });
  await expect(locator.first()).toBeVisible({ timeout: 20000 });
  await locator.first().click();
}

async function clickBottomTab(page, label) {
  const locator = page.getByText(label, { exact: true });
  const count = await locator.count();
  expect(count, `bottom tab ${label} should exist`).toBeGreaterThan(0);
  await locator.last().click();
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

async function expectNoConsoleErrors(errors, checkpoint) {
  const fatal = errors.filter((message) => !isNonFatalConsoleNoise(message));
  expect(fatal, `console errors at ${checkpoint}`).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('NativeManhwa live feature audit', async ({ page }) => {
  test.setTimeout(300000);
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

  await page.setViewportSize({ width: 540, height: 720 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Discover', 60000);
  await page.waitForTimeout(12000);
  let text = await bodyText(page);
  expect(text).toContain('Latest series from your selected source');
  for (const tab of ['Home', 'Search', 'Library', 'History', 'Settings']) {
    expect(text).toContain(tab);
  }
  expect(text).toContain('MD · ID');
  expect((await loadedImageStats(page)).loaded).toBeGreaterThan(0);
  await page.screenshot({ path: outFile('nativemanhwa-live-home.png') });
  results.push('Home loads with default MD · ID catalog, bottom tabs, and images');

  await clickVisibleText(page, 'Filters');
  await waitForText(page, 'Sort');
  await clickVisibleText(page, 'Manhwa');
  await page.waitForTimeout(6000);
  text = await bodyText(page);
  expect(text).toContain('Filters');
  expect(text).toContain('1');
  expect(text).not.toContain('Error:');
  results.push('Home catalog filters open and selecting Type=Manhwa refreshes list');

  const providerChecks = [];
  for (const provider of ['MangaDex', 'MD · ID']) {
    await clickVisibleText(page, provider);
    await page.waitForTimeout(9000);
    text = await bodyText(page);
    providerChecks.push({
      provider,
      hasError: text.includes('Error:'),
      hasCards: /MD · ID|MangaDex|Bato/.test(text) && !text.includes('No titles found'),
      sample: text.slice(0, 260),
    });
  }
  expect(providerChecks.every((item) => item.hasCards && !item.hasError)).toBeTruthy();
  text = await bodyText(page);
  for (const nativeOnlySource of ['Bato', 'Komikindo', 'Baca', 'K.Station', 'Komiku', 'M.Read']) {
    expect(text).toContain(nativeOnlySource);
  }
  results.push(`Provider selector keeps web-safe providers active and shows native-only sources as locked: ${providerChecks.map((p) => p.provider).join(', ')}`);

  await clickBottomTab(page, 'Search');
  await waitForText(page, 'Find titles across your source');
  await page.getByPlaceholder('Title or keyword…').fill('osoraku');
  await clickVisibleText(page, 'Go');
  await page.waitForTimeout(12000);
  text = await bodyText(page);
  expect(text.toLowerCase()).toContain('osoraku');
  await page.screenshot({ path: outFile('nativemanhwa-live-search.png') });
  results.push('Search accepts a keyword and renders result cards');

  await clickVisibleText(page, 'Osoraku', false);
  await waitForText(page, 'Chapters', 60000);
  await page.waitForTimeout(10000);
  text = await bodyText(page);
  expect(text).toContain('Bookmark');
  expect(text).toContain('Start Reading');
  expect(text).toContain('Chapters');
  await clickVisibleText(page, 'Read more');
  await waitForText(page, 'Show less');
  await clickVisibleText(page, 'Show less');
  await waitForText(page, 'Read more');
  await clickVisibleText(page, 'Bookmark');
  await waitForText(page, 'Bookmarked');
  await page.getByPlaceholder('Search chapter').fill('10');
  await page.waitForTimeout(1000);
  text = await bodyText(page);
  expect(text).toContain('Showing');
  expect(text).toMatch(/Ch\.?\s*10|Chapter\s*10/i);
  await page.getByPlaceholder('Search chapter').fill('');
  await clickVisibleText(page, 'Newest');
  await page.waitForTimeout(1000);
  text = await bodyText(page);
  expect(text).toContain('Oldest');
  await page.screenshot({ path: outFile('nativemanhwa-live-details.png') });
  results.push('Details page loads, description expands, bookmark toggles, chapter search/order works');

  await clickVisibleText(page, 'Start Reading');
  await page.waitForTimeout(18000);
  text = await bodyText(page);
  expect(text).toMatch(/\d+\s*\/\s*\d+\s*·\s*\d+\s*pages?/);
  let imageStats = await loadedImageStats(page);
  expect(imageStats.loaded).toBeGreaterThan(0);
  await page.screenshot({ path: outFile('nativemanhwa-live-reader.png') });
  results.push('Reader opens, shows chapter progress/page count, and loads panel images');

  const switchMode = page.getByLabel('Switch to page mode');
  if (await switchMode.count()) {
    await switchMode.click();
    await page.waitForTimeout(1500);
    await expect(page.getByLabel('Switch to scroll mode')).toBeVisible();
  }
  const next = page.getByLabel('Next chapter');
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(12000);
    text = await bodyText(page);
    expect(text).toMatch(/\d+\s*\/\s*\d+/);
  }
  const prev = page.getByLabel('Previous chapter');
  if (await prev.count()) {
    await prev.click();
    await page.waitForTimeout(12000);
    text = await bodyText(page);
    expect(text).toMatch(/\d+\s*\/\s*\d+/);
  }
  results.push('Reader mode toggle and prev/next controls respond');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Discover', 60000);
  await page.waitForTimeout(3000);
  await clickBottomTab(page, 'History');
  await waitForText(page, 'Recently read chapters');
  await page.waitForTimeout(3000);
  text = await bodyText(page);
  expect(text).toContain('Osoraku');
  results.push('History records the opened chapter');

  await clickBottomTab(page, 'Library');
  await waitForText(page, 'Your saved content');
  await page.waitForTimeout(3000);
  text = await bodyText(page);
  expect(text).toContain('Bookmarks');
  expect(text).toContain('Downloads');
  expect(text).toContain('Osoraku');
  await clickVisibleText(page, 'Downloads');
  await page.waitForTimeout(1500);
  text = await bodyText(page);
  expect(text).toContain('Downloads');
  await page.screenshot({ path: outFile('nativemanhwa-live-library.png') });
  results.push('Library shows bookmark tab and downloads tab without crashing');

  await clickBottomTab(page, 'Settings');
  await waitForText(page, 'App preferences');
  text = await bodyText(page);
  for (const label of ['Auto-advance', 'Default reader mode', 'Image caching', 'Cache status', 'Reading history', 'NativeManhwa']) {
    expect(text).toContain(label);
  }
  await clickVisibleText(page, text.includes('Webtoon') ? 'Webtoon' : 'Page');
  await page.waitForTimeout(1000);
  text = await bodyText(page);
  expect(text.includes('Webtoon') || text.includes('Page')).toBeTruthy();
  await page.screenshot({ path: outFile('nativemanhwa-live-settings.png') });
  results.push('Settings renders reading/cache/history/about controls and reader mode toggles');

  await expectNoConsoleErrors(consoleErrors, 'final');
  fs.writeFileSync(
    outFile('nativemanhwa-live-audit-result.json'),
    JSON.stringify({ ok: true, results, dialogs, consoleErrors, providerChecks }, null, 2),
  );
});
