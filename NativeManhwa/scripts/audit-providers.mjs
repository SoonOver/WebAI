import { Scraper, SOURCE_ORDER, HEADERS } from '../scrapers.js';

const MAX_CANDIDATES = 8;
const IMAGE_PROBE_BYTES = 'bytes=0-1023';

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
  const contentType = response.headers.get('content-type') || '';
  return {
    ok: response.ok || response.status === 206,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
    isImage: contentType.startsWith('image/'),
  };
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
