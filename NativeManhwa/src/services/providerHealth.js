import AsyncStorage from '@react-native-async-storage/async-storage';
import { Scraper, SOURCE_ORDER, sourceShortLabel } from '../../scrapers';

const PROVIDER_HEALTH_KEY = '@provider_health';
const HEALTH_STALE_MS = 6 * 60 * 60 * 1000;

function shortError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function statusRank(status) {
  if (status === 'ok') return 0;
  if (status === 'degraded') return 1;
  return 2;
}

function normalizeHealthEntry(source, value = {}) {
  const checkedAt = Number(value.checkedAt);
  return {
    source,
    label: sourceShortLabel(source),
    status: ['ok', 'degraded', 'down'].includes(value.status) ? value.status : 'unknown',
    message: typeof value.message === 'string' ? value.message : 'Not checked yet',
    latencyMs: Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 0,
    catalogCount: Number.isFinite(Number(value.catalogCount)) ? Number(value.catalogCount) : 0,
    chapterCount: Number.isFinite(Number(value.chapterCount)) ? Number(value.chapterCount) : 0,
    panelCount: Number.isFinite(Number(value.panelCount)) ? Number(value.panelCount) : 0,
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
  return `${ok} ok · ${degraded} slow · ${down} down`;
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

    const candidate = catalog[0];
    const details = await Scraper.fetchDetails(candidate.source || source, candidate.url);
    const chapters = Array.isArray(details?.chapters)
      ? details.chapters.filter((chapter) => chapter?.url)
      : [];
    if (chapters.length === 0) {
      return {
        source,
        status: 'degraded',
        message: 'Catalog loads, but no readable chapters found',
        latencyMs: Date.now() - start,
        catalogCount: catalog.length,
        checkedAt: Date.now(),
      };
    }

    const images = await Scraper.fetchImages(candidate.source || source, chapters[0].url);
    const panelCount = Array.isArray(images) ? images.filter(Boolean).length : 0;
    if (panelCount === 0) {
      return {
        source,
        status: 'degraded',
        message: 'Details load, but chapter panels are empty',
        latencyMs: Date.now() - start,
        catalogCount: catalog.length,
        chapterCount: chapters.length,
        checkedAt: Date.now(),
      };
    }

    const hasCover = Boolean(details?.image || candidate.image);
    return {
      source,
      status: hasCover ? 'ok' : 'degraded',
      message: hasCover ? 'Catalog, details, chapters, and panels load' : 'Readable, but cover fallback may be needed',
      latencyMs: Date.now() - start,
      catalogCount: catalog.length,
      chapterCount: chapters.length,
      panelCount,
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
