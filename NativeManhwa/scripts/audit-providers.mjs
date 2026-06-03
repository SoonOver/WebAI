import { Scraper, SOURCE_ORDER, HEADERS } from '../scrapers.js';

const MAX_CANDIDATES = 8;
const IMAGE_PROBE_BYTES = 'bytes=0-65535';

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

async function checkSource(source) {
  const latest = await Scraper.fetchLatest(source, 1, {});
  const candidates = Array.isArray(latest)
    ? latest.filter((item) => item?.url).slice(0, MAX_CANDIDATES)
    : [];
  const skippedCandidates = [];

  for (const item of candidates) {
    try {
      const details = await Scraper.fetchDetails(item.source || source, item.url);
      const chapters = Array.isArray(details?.chapters)
        ? details.chapters.filter((chapter) => chapter?.url)
        : [];
      if (chapters.length === 0) throw new Error('No readable chapters');

      const checks = [];
      for (const target of pickChapterChecks(chapters)) {
        const images = await Scraper.fetchImages(item.source || source, target.chapter.url);
        if (!Array.isArray(images) || images.length === 0) {
          throw new Error(`${target.label} ${target.chapter.name}: no images`);
        }
        const firstImage = await probeImage(images[0], target.chapter.url);
        if (!firstImage.ok || !firstImage.isImage || firstImage.bytes === 0) {
          throw new Error(
            `${target.label} ${target.chapter.name}: first panel probe failed ${firstImage.status} ${firstImage.contentType}`,
          );
        }
        checks.push({
          label: target.label,
          chapter: target.chapter.name,
          panelCount: images.length,
          firstImage,
        });
      }

      return {
        source,
        ok: true,
        title: details.title || item.title,
        catalogCount: latest.length,
        chapterCount: chapters.length,
        firstChapter: chapters[0]?.name,
        lastChapter: chapters[chapters.length - 1]?.name,
        checks,
        skippedCandidates,
      };
    } catch (error) {
      skippedCandidates.push({
        title: item.title,
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }

  return {
    source,
    ok: false,
    catalogCount: latest?.length || 0,
    skippedCandidates,
    error: skippedCandidates.at(-1)?.error || 'No valid candidates',
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
      error: String(error?.message || error).slice(0, 240),
    });
  }
}

console.log(JSON.stringify(results, null, 2));

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
