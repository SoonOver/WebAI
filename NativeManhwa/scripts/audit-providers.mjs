import fs from 'node:fs';
import { Scraper, SOURCE_ORDER, HEADERS } from '../scrapers.js';

const SERIES_PER_SOURCE = positiveInt(process.env.AUDIT_SERIES_PER_SOURCE, 3);
const MIN_SERIES_PER_SOURCE = positiveInt(
  process.env.AUDIT_MIN_SERIES_PER_SOURCE,
  Math.min(2, SERIES_PER_SOURCE),
);
const MAX_CANDIDATES = positiveInt(
  process.env.AUDIT_MAX_CANDIDATES,
  Math.max(12, SERIES_PER_SOURCE * 5),
);
const PANEL_SAMPLE_PER_CHAPTER = positiveInt(process.env.AUDIT_PANEL_SAMPLE_PER_CHAPTER, 1);
const IMAGE_PROBE_BYTES = 'bytes=0-65535';
const TRANSIENT_RETRY_DELAYS_MS = [4000, 10000, 20000];

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function imageProbeReferer(url, referer) {
  if (/merrypsycho\.xyz/i.test(String(url || ''))) {
    return 'https://bbato.com/';
  }
  return referer && String(referer).startsWith('http') ? referer : '';
}

function pickChapterChecks(chapters) {
  const valid = chapters.filter((chapter) => chapter?.url);
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

async function probeImage(url, referer) {
  const headers = {
    ...HEADERS,
    Range: IMAGE_PROBE_BYTES,
  };
  const probeReferer = imageProbeReferer(url, referer);
  if (probeReferer) headers.Referer = probeReferer;
  const response = await fetch(url, {
    headers,
  });
  if (response.status === 429) {
    throw new Error('HTTP 429');
  }
  const bytes = await response.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const contentType = response.headers.get('content-type') || '';
  const dimensions = imageDimensions(buffer);
  return {
    ok: response.ok || response.status === 206,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
    isImage: contentType.startsWith('image/'),
    dimensions,
    lowResolution: Boolean(dimensions?.width && dimensions.width < 900),
  };
}

async function probeOptionalImage(url, referer) {
  if (!url) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytes: 0,
      isImage: false,
      dimensions: null,
      lowResolution: false,
      error: 'Missing image URL',
    };
  }
  try {
    return await probeImage(url, referer);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytes: 0,
      isImage: false,
      dimensions: null,
      lowResolution: false,
      error: String(error?.message || error).slice(0, 240),
    };
  }
}

function imageDimensions(buffer) {
  return pngDimensions(buffer) || jpegDimensions(buffer) || webpDimensions(buffer) || null;
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function jpegDimensions(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
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

  const coverUrl = details.image || item.image || '';
  const cover = await probeOptionalImage(coverUrl, item.url);
  const checks = [];
  for (const target of pickChapterChecks(chapters)) {
    const images = await retryTransient(
      `${itemSource} images ${target.chapter.name}`,
      () => Scraper.fetchImages(itemSource, target.chapter.url),
    );
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error(`${target.label} ${target.chapter.name}: no images`);
    }
    const sampledImages = images.slice(0, PANEL_SAMPLE_PER_CHAPTER);
    const panelSamples = [];
    for (const imageUrl of sampledImages) {
      const imageProbe = await retryTransient(
        `${itemSource} panel ${target.chapter.name}`,
        () => probeImage(imageUrl, target.chapter.url),
      );
      if (!imageProbe.ok || !imageProbe.isImage || imageProbe.bytes === 0) {
        throw new Error(
          `${target.label} ${target.chapter.name}: panel probe failed ${imageProbe.status} ${imageProbe.contentType}`,
        );
      }
      panelSamples.push({
        url: imageUrl,
        ...imageProbe,
      });
    }
    checks.push({
      label: target.label,
      chapter: target.chapter.name,
      panelCount: images.length,
      panelSamples,
    });
  }

  return {
    title: details.title || item.title,
    url: item.url,
    source: itemSource,
    coverUrl,
    cover,
    coverOk: cover.ok && cover.isImage && cover.bytes > 0,
    chapterCount: chapters.length,
    firstChapter: chapters[0]?.name,
    lastChapter: chapters[chapters.length - 1]?.name,
    checks,
  };
}

async function checkSource(source) {
  const latest = await retryTransient(
    `${source} catalog`,
    () => Scraper.fetchLatest(source, 1, {}),
  );
  const candidates = Array.isArray(latest)
    ? latest.filter((item) => item?.url).slice(0, MAX_CANDIDATES)
    : [];
  const skippedCandidates = [];
  const series = [];

  for (const item of candidates) {
    try {
      series.push(await checkManga(source, item));
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
  const complete = requiredSeries > 0 && series.length >= requiredSeries;
  const ok = requiredSeries > 0 && series.length >= minimumSeries;
  const degraded = ok && !complete;
  const warnings = degraded
    ? [
        `Only ${series.length}/${requiredSeries} requested series passed. Skipped candidates usually indicate stale provider entries, broken upstream images, or rate limits.`,
      ]
    : [];

  return {
    source,
    ok,
    complete,
    degraded,
    catalogCount: latest?.length || 0,
    sampledSeries: series.length,
    requiredSeries,
    minimumSeries,
    series,
    skippedCandidates,
    warnings,
    error: ok ? undefined : skippedCandidates.at(-1)?.error || 'No valid candidates',
  };
}

const results = [];
for (const source of SOURCE_ORDER) {
  try {
    results.push(await checkSource(source));
  } catch (error) {
    results.push({
      source,
      ok: false,
      complete: false,
      degraded: false,
      error: String(error?.message || error).slice(0, 240),
    });
  }
}

const output = JSON.stringify(results, null, 2);
console.log(output);
if (process.env.AUDIT_OUTPUT) {
  fs.writeFileSync(process.env.AUDIT_OUTPUT, `${output}\n`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
