import AsyncStorage from '@react-native-async-storage/async-storage';
import { HEADERS, Scraper, SOURCE_ORDER, sourceShortLabel, sortChaptersByNumber } from '../../scrapers';
import { probePanelQuality, scorePanelQuality } from './panelQuality';

const PROVIDER_HEALTH_KEY = '@provider_health';
const HEALTH_STALE_MS = 6 * 60 * 60 * 1000;
const HEALTH_CANDIDATE_LIMIT = 6;

function shortError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function shortTitle(title) {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function statusRank(status) {
  if (status === 'ok') return 0;
  if (status === 'degraded') return 1;
  return 2;
}

function normalizeHealthEntry(source, value = {}) {
  const checkedAt = Number(value.checkedAt);
  const panelWidth = Number(value.panelWidth);
  const panelHeight = Number(value.panelHeight);
  return {
    source,
    label: sourceShortLabel(source),
    status: ['ok', 'degraded', 'down'].includes(value.status) ? value.status : 'unknown',
    message: typeof value.message === 'string' ? value.message : 'Not checked yet',
    latencyMs: Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 0,
    catalogCount: Number.isFinite(Number(value.catalogCount)) ? Number(value.catalogCount) : 0,
    chapterCount: Number.isFinite(Number(value.chapterCount)) ? Number(value.chapterCount) : 0,
    panelCount: Number.isFinite(Number(value.panelCount)) ? Number(value.panelCount) : 0,
    panelWidth: Number.isFinite(panelWidth) ? panelWidth : 0,
    panelHeight: Number.isFinite(panelHeight) ? panelHeight : 0,
    panelQuality: ['ok', 'soft', 'poor', 'unknown'].includes(value.panelQuality)
      ? value.panelQuality
      : 'unknown',
    checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0,
  };
}

export async function getProviderHealth() {
  try {
    const raw = await AsyncStorage.getItem(PROVIDER_HEALTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return SOURCE_ORDER.map((source) => normalizeHealthEntry(source, parsed[source]));
  } catch {
    return SOURCE_ORDER.map((source) => normalizeHealthEntry(source));
  }
}

export async function saveProviderHealth(entries) {
  const map = {};
  for (const entry of entries || []) {
    if (!entry?.source) continue;
    map[entry.source] = normalizeHealthEntry(entry.source, entry);
  }
  await AsyncStorage.setItem(PROVIDER_HEALTH_KEY, JSON.stringify(map));
  return getProviderHealth();
}

export function summarizeProviderHealth(entries = []) {
  const checked = entries.filter((entry) => entry.checkedAt > 0);
  if (checked.length === 0) return 'No scan yet';
  const ok = checked.filter((entry) => entry.status === 'ok').length;
  const degraded = checked.filter((entry) => entry.status === 'degraded').length;
  const down = checked.filter((entry) => entry.status === 'down').length;
  return `${ok} ok · ${degraded} needs attention · ${down} down`;
}

export function isProviderHealthStale(entries = []) {
  const newest = Math.max(0, ...entries.map((entry) => Number(entry.checkedAt) || 0));
  return !newest || Date.now() - newest > HEALTH_STALE_MS;
}

async function scanOneProvider(source) {
  const start = Date.now();
  try {
    const latest = await Scraper.fetchLatest(source, 1, { safeMode: true });
    const catalog = Array.isArray(latest)
      ? latest.filter((item) => item?.url)
      : [];
    if (catalog.length === 0) {
      return {
        source,
        status: 'down',
        message: 'No catalog items returned',
        latencyMs: Date.now() - start,
        checkedAt: Date.now(),
      };
    }

    const skippedCandidates = [];
    const candidates = catalog.slice(0, HEALTH_CANDIDATE_LIMIT);
    for (const candidate of candidates) {
      try {
        const itemSource = candidate.source || source;
        const details = await Scraper.fetchDetails(itemSource, candidate.url);
        const chapters = Array.isArray(details?.chapters)
          ? details.chapters.filter((chapter) => chapter?.url)
          : [];
        const orderedChapters = sortChaptersByNumber(chapters, 'desc');
        if (chapters.length === 0) {
          skippedCandidates.push(`${shortTitle(candidate.title)}: no chapters`);
          continue;
        }

        const latestChapter = orderedChapters[0] || chapters[0];
        const images = await Scraper.fetchImages(itemSource, latestChapter.url);
        const panelCount = Array.isArray(images) ? images.filter(Boolean).length : 0;
        if (panelCount === 0) {
          skippedCandidates.push(`${shortTitle(candidate.title)}: empty panels`);
          continue;
        }

        const hasCover = Boolean(details?.image || candidate.image);
        const firstPanel = images.find(Boolean);
        let panelProbe = null;
        try {
          panelProbe = await probePanelQuality(firstPanel, latestChapter.url, HEADERS);
        } catch (error) {
          panelProbe = {
            dimensions: null,
            quality: {
              ...scorePanelQuality(null),
              message: shortError(error),
            },
          };
        }

        const panelQuality = panelProbe?.quality || scorePanelQuality(panelProbe?.dimensions);
        const qualityNeedsAttention = ['poor', 'soft', 'unknown'].includes(panelQuality.status);
        const status = hasCover && !qualityNeedsAttention ? 'ok' : 'degraded';
        const messageParts = [];
        if (hasCover) {
          messageParts.push('Readable');
        } else {
          messageParts.push('Readable, cover fallback needed');
        }
        if (skippedCandidates.length > 0) {
          messageParts.push(`Skipped ${skippedCandidates.length} stale catalog item${skippedCandidates.length === 1 ? '' : 's'}`);
        }
        if (panelQuality.status === 'ok') {
          messageParts.push(panelQuality.message);
        } else if (panelQuality.status === 'unknown') {
          messageParts.push(`Panel probe unknown: ${panelQuality.message}`);
        } else {
          messageParts.push(`${panelQuality.label} panels: ${panelQuality.message}`);
        }

        return {
          source,
          status,
          message: messageParts.join(' · '),
          latencyMs: Date.now() - start,
          catalogCount: catalog.length,
          chapterCount: chapters.length,
          panelCount,
          panelWidth: panelQuality.width,
          panelHeight: panelQuality.height,
          panelQuality: panelQuality.status,
          checkedAt: Date.now(),
        };
      } catch (error) {
        skippedCandidates.push(`${shortTitle(candidate.title)}: ${shortError(error)}`);
      }
    }

    return {
      source,
      status: 'degraded',
      message: skippedCandidates.length > 0
        ? `Catalog loads, but sampled titles were not readable · ${skippedCandidates[0]}`
        : 'Catalog loads, but no readable chapters found',
      latencyMs: Date.now() - start,
      catalogCount: catalog.length,
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      source,
      status: 'down',
      message: shortError(error),
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
    };
  }
}

export async function scanProviderHealth(onProgress) {
  const results = [];
  for (let index = 0; index < SOURCE_ORDER.length; index += 1) {
    const source = SOURCE_ORDER[index];
    if (onProgress) onProgress({ source, index, total: SOURCE_ORDER.length, status: 'checking' });
    const result = await scanOneProvider(source);
    results.push(normalizeHealthEntry(source, result));
    if (onProgress) onProgress({ source, index, total: SOURCE_ORDER.length, status: result.status });
  }

  const sorted = SOURCE_ORDER
    .map((source) => results.find((entry) => entry.source === source) || normalizeHealthEntry(source))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  await saveProviderHealth(sorted);
  return sorted;
}
