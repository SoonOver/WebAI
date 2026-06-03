import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
  HEADERS,
  Scraper,
  SOURCE_ORDER,
  sortChaptersByNumber,
  sourceShortLabel,
} from '../scrapers.js';
import {
  panelProbeReferer,
  parseImagePixelSize,
  probePanelQuality,
  scorePanelQuality,
} from '../src/services/panelQuality.js';

const WORKSPACE_ROOT = path.resolve(process.cwd());
const SERIES_PER_SOURCE = positiveInt(process.env.QUALITY_SERIES_PER_SOURCE, 5);
const MIN_SERIES_PER_SOURCE = positiveInt(
  process.env.QUALITY_MIN_SERIES_PER_SOURCE,
  Math.min(5, SERIES_PER_SOURCE),
);
const MAX_CANDIDATES = positiveInt(
  process.env.QUALITY_MAX_CANDIDATES,
  Math.max(24, SERIES_PER_SOURCE * 6),
);
const PANEL_SAMPLE_PER_CHAPTER = positiveInt(process.env.QUALITY_PANEL_SAMPLE_PER_CHAPTER, 1);
const OUT_DIR = safeOutputDir(process.env.QUALITY_OUT_DIR || path.join('quality-audit', 'latest'));
const IMAGES_DIR = path.join(OUT_DIR, 'images');
const REPORT_JSON = path.join(OUT_DIR, 'panel-quality-report.json');
const REPORT_HTML = path.join(OUT_DIR, 'index.html');
const REPORT_PNG = path.join(OUT_DIR, 'panel-quality-contact-sheet.png');
const TRANSIENT_RETRY_DELAYS_MS = [2500, 7000, 15000];

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeOutputDir(value) {
  const resolved = path.resolve(WORKSPACE_ROOT, value);
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write audit output outside workspace: ${resolved}`);
  }
  return resolved;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const message = String(error?.message || error);
  return /HTTP 429|rate limit|too many requests|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

async function retryTransient(label, operation) {
  let lastError = null;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt >= TRANSIENT_RETRY_DELAYS_MS.length) break;
      await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw new Error(`${label}: ${String(lastError?.message || lastError)}`);
}

function hashString(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function safeName(value, fallback = 'item') {
  const text = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return text.slice(0, 72) || fallback;
}

function extensionFrom(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const match = String(url || '').match(/\.(webp|png|jpe?g|gif)(?:[?#].*)?$/i);
  if (!match) return '.jpg';
  return match[1].toLowerCase() === 'jpeg' ? '.jpg' : `.${match[1].toLowerCase()}`;
}

function pickChapterChecks(chapters) {
  const valid = sortChaptersByNumber(
    chapters.filter((chapter) => chapter?.url),
    'desc',
  );
  if (valid.length <= 2) {
    return valid.map((chapter, index) => ({
      label: index === 0 ? 'latest' : 'oldest',
      chapter,
    }));
  }
  return [
    { label: 'latest', chapter: valid[0] },
    { label: 'middle', chapter: valid[Math.floor(valid.length / 2)] },
    { label: 'oldest', chapter: valid[valid.length - 1] },
  ];
}

function pickPanelUrls(images) {
  const valid = images.filter(Boolean);
  if (PANEL_SAMPLE_PER_CHAPTER <= 1 || valid.length <= 1) return valid.slice(0, 1);
  const indexes = [0, Math.floor(valid.length / 2), valid.length - 1];
  const picked = [];
  for (const index of indexes) {
    const url = valid[index];
    if (url && !picked.includes(url)) picked.push(url);
    if (picked.length >= PANEL_SAMPLE_PER_CHAPTER) break;
  }
  return picked;
}

function imageHeaders(url, referer) {
  const headers = {
    ...HEADERS,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  const probeReferer = panelProbeReferer(url, referer);
  if (probeReferer) headers.Referer = probeReferer;
  return headers;
}

async function downloadPanelImage({ url, referer, fileBase }) {
  const response = await fetch(url, {
    headers: imageHeaders(url, referer),
  });
  if (response.status === 429) throw new Error('HTTP 429');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dimensions = parseImagePixelSize(bytes);
  const ext = extensionFrom(contentType, url);
  const fileName = `${fileBase}-${hashString(url)}${ext}`;
  const target = path.join(IMAGES_DIR, fileName);
  fs.writeFileSync(target, Buffer.from(bytes));
  return {
    fileName,
    relativePath: path.join('images', fileName).replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    contentType,
    dimensions,
  };
}

async function inspectPanel({ source, title, chapter, chapterLabel, panelUrl, panelIndex }) {
  const fileBase = safeName(`${source}-${title}-${chapterLabel}-${panelIndex + 1}`);
  const probe = await retryTransient(
    `${source} probe ${title} ${chapterLabel} panel ${panelIndex + 1}`,
    () => probePanelQuality(panelUrl, chapter.url, HEADERS),
  );
  const download = await retryTransient(
    `${source} download ${title} ${chapterLabel} panel ${panelIndex + 1}`,
    () => downloadPanelImage({ url: panelUrl, referer: chapter.url, fileBase }),
  );
  const dimensions = download.dimensions || probe.dimensions;
  const quality = scorePanelQuality(dimensions);
  return {
    panelIndex,
    url: panelUrl,
    localPath: download.relativePath,
    contentType: download.contentType || probe.contentType,
    bytes: download.bytes,
    status: probe.status,
    dimensions,
    quality,
  };
}

async function checkManga(source, item) {
  const itemSource = item.source || source;
  const details = await retryTransient(
    `${itemSource} details ${item.title || item.url}`,
    () => Scraper.fetchDetails(itemSource, item.url),
  );
  const chapters = Array.isArray(details?.chapters)
    ? details.chapters.filter((chapter) => chapter?.url)
    : [];
  if (chapters.length === 0) throw new Error('No readable chapters');

  const title = details.title || item.title || 'Untitled';
  const checks = [];
  for (const target of pickChapterChecks(chapters)) {
    const images = await retryTransient(
      `${itemSource} images ${title} ${target.chapter.name}`,
      () => Scraper.fetchImages(itemSource, target.chapter.url),
    );
    if (!Array.isArray(images) || images.filter(Boolean).length === 0) {
      throw new Error(`${target.label} ${target.chapter.name}: no panels`);
    }
    const panelSamples = [];
    const pickedPanels = pickPanelUrls(images);
    for (let panelIndex = 0; panelIndex < pickedPanels.length; panelIndex += 1) {
      panelSamples.push(await inspectPanel({
        source: itemSource,
        title,
        chapter: target.chapter,
        chapterLabel: target.label,
        panelUrl: pickedPanels[panelIndex],
        panelIndex,
      }));
    }
    checks.push({
      label: target.label,
      chapter: target.chapter.name,
      panelCount: images.filter(Boolean).length,
      panelSamples,
    });
  }

  const sampleQualities = checks.flatMap((check) => check.panelSamples.map((sample) => sample.quality));
  const worstQuality = worstQualityFrom(sampleQualities);
  return {
    title,
    url: item.url,
    source: itemSource,
    chapterCount: chapters.length,
    firstChapter: sortChaptersByNumber(chapters, 'desc')[0]?.name || '',
    lastChapter: sortChaptersByNumber(chapters, 'asc')[0]?.name || '',
    worstQuality,
    checks,
  };
}

function qualityRank(status) {
  if (status === 'poor') return 0;
  if (status === 'soft') return 1;
  if (status === 'unknown') return 2;
  return 3;
}

function worstQualityFrom(qualities) {
  const sorted = qualities
    .filter(Boolean)
    .slice()
    .sort((a, b) => qualityRank(a.status) - qualityRank(b.status));
  return sorted[0] || scorePanelQuality(null);
}

function sourceStats(series) {
  const samples = series.flatMap((item) =>
    item.checks.flatMap((check) => check.panelSamples),
  );
  const widths = samples
    .map((sample) => Number(sample.dimensions?.width) || 0)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const countByQuality = {
    ok: samples.filter((sample) => sample.quality.status === 'ok').length,
    soft: samples.filter((sample) => sample.quality.status === 'soft').length,
    poor: samples.filter((sample) => sample.quality.status === 'poor').length,
    unknown: samples.filter((sample) => sample.quality.status === 'unknown').length,
  };
  return {
    panelSamples: samples.length,
    countByQuality,
    minWidth: widths[0] || 0,
    medianWidth: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
    maxWidth: widths.at(-1) || 0,
  };
}

async function checkSource(source) {
  const latest = await retryTransient(
    `${source} catalog`,
    () => Scraper.fetchLatest(source, 1, { safeMode: true }),
  );
  const candidates = Array.isArray(latest)
    ? latest.filter((item) => item?.url).slice(0, MAX_CANDIDATES)
    : [];
  const skippedCandidates = [];
  const series = [];

  for (const item of candidates) {
    try {
      series.push(await checkManga(source, item));
      console.log(`${sourceShortLabel(source)}: ${series.length}/${SERIES_PER_SOURCE} ${item.title}`);
      if (series.length >= SERIES_PER_SOURCE) break;
    } catch (error) {
      skippedCandidates.push({
        title: item.title,
        url: item.url,
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }

  const requiredSeries = Math.min(SERIES_PER_SOURCE, candidates.length);
  const minimumSeries = Math.min(MIN_SERIES_PER_SOURCE, requiredSeries);
  const ok = requiredSeries > 0 && series.length >= minimumSeries;
  return {
    source,
    label: sourceShortLabel(source),
    ok,
    catalogCount: latest?.length || 0,
    sampledSeries: series.length,
    requiredSeries,
    minimumSeries,
    stats: sourceStats(series),
    series,
    skippedCandidates,
    error: ok ? undefined : skippedCandidates.at(-1)?.error || 'No valid candidates',
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function sampleCards(result) {
  return result.series.flatMap((item) =>
    item.checks.flatMap((check) =>
      check.panelSamples.map((sample) => ({ item, check, sample })),
    ),
  );
}

function renderHtml(results) {
  const generatedAt = new Date().toISOString();
  const totalSeries = results.reduce((sum, result) => sum + result.sampledSeries, 0);
  const totalSamples = results.reduce((sum, result) => sum + result.stats.panelSamples, 0);
  const providerSummaries = results.map((result) => `
    <tr>
      <td>${escapeHtml(result.label)}</td>
      <td>${result.sampledSeries}/${result.requiredSeries}</td>
      <td>${result.stats.panelSamples}</td>
      <td>${result.stats.minWidth || '-'} / ${result.stats.medianWidth || '-'} / ${result.stats.maxWidth || '-'}</td>
      <td>${result.stats.countByQuality.ok} good, ${result.stats.countByQuality.soft} soft, ${result.stats.countByQuality.poor} low, ${result.stats.countByQuality.unknown} unknown</td>
    </tr>
  `).join('');

  const providerSections = results.map((result) => {
    const cards = sampleCards(result).map(({ item, check, sample }) => {
      const dims = sample.dimensions
        ? `${sample.dimensions.width} x ${sample.dimensions.height}`
        : 'unknown size';
      return `
        <article class="panel-card quality-${escapeHtml(sample.quality.status)}">
          <div class="panel-head">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(sample.quality.label)}</span>
          </div>
          <img src="${escapeHtml(sample.localPath)}" alt="${escapeHtml(item.title)} ${escapeHtml(check.chapter)} panel">
          <p>${escapeHtml(check.label)} - ${escapeHtml(check.chapter)}</p>
          <p>${escapeHtml(dims)} - ${escapeHtml(formatBytes(sample.bytes))}</p>
          <p>${escapeHtml(sample.quality.message)}</p>
        </article>
      `;
    }).join('');
    const skipped = result.skippedCandidates.length > 0
      ? `<details><summary>${result.skippedCandidates.length} skipped candidates</summary><pre>${escapeHtml(JSON.stringify(result.skippedCandidates, null, 2))}</pre></details>`
      : '';
    return `
      <section>
        <h2>${escapeHtml(result.label)}</h2>
        <p>${result.sampledSeries}/${result.requiredSeries} series, ${result.stats.panelSamples} panel samples, width min/median/max: ${result.stats.minWidth || '-'} / ${result.stats.medianWidth || '-'} / ${result.stats.maxWidth || '-'} px.</p>
        ${skipped}
        <div class="grid">${cards}</div>
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WibuNgomik Panel Quality Audit</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070a12; color: #e5eefb; }
    body { margin: 0; padding: 28px; background: #070a12; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 36px 0 8px; font-size: 20px; letter-spacing: 0; }
    p { color: #9ca8ba; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; background: #0d1320; border: 1px solid #223047; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #223047; text-align: left; font-size: 13px; }
    th { color: #cbd5e1; background: #111a2b; }
    details { margin: 10px 0 16px; color: #fbbf24; }
    pre { white-space: pre-wrap; color: #cbd5e1; background: #0d1320; border: 1px solid #223047; padding: 10px; border-radius: 6px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .panel-card { border: 1px solid #223047; border-radius: 8px; background: #0d1320; overflow: hidden; min-width: 0; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; min-height: 44px; }
    .panel-head strong { min-width: 0; font-size: 12px; line-height: 1.25; }
    .panel-head span { flex: none; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 800; background: #26324a; }
    .panel-card img { width: 100%; height: 310px; display: block; object-fit: contain; background: #03060c; }
    .panel-card p { margin: 0; padding: 0 12px 8px; font-size: 11px; color: #9ca8ba; }
    .quality-ok .panel-head span { background: rgba(22, 163, 74, 0.32); color: #dcfce7; }
    .quality-soft .panel-head span { background: rgba(245, 158, 11, 0.32); color: #fef3c7; }
    .quality-poor .panel-head span { background: rgba(239, 68, 68, 0.35); color: #fee2e2; }
    .quality-unknown .panel-head span { background: rgba(148, 163, 184, 0.25); color: #e2e8f0; }
  </style>
</head>
<body>
  <h1>WibuNgomik Panel Quality Audit</h1>
  <p>Generated ${escapeHtml(generatedAt)}. Audited ${totalSeries} series and ${totalSamples} panel samples. Threshold: Good >= 900 px, Soft 720-899 px, Low < 720 px.</p>
  <table>
    <thead>
      <tr><th>Provider</th><th>Series</th><th>Panels</th><th>Width min/median/max</th><th>Quality split</th></tr>
    </thead>
    <tbody>${providerSummaries}</tbody>
  </table>
  ${providerSections}
</body>
</html>`;
}

async function renderScreenshot() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1800 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(REPORT_HTML).href, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(images.map((image) => {
      if (image.complete && image.naturalWidth > 0) return null;
      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));
  });
  await page.screenshot({ path: REPORT_PNG, fullPage: true });
  await browser.close();
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const results = [];
for (const source of SOURCE_ORDER) {
  try {
    results.push(await checkSource(source));
  } catch (error) {
    results.push({
      source,
      label: sourceShortLabel(source),
      ok: false,
      catalogCount: 0,
      sampledSeries: 0,
      requiredSeries: SERIES_PER_SOURCE,
      minimumSeries: MIN_SERIES_PER_SOURCE,
      stats: sourceStats([]),
      series: [],
      skippedCandidates: [],
      error: String(error?.message || error).slice(0, 240),
    });
  }
}

fs.writeFileSync(REPORT_JSON, `${JSON.stringify(results, null, 2)}\n`);
fs.writeFileSync(REPORT_HTML, renderHtml(results));
await renderScreenshot();

const summary = results.map((result) => ({
  provider: result.label,
  series: `${result.sampledSeries}/${result.requiredSeries}`,
  samples: result.stats.panelSamples,
  minWidth: result.stats.minWidth,
  medianWidth: result.stats.medianWidth,
  maxWidth: result.stats.maxWidth,
  good: result.stats.countByQuality.ok,
  soft: result.stats.countByQuality.soft,
  low: result.stats.countByQuality.poor,
  unknown: result.stats.countByQuality.unknown,
}));
console.table(summary);
console.log(`Report JSON: ${REPORT_JSON}`);
console.log(`Report HTML: ${REPORT_HTML}`);
console.log(`Contact sheet PNG: ${REPORT_PNG}`);

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
