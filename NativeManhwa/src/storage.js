import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Scraper, HEADERS } from '../scrapers';

const CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}imgcache/`
  : null;
const DOWNLOADS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}downloads/`
  : null;

function fileSafe(value) {
  return String(value || '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '_') || 'empty';
}

function hashString(value) {
  const text = String(value ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x27d4eb2d;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function safeEncode(str) {
  const value = String(str ?? '');
  const readable = fileSafe(value).slice(-36);
  return `${hashString(value)}_${readable}`;
}

export function legacySafeEncode(str) {
  const value = String(str ?? '');
  try {
    return fileSafe(btoa(value));
  } catch {
    try {
      return fileSafe(btoa(unescape(encodeURIComponent(value))));
    } catch {
      return fileSafe(encodeURIComponent(value));
    }
  }
}

export function downloadIdsForUrl(url) {
  const ids = [
    safeEncode(url).substring(0, 20),
    legacySafeEncode(url).substring(0, 20),
  ];
  return [...new Set(ids.filter(Boolean))];
}

function isBatoCdnImage(url) {
  return /merrypsycho\.xyz/i.test(String(url || ''));
}

function imageDownloadHeaders(imageUrl, referer) {
  const headers = {
    ...HEADERS,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (isBatoCdnImage(imageUrl)) {
    headers.Referer = 'https://bbato.com/';
  } else if (referer && String(referer).startsWith('http')) {
    headers.Referer = referer;
  }
  return headers;
}

function safeParse(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function safeArray(val) {
  const parsed = safeParse(val, []);
  return Array.isArray(parsed) ? parsed : [];
}

function safeObject(val) {
  const parsed = safeParse(val, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

const DEFAULT_SETTINGS = {
  autoAdvance: false,
  cacheEnabled: true,
  readerMode: 'webtoon',
  theme: 'dark',
};

function normalizeManga(item) {
  if (!item || typeof item !== 'object') return null;
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url) return null;
  return {
    ...item,
    url,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled',
    image: typeof item.image === 'string' ? item.image : '',
    source: typeof item.source === 'string' ? item.source : '',
  };
}

function normalizeHistory(item) {
  const manga = normalizeManga(item);
  if (!manga) return null;
  const timestamp = Number(item.timestamp);
  return {
    ...manga,
    lastChapter: typeof item.lastChapter === 'string' ? item.lastChapter : '',
    lastChapterUrl: typeof item.lastChapterUrl === 'string' ? item.lastChapterUrl : '',
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
  };
}

function normalizeSettings(settings) {
  return {
    autoAdvance: settings?.autoAdvance === true,
    cacheEnabled: settings?.cacheEnabled !== false,
    readerMode: settings?.readerMode === 'manga' ? 'manga' : 'webtoon',
    theme: typeof settings?.theme === 'string' ? settings.theme : DEFAULT_SETTINGS.theme,
  };
}

export const Storage = {
  async getBookmarks() {
    const val = await AsyncStorage.getItem('@bookmarks');
    return safeArray(val).map(normalizeManga).filter(Boolean);
  },

  async isBookmarked(url) {
    if (!url) return false;
    const list = await this.getBookmarks();
    return list.some((m) => m.url === url);
  },

  async toggleBookmark(manga) {
    const normalized = normalizeManga(manga);
    if (!normalized) return false;
    let list = await this.getBookmarks();
    const exists = list.find((m) => m.url === normalized.url);
    if (exists) list = list.filter((m) => m.url !== normalized.url);
    else list.push(normalized);
    await AsyncStorage.setItem('@bookmarks', JSON.stringify(list));
    return !exists;
  },

  async addHistory(manga, chapterName, chapterUrl) {
    const normalized = normalizeManga(manga);
    if (!normalized || !chapterUrl) return;
    let list = safeArray(await AsyncStorage.getItem('@history'));
    list = list.map(normalizeHistory).filter(Boolean);
    list = list.filter((m) => m.url !== normalized.url);
    list.unshift({
      ...normalized,
      lastChapter: chapterName,
      lastChapterUrl: chapterUrl,
      timestamp: Date.now(),
    });
    await AsyncStorage.setItem('@history', JSON.stringify(list.slice(0, 50)));
  },

  async getHistory() {
    const val = await AsyncStorage.getItem('@history');
    return safeArray(val).map(normalizeHistory).filter(Boolean);
  },

  async getSettings() {
    const val = await AsyncStorage.getItem('@settings');
    const parsed = safeObject(val);
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
  },

  async saveSettings(settings) {
    await AsyncStorage.setItem('@settings', JSON.stringify(normalizeSettings(settings)));
  },
};

export const DownloadManager = {
  async getLocalUri(chapterUrl) {
    if (Platform.OS === 'web') return null;
    const existing = await findExistingDownload(chapterUrl);
    if (!existing) return null;
    return existing.files.sort().map((f) => `${existing.dir}${f}`);
  },

  async isDownloaded(chapterUrl) {
    return Boolean(await findExistingDownload(chapterUrl));
  },

  async getDownloadedList() {
    try {
      if (!DOWNLOADS_DIR) return [];
      const info = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
      if (!info.exists) return [];
      const entries = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR);
      const result = [];
      for (const entry of entries) {
        const entryDir = `${DOWNLOADS_DIR}${entry}/`;
        try {
          const entryInfo = await FileSystem.getInfoAsync(entryDir);
          if (!entryInfo.exists || entryInfo.isDirectory === false) continue;
          const files = await FileSystem.readDirectoryAsync(entryDir);
          if (files.length === 0) continue;
          result.push({ id: entry, path: entryDir, count: files.length });
        } catch {
          // Ignore corrupt entries so the Library panel can still render.
        }
      }
      return result;
    } catch {
      return [];
    }
  },

  async downloadChapter(source, chapterUrl, onProgress) {
    if (Platform.OS === 'web' || !DOWNLOADS_DIR) {
      throw new Error('Downloads are not available on this platform');
    }

    const existing = await findExistingDownload(chapterUrl);
    if (existing) {
      if (onProgress) onProgress(1);
      return {
        status: 'already_downloaded',
        path: existing.dir,
        id: existing.id,
        count: existing.files.length,
      };
    }

    const id = downloadIdsForUrl(chapterUrl)[0];
    const dir = `${DOWNLOADS_DIR}${id}/`;
    const images = await Scraper.fetchImages(source, chapterUrl);
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('No images returned from source');
    }
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    try {
      for (let i = 0; i < images.length; i++) {
        const fileUri = `${dir}${String(i).padStart(3, '0')}.jpg`;
        await FileSystem.downloadAsync(images[i], fileUri, {
          headers: imageDownloadHeaders(images[i], chapterUrl),
        });
        if (onProgress) onProgress((i + 1) / images.length);
      }
    } catch (err) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
      throw err;
    }
    return { status: 'downloaded', path: dir, id, count: images.length };
  },

  async deleteDownload(chapterUrl) {
    if (!DOWNLOADS_DIR) return;
    await Promise.all(
      downloadIdsForUrl(chapterUrl).map((id) =>
        FileSystem.deleteAsync(`${DOWNLOADS_DIR}${id}/`, { idempotent: true })
      )
    );
  },

  async cacheImage(imageUrl, referer) {
    if (!imageUrl) return '';
    if (Platform.OS === 'web') return imageUrl;
    if (!CACHE_DIR) return imageUrl;
    const id = safeEncode(imageUrl).substring(0, 32);
    const path = `${CACHE_DIR}${id}.jpg`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists && info.size > 0) return path;
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      const result = await FileSystem.downloadAsync(imageUrl, path, {
        headers: imageDownloadHeaders(imageUrl, referer),
      });
      return result.uri;
    } catch {
      return imageUrl;
    }
  },

  async clearCache() {
    if (Platform.OS === 'web') return;
    if (!CACHE_DIR) return;
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    }
  },
};

async function findExistingDownload(chapterUrl) {
  if (!DOWNLOADS_DIR) return null;
  for (const id of downloadIdsForUrl(chapterUrl)) {
    const dir = `${DOWNLOADS_DIR}${id}/`;
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists || info.isDirectory === false) continue;
      const files = await FileSystem.readDirectoryAsync(dir);
      if (files.length > 0) return { id, dir, files };
    } catch {
      // Try the next candidate so legacy downloads still work.
    }
  }
  return null;
}
