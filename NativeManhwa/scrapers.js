/*https://komiku.org/
 * Multi - source scraper: Bato.to, MangaDex, Komikindo - style WP, BacaKomik - style WP,
 * dan situs ber - tema MangaThemesia(banyak scanlator Indonesia memakai tema ini).
 * Domain scanlator sering berpindah; daftar di SOURCE_ORDER bisa disesuaikan.
 */
import { parse } from "node-html-parser";
import CryptoJS from "crypto-js";

export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

/** @typedef {{ key: string, engine: string, baseUrl?: string, mangaDir?: string, siteLang?: string, mdLang?: string }} SourceDef */

/** Urutan tab sumber; tambah/ubah entri MangaThemesia sesuai domain yang masih aktif. */
export const ALL_ID_SOURCE = "Semua Provider ID";

export const SOURCE_ORDER = [
  "Komikindo",
  "BacaKomik",
  "Komik Station",
  "Komiku",
  "ManhwaRead",
  "MangaDex (JSON API)",
  "MangaDex (Bahasa Indonesia)",
  "Bato.to (ID)",
];

export const ID_SOURCE_ORDER = [
  "Komikindo",
  "BacaKomik",
  "Komik Station",
  "Komiku",
  "MangaDex (Bahasa Indonesia)",
  "Bato.to (ID)",
];

export const SOURCE_PICKER_ORDER = [
  ALL_ID_SOURCE,
  ...SOURCE_ORDER,
];

export const WEB_SOURCE_ORDER = [
  "MangaDex (JSON API)",
  "MangaDex (Bahasa Indonesia)",
];

export const FILTER_SORTS = [
  { key: "updated", label: "Updated" },
  { key: "popular", label: "Popular" },
  { key: "title", label: "Title" },
];

export const FILTER_TYPES = [
  { key: "all", label: "All" },
  { key: "manga", label: "Manga" },
  { key: "manhwa", label: "Manhwa" },
  { key: "manhua", label: "Manhua" },
];

export const FILTER_STATUSES = [
  { key: "all", label: "All" },
  { key: "ongoing", label: "Ongoing" },
  { key: "completed", label: "Completed" },
];

export const FILTER_GENRES = [
  { key: "all", label: "All" },
  { key: "action", label: "Action" },
  { key: "adventure", label: "Adventure" },
  { key: "comedy", label: "Comedy" },
  { key: "drama", label: "Drama" },
  { key: "fantasy", label: "Fantasy" },
  { key: "romance", label: "Romance" },
  { key: "isekai", label: "Isekai" },
  { key: "school_life", label: "School Life" },
  { key: "slice_of_life", label: "Slice of Life" },
  { key: "horror", label: "Horror" },
  { key: "supernatural", label: "Supernatural" },
];

export const FILTER_RATINGS = [
  { key: "safe", label: "Safe" },
  { key: "suggestive", label: "Safe+" },
  { key: "all", label: "All" },
];

const FILTER_GROUPS = {
  sort: { label: "Sort", options: FILTER_SORTS },
  type: { label: "Type", options: FILTER_TYPES },
  status: { label: "Status", options: FILTER_STATUSES },
  genre: { label: "Genre", options: FILTER_GENRES },
  contentRating: { label: "Rating", options: FILTER_RATINGS },
};

const SOURCE_FILTER_SUPPORT = {
  [ALL_ID_SOURCE]: ["sort", "type", "status", "genre", "contentRating"],
  BacaKomik: ["sort", "type", "status", "genre"],
  "Komik Station": ["sort", "type", "status", "genre"],
  "MangaDex (JSON API)": ["sort", "type", "status", "genre", "contentRating"],
  "MangaDex (Bahasa Indonesia)": ["sort", "type", "status", "genre", "contentRating"],
};

const DEFAULT_FILTERS = {
  sort: "updated",
  type: "all",
  status: "all",
  genre: "all",
  contentRating: "safe",
};

function isFilterOption(group, key) {
  return FILTER_GROUPS[group]?.options.some((option) => option.key === key);
}

export function getCatalogFilterGroups(source) {
  const groups = SOURCE_FILTER_SUPPORT[source] || [];
  return groups
    .map((group) => FILTER_GROUPS[group] ? { key: group, ...FILTER_GROUPS[group] } : null)
    .filter(Boolean);
}

export function sanitizeCatalogFilters(source, filters = {}) {
  const groups = new Set(SOURCE_FILTER_SUPPORT[source] || []);
  const next = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (!groups.has(key)) continue;
    const value = filters?.[key];
    next[key] = isFilterOption(key, value) ? value : DEFAULT_FILTERS[key];
  }
  return next;
}

export function countActiveCatalogFilters(source, filters = {}) {
  const groups = SOURCE_FILTER_SUPPORT[source] || [];
  const sanitized = sanitizeCatalogFilters(source, filters);
  return groups.reduce((count, group) => {
    const defaultValue = DEFAULT_FILTERS[group];
    return count + (sanitized[group] !== defaultValue ? 1 : 0);
  }, 0);
}

class HtmlSelection {
  constructor(nodes, query) {
    this.nodes = nodes.filter(Boolean);
    this.query = query;
    this.length = this.nodes.length;
    this.nodes.forEach((node, index) => {
      this[index] = node;
    });
  }

  attr(name) {
    const node = this.nodes[0];
    if (!node || typeof node.getAttribute !== "function") return undefined;
    const value = node.getAttribute(name);
    return value == null ? undefined : String(value);
  }

  text() {
    return this.nodes
      .map((node) => {
        if (typeof node.text === "string") return node.text;
        if (typeof node.rawText === "string") return node.rawText;
        return "";
      })
      .join("");
  }

  html() {
    const node = this.nodes[0];
    if (!node) return null;
    return typeof node.innerHTML === "string" ? node.innerHTML : String(node);
  }

  find(selector) {
    const found = [];
    for (const node of this.nodes) {
      if (typeof node.querySelectorAll === "function") {
        try {
          found.push(...node.querySelectorAll(selector));
        } catch {
          // Invalid selectors should behave like an empty result.
        }
      }
    }
    return this.query(found);
  }

  first() {
    return this.query(this.nodes[0] ? [this.nodes[0]] : []);
  }

  each(callback) {
    this.nodes.forEach((node, index) => callback(index, node));
    return this;
  }

  map(callback) {
    const result = this.nodes
      .map((node, index) => callback(index, node))
      .filter((value) => value != null);
    return {
      get: () => result,
      toArray: () => result,
    };
  }

  get(index) {
    return index == null ? this.nodes : this.nodes[index];
  }

  toArray() {
    return this.nodes;
  }

  closest(selector) {
    const found = [];
    for (const node of this.nodes) {
      if (typeof node.closest === "function") {
        try {
          const match = node.closest(selector);
          if (match && !found.includes(match)) found.push(match);
        } catch {
          // Invalid selectors should behave like an empty result.
        }
      }
    }
    return this.query(found);
  }

  contents() {
    const children = [];
    for (const node of this.nodes) {
      if (Array.isArray(node.childNodes)) children.push(...node.childNodes);
    }
    return this.query(children);
  }

  remove() {
    this.nodes.forEach((node) => {
      if (typeof node.remove === "function") node.remove();
    });
    return this;
  }
}

function loadHtml(html) {
  const root = parse(String(html || ""));
  const query = (input) => {
    if (input instanceof HtmlSelection) return input;
    if (Array.isArray(input)) return new HtmlSelection(input, query);
    if (typeof input === "string") {
      const selector = input.trim();
      if (!selector) return new HtmlSelection([], query);
      try {
        return new HtmlSelection(root.querySelectorAll(selector), query);
      } catch {
        return new HtmlSelection([], query);
      }
    }
    return input ? new HtmlSelection([input], query) : new HtmlSelection([], query);
  };
  query.html = () => root.toString();
  query.root = () => new HtmlSelection([root], query);
  return query;
}

const BATO_DOMAINS = ["https://bbato.com"];

async function batoTryDomains(path) {
  let lastErr = "Unknown error";
  for (const domain of BATO_DOMAINS) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, { headers: HEADERS });
      if (res.ok) return { html: await res.text(), base: domain, url };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || e;
    }
  }
  throw new Error(`Bato failed. Last error: ${lastErr}`);
}

async function safeFetch(url, options = {}, timeoutMs = 25000, maxRetries = 1) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(id);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError || new Error('Request failed');
}

function absUrl(base, href) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function cleanMangaTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^Komik\s+/i, "")
    .trim();
}

const SEARCH_ALIAS_GROUPS = [
  [
    "the great estate developer",
    "great estate developer",
    "the greatest estate developer",
    "greatest estate developer",
    "the world's best engineer",
    "the worlds best engineer",
    "world's best engineer",
    "worlds best engineer",
    "the world best engineer",
    "world best engineer",
    "estate developer",
    "yeokdaegeum yeongji seolgyesa",
  ],
];

function normalizeSearchText(value) {
  return cleanMangaTitle(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

const SEARCH_VARIANT_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "komik",
  "manga",
  "manhwa",
  "manhua",
]);

function genericSearchQueryVariants(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const meaningfulTokens = tokens.filter((token) => !SEARCH_VARIANT_STOP_WORDS.has(token));
  const variants = [];
  const add = (value) => {
    const clean = normalizeSearchText(value);
    if (clean && clean !== normalized) variants.push(clean);
  };

  add(tokens.filter((token, index) => !(index === 0 && ["the", "a", "an"].includes(token))).join(" "));
  if (meaningfulTokens.length >= 3) add(meaningfulTokens.slice(-3).join(" "));
  if (meaningfulTokens.length >= 2) add(meaningfulTokens.slice(-2).join(" "));
  if (meaningfulTokens.length >= 4) add(meaningfulTokens.slice(0, -1).join(" "));

  return variants;
}

function isAliasRelated(query, aliases) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;

  const queryTokens = new Set(searchTokens(query));
  return aliases.some((alias) => {
    const normalizedAlias = normalizeSearchText(alias);
    if (!normalizedAlias) return false;
    if (
      normalizedAlias === normalizedQuery ||
      normalizedAlias.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedAlias)
    ) {
      return true;
    }

    const aliasTokens = searchTokens(alias);
    const overlap = aliasTokens.filter((token) => queryTokens.has(token)).length;
    return overlap >= Math.min(2, aliasTokens.length);
  });
}

function expandSearchQueries(query) {
  const base = cleanMangaTitle(query);
  if (!base) return [];

  const queries = [base];
  queries.push(...genericSearchQueryVariants(base));
  for (const aliasGroup of SEARCH_ALIAS_GROUPS) {
    if (!isAliasRelated(base, aliasGroup)) continue;
    queries.push(...aliasGroup);
  }

  const seen = new Set();
  return queries.filter((item) => {
    const key = normalizeSearchText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activeFilterKeys(source, filters = {}) {
  const groups = SOURCE_FILTER_SUPPORT[source] || [];
  const sanitized = sanitizeCatalogFilters(source, filters);
  return groups.filter((group) => sanitized[group] !== DEFAULT_FILTERS[group]);
}

function sourceSupportsFilterKeys(source, filterKeys = []) {
  if (filterKeys.length === 0) return true;
  const supported = new Set(SOURCE_FILTER_SUPPORT[source] || []);
  return filterKeys.every((key) => supported.has(key));
}

function aggregateSourcesFor(source, filters = {}) {
  if (source !== ALL_ID_SOURCE) return [];
  const filterKeys = activeFilterKeys(source, filters);
  return ID_SOURCE_ORDER.filter((sourceKey) => sourceSupportsFilterKeys(sourceKey, filterKeys));
}

function normalizeResultKey(item) {
  const source = String(item?.source || "").trim();
  const url = String(item?.url || "")
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return `${source}:${url || cleanMangaTitle(item?.title).toLowerCase()}`;
}

function withoutAggregateMeta(item) {
  if (!item || typeof item !== "object") return item;
  const { _sourceIndex, _resultIndex, _rank, ...cleanItem } = item;
  return cleanItem;
}

function dedupeMangaResults(items = []) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    if (!item?.url) continue;
    const key = normalizeResultKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function interleaveBySource(items = [], sources = [], limit = 80) {
  const groups = new Map();
  for (const item of items) {
    const index = Number.isInteger(item?._sourceIndex)
      ? item._sourceIndex
      : sourcePriority(item?.source, sources);
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(item);
  }

  const output = [];
  let row = 0;
  let added = true;
  while (output.length < limit && added) {
    added = false;
    for (let index = 0; index < sources.length && output.length < limit; index += 1) {
      const item = groups.get(index)?.[row];
      if (!item) continue;
      output.push(item);
      added = true;
    }
    row += 1;
  }
  return output;
}

function sourcePriority(source, sources = []) {
  const index = sources.indexOf(source);
  return index === -1 ? sources.length : index;
}

function searchRank(query, item, source, index, sources) {
  const q = normalizeSearchText(query);
  const title = normalizeSearchText(item?.title);
  let score = sourcePriority(source, sources) * 10 + index / 1000;
  if (q && title === q) score -= 1000;
  else if (q && title.startsWith(q)) score -= 500;
  else if (q && title.includes(q)) score -= 250;
  return score;
}

function resultMatchesQuery(query, item) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const title = normalizeSearchText(item?.title);
  if (title.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((token) => token.length > 2);
  if (tokens.length === 0) return true;
  return tokens.every((token) => title.includes(token));
}

function resultMatchesSearchIntent(query, item) {
  return expandSearchQueries(query).some((candidate) => resultMatchesQuery(candidate, item));
}

async function searchSingleSource(source, query, filters = {}) {
  switch (source) {
    case "Komikindo":
      return komikindoSearch(query);
    case "BacaKomik":
      return bacakomikSearch(query, filters);
    case "Komik Station":
      return mtSearch(source, query, filters);
    case "Komiku":
      return komikuSearch(query);
    case "ManhwaRead":
      return manhwareadSearch(query);
    case "MangaDex (JSON API)":
      return mdSearch("en", query, filters);
    case "MangaDex (Bahasa Indonesia)":
      return mdSearch("id", query, filters);
    case "Bato.to (ID)":
      return batoSearch(query);
    default:
      return [];
  }
}

async function sourceSearch(source, query, filters = {}) {
  const queries = expandSearchQueries(query);
  if (queries.length === 0) return [];

  const settled = await Promise.allSettled(
    queries.map((candidate) => searchSingleSource(source, candidate, filters))
  );
  const merged = [];
  settled.forEach((result, queryIndex) => {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;
    result.value.forEach((item, resultIndex) => {
      if (!item?.url || !resultMatchesSearchIntent(query, item)) return;
      merged.push({
        ...item,
        _resultIndex: queryIndex * 1000 + resultIndex,
        _rank: searchRank(queries[queryIndex], item, item.source || source, resultIndex, [source]),
      });
    });
  });

  return dedupeMangaResults(merged)
    .sort((a, b) => (a._rank - b._rank) || (a._resultIndex - b._resultIndex))
    .slice(0, 80)
    .map(withoutAggregateMeta);
}

async function aggregateLatest(source, page = 1, filters = {}) {
  const sources = aggregateSourcesFor(source, filters);
  if (sources.length === 0) return [];
  const settled = await Promise.allSettled(
    sources.map((sourceKey) => dispatchLatest(sourceKey, page, filters))
  );
  const merged = [];
  settled.forEach((result, sourceIndex) => {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;
    const sourceKey = sources[sourceIndex];
    result.value.forEach((item, resultIndex) => {
      if (!item?.url) return;
      merged.push({
        ...item,
        source: item.source || sourceKey,
        _sourceIndex: sourceIndex,
        _resultIndex: resultIndex,
      });
    });
  });
  const sorted = dedupeMangaResults(merged)
    .sort((a, b) => (a._sourceIndex - b._sourceIndex) || (a._resultIndex - b._resultIndex));
  return interleaveBySource(sorted, sources, 80).map(withoutAggregateMeta);
}

async function aggregateSearch(source, query, filters = {}) {
  const sources = aggregateSourcesFor(source, filters);
  if (sources.length === 0) return [];
  const settled = await Promise.allSettled(
    sources.map((sourceKey) => sourceSearch(sourceKey, query, filters))
  );
  const merged = [];
  settled.forEach((result, sourceIndex) => {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;
    const sourceKey = sources[sourceIndex];
    result.value.forEach((item, resultIndex) => {
      if (!item?.url || !resultMatchesSearchIntent(query, item)) return;
      const sourceName = item.source || sourceKey;
      merged.push({
        ...item,
        source: sourceName,
        _sourceIndex: sourceIndex,
        _resultIndex: resultIndex,
        _rank: searchRank(query, item, sourceName, resultIndex, sources),
      });
    });
  });
  return dedupeMangaResults(merged)
    .sort((a, b) => (a._rank - b._rank) || (a._sourceIndex - b._sourceIndex) || (a._resultIndex - b._resultIndex))
    .slice(0, 80)
    .map(withoutAggregateMeta);
}

function wpFilterSlug(value) {
  return String(value || "").trim().replace(/_/g, "-");
}

function wpOrderParam(filters = {}) {
  switch (filters.sort) {
    case "popular":
      return "popular";
    case "title":
      return "title";
    case "updated":
    default:
      return "update";
  }
}

function buildWpCatalogPath(path, { page = 1, title = "", filters = {} } = {}) {
  const params = new URLSearchParams();
  const order = wpOrderParam(filters);
  if (order) params.set("order", order);
  if (page > 1) params.set("page", String(page));
  if (title) params.set("title", title);
  if (filters.type && filters.type !== "all") params.set("type", wpFilterSlug(filters.type));
  if (filters.status && filters.status !== "all") params.set("status", wpFilterSlug(filters.status));
  if (filters.genre && filters.genre !== "all") params.append("genre[]", wpFilterSlug(filters.genre));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function filterKeyFromLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mdOriginalLanguageForType(type) {
  switch (type) {
    case "manga":
      return "ja";
    case "manhwa":
      return "ko";
    case "manhua":
      return "zh";
    default:
      return "";
  }
}

function mdOrderForSort(sort, hasTitleQuery) {
  if (hasTitleQuery && (!sort || sort === "updated")) {
    return { key: "relevance", direction: "desc" };
  }
  switch (sort) {
    case "popular":
      return { key: "followedCount", direction: "desc" };
    case "title":
      return { key: "title", direction: "asc" };
    case "updated":
    default:
      return { key: "latestUploadedChapter", direction: "desc" };
  }
}

let mangaDexTagMapPromise = null;

async function getMangaDexTagMap() {
  if (!mangaDexTagMapPromise) {
    mangaDexTagMapPromise = (async () => {
      const res = await safeFetch("https://api.mangadex.org/manga/tag", {
        headers: HEADERS,
      });
      const json = await res.json();
      const map = {};
      (json.data || []).forEach((tag) => {
        const name = tag?.attributes?.name?.en;
        const id = tag?.id;
        if (name && id) map[filterKeyFromLabel(name)] = id;
      });
      return map;
    })();
  }
  return mangaDexTagMapPromise;
}

function cleanImageAttr(value) {
  return String(value || "").trim();
}

function srcsetCandidates(srcset) {
  return String(srcset || "")
    .split(",")
    .map((entry) => {
      const [url, descriptor = ""] = entry.trim().split(/\s+/);
      const widthMatch = descriptor.match(/^(\d+)w$/i);
      const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
      const score = widthMatch
        ? Number(widthMatch[1])
        : densityMatch
          ? Number(densityMatch[1]) * 1000
          : 0;
      return { url: cleanImageAttr(url), score };
    })
    .filter((candidate) => candidate.url);
}

function bestSrcsetImage(...srcsets) {
  return srcsets
    .flatMap(srcsetCandidates)
    .sort((a, b) => b.score - a.score)[0]?.url || "";
}

function imgAttr($, el) {
  const $el = $(el);
  const preferredDirect = [
    $el.attr("data-original"),
    $el.attr("data-original-src"),
    $el.attr("data-image"),
  ].map(cleanImageAttr).find(Boolean);
  if (preferredDirect) return preferredDirect;

  const bestResponsive = bestSrcsetImage($el.attr("data-srcset"), $el.attr("srcset"));
  if (bestResponsive) return bestResponsive;

  return [
    $el.attr("data-src"),
    $el.attr("data-lazy-src"),
    $el.attr("data-fallback"),
    $el.attr("data-cfsrc"),
    $el.attr("src"),
    $el.attr("data-thumb"),
  ].map(cleanImageAttr).find(Boolean) || "";
}

function isLikelyNonCoverImage(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return true;
  if (url.startsWith("data:")) return true;
  return (
    /\/flags?\//.test(url) ||
    /(?:^|[\/_-])(?:logo|icon|avatar|banner|placeholder|spacer|loading)(?:[\/_.-]|$)/.test(url) ||
    /\.svg(?:[?#].*)?$/.test(url)
  );
}

function imageCandidates($, el) {
  const $el = $(el);
  const candidates = [
    $el.attr("data-original"),
    $el.attr("data-original-src"),
    $el.attr("data-image"),
    bestSrcsetImage($el.attr("data-srcset"), $el.attr("srcset")),
    $el.attr("data-src"),
    $el.attr("data-lazy-src"),
    $el.attr("data-fallback"),
    $el.attr("data-cfsrc"),
    $el.attr("src"),
    $el.attr("data-thumb"),
  ];

  return candidates.map(cleanImageAttr).filter(Boolean);
}

function firstUsableCoverImage($, root, baseUrl) {
  const images = [];
  const addCandidate = (candidate) => {
    const image = absUrl(baseUrl, candidate);
    if (!image || !image.startsWith("http") || isLikelyNonCoverImage(image)) return;
    images.push(image);
  };

  $(root).each((_, img) => {
    const tagName = String(img?.tagName || img?.rawTagName || "").toLowerCase();
    if (tagName === "img") {
      imageCandidates($, img).forEach(addCandidate);
    }
  });

  $(root).find("img").each((_, img) => {
    imageCandidates($, img).forEach(addCandidate);
  });

  return images[0] || "";
}

function normalizeChapterImages(images = [], chapterUrl) {
  const absoluteImages = [...new Set(
    images
      .map((image) => absUrl(chapterUrl, image))
      .filter((image) => image && image.startsWith("http"))
  )];
  const hasNonGifPage = absoluteImages.some((image) => !/\.gif(?:[?#].*)?$/i.test(image));

  return absoluteImages.filter((image) => {
    const lower = image.toLowerCase();
    if (isLikelyNonCoverImage(lower)) return false;
    if (hasNonGifPage && /\.gif(?:[?#].*)?$/i.test(lower)) return false;
    return !/(?:^|[\/_.-])(?:ads?|advert|adserver|adservice|banner|casino|slot|jackpot|sponsor|promo)(?:[\/_.-]|$)/.test(lower);
  });
}

/** 
 * Sistem Backup: Pencarian gambar chapter secara agresif jika selektor standar gagal.
 */
function findChapterImages($, chapterUrl) {
  const images = [];
  const selectors = [
    "#anjay_ini_id_kh img",
    "div#readerarea img",
    "div.reader-area img",
    "div.chapter-content img",
    ".chapter-image img",
    "div#chimg-auh img",
    "#anjay_kuproy img",
    "#chimg img",
    ".img-landmine img",
    "#Baca_Komik img",
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      let u = imgAttr($, el);
      
      // Khusus BacaKomik/MangaThemesia: Jika src kosong, cek onError
      if (!u) {
        const onErr = $el.attr("onerror") || $el.attr("onError") || "";
        const m = onErr.match(/src=['"]([^'"]+)['"]/);
        if (m) u = m[1];
      }
      
      if (u && !images.includes(u)) images.push(u);
    });
    if (images.length > 5) break; 
  }

  // Backup: Jika selektor ID gagal, cari gambar apapun yang punya 'chapter' atau 'halaman'
  if (images.length === 0) {
    $("img").each((_, el) => {
      const u = imgAttr($, el);
      const alt = ($(el).attr("alt") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      if (u && (alt.includes("chapter") || alt.includes("page") || alt.includes("halaman") || cls.includes("wp-image"))) {
        if (!images.includes(u)) images.push(u);
      }
    });
  }

  // Final Backup: Regex pencarian URL gambar langsung dari HTML
  if (images.length === 0) {
    const htmlText = $.html();
    const imgRegex = /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp|gif)(\?[^"'\s]*)?/gi;
    const matches = htmlText.match(imgRegex);
    if (matches) {
      const filtered = matches.filter(u => 
        !u.includes("avatar") && !u.includes("icon") && !u.includes("logo") && !u.includes("banner")
      );
      images.push(...filtered);
    }
  }

  return normalizeChapterImages(images, chapterUrl);
}

export function sourceShortLabel(sourceKey) {
  if (!sourceKey) return "Unknown";
  const label = String(sourceKey);
  if (label === ALL_ID_SOURCE) return "All ID";
  if (label === "MangaDex (JSON API)") return "MangaDex";
  if (label === "MangaDex (Bahasa Indonesia)") return "MD · ID";
  if (label === "Bato.to (ID)") return "Bato";
  if (label === "Komik Station") return "K.Station";
  if (label === "BacaKomik") return "Baca";
  if (label === "Komikindo") return "Komikindo";
  if (label === "Komiku") return "Komiku";
  if (label === "ManhwaRead") return "M.Read";
  return label.length > 14 ? `${label.slice(0, 12)}…` : label;
}

// --- Komiku ---
const KOMIKU_DOMAINS = ["https://komiku.org", "https://komiku.id"];

async function komikuTryDomains(path) {
  let lastErr = "Unknown error";
  for (const domain of KOMIKU_DOMAINS) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, { headers: HEADERS });
      if (res.ok) return { html: await res.text(), base: domain };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || e;
    }
  }
  throw new Error(`Komiku failed. Last error: ${lastErr}`);
}

async function komikuLatest(page = 1) {
  const path = page > 1 ? `/page/${page}/` : "/";
  const { html, base } = await komikuTryDomains(path);
  const $ = loadHtml(html);
  const results = [];
  $(".ls4, .ls4w, .bima, .ls2, .ls2j").each((_, el) => {
    const title = cleanMangaTitle($(el).find("h3 a, h4 a, .kan a").first().text());
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && url)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, url),
        source: "Komiku",
      });
  });
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

async function komikuSearch(query) {
  const { html, base } = await komikuTryDomains(
    `/?post_type=manga&s=${encodeURIComponent(query)}`,
  );
  const $ = loadHtml(html);
  const results = [];
  $(".bima").each((_, el) => {
    const title = cleanMangaTitle($(el).find("h3 a, h4 a, .kan a").first().text());
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && url)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, url),
        source: "Komiku",
      });
  });
  if (results.length > 0) return results;

  $(".ls4, .ls4w, .ls2, .ls2j").each((_, el) => {
    const title = cleanMangaTitle($(el).find("h3 a, h4 a, .kan a").first().text());
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && url)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, url),
        source: "Komiku",
      });
  });
  return results;
}

async function komikuDetails(url) {
  const { html } = await komikuTryDomains(url);
  const $ = loadHtml(html);
  const title = cleanMangaTitle($("#Judul h1").text() || $("h1").first().text());
  const image = firstUsableCoverImage($, $(".ims, .thumb, .info").first(), url);
  const description =
    $("p.desc").text().trim() || $("#Sinopsis p, .desc p").text().trim();
  const chapters = [];
  $("#Chapter tbody tr").each((_, el) => {
    const a = $(el).find("td.judulseries a").first();
    const name = a.text().trim();
    const href = a.attr("href");
    if (name && href) chapters.push({ name, url: absUrl(url, href) });
  });
  if (chapters.length === 0) {
    $(".bxcl li, #chapter_list li").each((_, el) => {
      const a = $(el).find("a").first();
      const name = a.text().trim();
      const href = a.attr("href");
      if (name && href) chapters.push({ name, url: absUrl(url, href) });
    });
  }
  return { title, image: absUrl(url, image), description, chapters };
}

async function komikuImages(chapterUrl) {
  const { html } = await komikuTryDomains(chapterUrl);
  const $ = loadHtml(html);
  return findChapterImages($, chapterUrl);
}

// --- Komikindo (animepost + #chimg-auh) ---
const KOMIKINDO_DOMAINS = [
  "https://komikindo.ch",
  "https://komikindo.bio",
  "https://komikindo.co",
  "https://komikindo.tv",
  "https://komikindo.id",
];

async function komikindoTryDomains(path) {
  let lastErr = "Unknown error";
  for (const domain of KOMIKINDO_DOMAINS) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, {
        headers: HEADERS,
      });
      if (res.ok) return { html: await res.text(), base: domain };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || e;
    }
  }
  throw new Error(`Komikindo failed. Last error: ${lastErr}`);
}

async function komikindoLatest() {
  const { html, base } = await komikindoTryDomains("/");
  const $ = loadHtml(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const title = cleanMangaTitle(
      $(el).find(".tt h3 a").text().trim() ||
      $(el).find(".tt h4").text().trim()
    );
    const url =
      $(el).find(".tt h3 a").attr("href") || $(el).find("a").attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && url)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, url),
        source: "Komikindo",
      });
  });
  return results;
}

async function komikindoSearch(query) {
  const { html, base } = await komikindoTryDomains(
    `/?s=${encodeURIComponent(query)}`,
  );
  const $ = loadHtml(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const title = cleanMangaTitle(
      $(el).find(".tt h3 a").text().trim() ||
      $(el).find(".tt h4").text().trim()
    );
    const url =
      $(el).find(".tt h3 a").attr("href") || $(el).find("a").attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && url)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, url),
        source: "Komikindo",
      });
  });
  return results;
}

async function komikindoDetails(url) {
  const { html } = await komikindoTryDomains(url);
  const $ = loadHtml(html);
  const title = cleanMangaTitle($(".entry-title").text());
  const image = firstUsableCoverImage($, $(".thumb, .bigcontent, .postbody").first(), url);
  const description = $('div[itemprop="description"]').text().trim();
  const chapters = [];
  $("#chapter_list li").each((_, el) => {
    const href = $(el).find(".lchx a").attr("href");
    const name = $(el).find(".lchx a").text().replace(/\s+/g, " ").trim();
    if (href && name) chapters.push({ name, url: absUrl(url, href) });
  });
  return { title, image, description, chapters };
}

async function komikindoImages(chapterUrl) {
  const { html } = await komikindoTryDomains(chapterUrl);
  const $ = loadHtml(html);
  return findChapterImages($, chapterUrl);
}

// --- BacaKomik (animepost + reader onError / chapter imgs) ---
const BACA_DOMAINS = [
  "https://bacakomik.my",
  "https://bacakomik.co",
  "https://bacakomik.id",
  "https://bacakomik.net",
  "https://bacakomik.info",
];

async function bacakomikTryDomains(path) {
  let lastErr = "Unknown error";
  for (const domain of BACA_DOMAINS) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, {
        headers: HEADERS,
      });
      if (res.ok) return { html: await res.text(), base: domain };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || e;
    }
  }
  throw new Error(`BacaKomik failed. Last error: ${lastErr}`);
}

async function bacakomikLatest(page = 1, filters = {}) {
  const safeFilters = sanitizeCatalogFilters("BacaKomik", filters);
  const { html, base } = await bacakomikTryDomains(
    buildWpCatalogPath("/daftar-komik/", { page, filters: safeFilters }),
  );
  return parseBacakomikListing(html, base);
}

async function bacakomikSearch(query, filters = {}) {
  const safeFilters = sanitizeCatalogFilters("BacaKomik", filters);
  const { html, base } = await bacakomikTryDomains(
    buildWpCatalogPath("/daftar-komik/", {
      title: query,
      filters: safeFilters,
    }),
  );
  return parseBacakomikListing(html, base);
}

function parseBacakomikListing(html, baseForAbs) {
  const $ = loadHtml(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const $el = $(el);
    const a = $el.find("div.animposx > a").first();
    const url = a.attr("href");
    const title = cleanMangaTitle($el.find(".animposx .tt h4").text());
    const image = firstUsableCoverImage($, $el.find("div.limit, .animposx").first(), baseForAbs);
    if (title && url) {
      results.push({
        title,
        image: absUrl(baseForAbs, image),
        url: absUrl(baseForAbs, url),
        source: "BacaKomik",
      });
    }
  });
  return results;
}

async function bacakomikDetails(url) {
  const { html } = await bacakomikTryDomains(url);
  const $ = loadHtml(html);
  const title = cleanMangaTitle(
    $("#breadcrumbs li:last-child span").text().trim() ||
    $(".entry-title").text().trim()
  );
  const image = firstUsableCoverImage($, $(".thumb, .bigcontent, .postbody").first(), url);
  const descEl = $("div.desc > .entry-content.entry-content-single");
  const description = descEl.length ? descEl.find("p").text().trim() : "";
  const chapters = [];
  $("#chapter_list li").each((_, el) => {
    const href = $(el).find(".lchx a").attr("href");
    const name = $(el).find(".lchx a").text().replace(/\s+/g, " ").trim();
    if (href && name) chapters.push({ name, url: absUrl(url, href) });
  });
  return { title, image: absUrl(url, image), description, chapters };
}

async function bacakomikImages(chapterUrl) {
  const { html } = await bacakomikTryDomains(chapterUrl);
  const $ = loadHtml(html);
  return findChapterImages($, chapterUrl);
}

// --- MangaThemesia (reader #readerarea) ---
// Domain fallbacks for each MT-based source
const MT_SOURCE_DOMAINS = {
  "Komik Station": [
    "https://komikstation.org",
    "https://komikstation.co",
    "https://komikstation.id",
    "https://komikstation.net",
  ],
};

const MT_SOURCE_DIRS = {
  "Komik Station": "manga",
};

async function mtTryDomains(domains, path) {
  for (const domain of domains) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, {
        headers: HEADERS,
      });
      if (res.ok) return { html: await res.text(), base: domain };
    } catch (e) {
      // try next domain
    }
  }
  throw new Error(`All domains failed for path: ${path.slice(0, 60)}`);
}

function mtBuildListUrl(baseUrl, mangaDir, page, order, title, filters = {}) {
  const b = baseUrl.replace(/\/$/, "");
  const dir = (mangaDir || "manga").replace(/^\/|\/$/g, "");
  const u = new URL(`${b}/${dir}/`);
  u.searchParams.set("page", String(page));
  if (title !== undefined && title !== null) u.searchParams.set("title", title);
  if (order) u.searchParams.set("order", order);
  if (filters.type && filters.type !== "all") u.searchParams.set("type", wpFilterSlug(filters.type));
  if (filters.status && filters.status !== "all") u.searchParams.set("status", wpFilterSlug(filters.status));
  if (filters.genre && filters.genre !== "all") u.searchParams.append("genre[]", wpFilterSlug(filters.genre));
  return u.href;
}

async function mtLatest(sourceKey, page = 1, filters = {}) {
  const safeFilters = sanitizeCatalogFilters(sourceKey, filters);
  const domains = MT_SOURCE_DOMAINS[sourceKey] || [sourceKey];
  const mangaDir = MT_SOURCE_DIRS[sourceKey] || "manga";
  let lastErr = null;
  for (const domain of domains) {
    try {
      const url = mtBuildListUrl(domain, mangaDir, page, wpOrderParam(safeFilters), "", safeFilters);
      const res = await safeFetch(url, {
        headers: HEADERS,
      });
      if (res.ok) {
        const html = await res.text();
        return mtParseListing(html, domain, sourceKey);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Failed to fetch latest from ${sourceKey}`);
}

async function mtSearch(sourceKey, query, filters = {}) {
  const safeFilters = sanitizeCatalogFilters(sourceKey, filters);
  const domains = MT_SOURCE_DOMAINS[sourceKey] || [sourceKey];
  const mangaDir = MT_SOURCE_DIRS[sourceKey] || "manga";
  let lastErr = null;
  for (const domain of domains) {
    try {
      const url = mtBuildListUrl(domain, mangaDir, 1, wpOrderParam(safeFilters), query, safeFilters);
      const res = await safeFetch(url, {
        headers: HEADERS,
      });
      if (res.ok) {
        const html = await res.text();
        return mtParseListing(html, domain, sourceKey);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Failed to search from ${sourceKey}`);
}

function mtParseListing(html, baseUrl, sourceKey) {
  const $ = loadHtml(html);
  const sel = ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx";
  const results = [];
  $(sel).each((_, el) => {
    const $el = $(el);
    const a = $el.find("a").first();
    const href = a.attr("href");
    const title = (a.attr("title") || a.text() || "").trim();
    const image = firstUsableCoverImage($, $el, baseUrl);
    if (title && href) {
      results.push({
        title,
        image: absUrl(baseUrl, image),
        url: absUrl(baseUrl, href),
        source: sourceKey,
      });
    }
  });
  return results;
}

async function mtDetails(url) {
  const res = await safeFetch(url, {
    headers: HEADERS,
  });
  const html = await res.text();
  const $ = loadHtml(html);
  const root = $(
    "div.bigcontent, div.animefull, div.main-info, div.postbody",
  ).first();
  const title =
    root
      .find("h1.entry-title, .ts-breadcrumb li:last-child span")
      .first()
      .text()
      .trim() || $("h1").first().text().trim();
  const image =
    firstUsableCoverImage($, root.find(".thumb, .infomanga, [itemprop=\"image\"]").first(), url) ||
    firstUsableCoverImage($, root, url);
  const description = root
    .find(".desc, .entry-content[itemprop=description]")
    .text()
    .trim();
  const chapters = [];
  const chSel =
    "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";
  $(chSel).each((_, el) => {
    const $el = $(el);
    const $a = $el.find("a").first();
    const href = $a.attr("href");
    const name =
      $el.find(".lch a, .chapternum").text().replace(/\s+/g, " ").trim() ||
      $a.text().replace(/\s+/g, " ").trim();
    if (href && name) chapters.push({ name, url: absUrl(url, href) });
  });
  return {
    title,
    image: absUrl(url, image),
    description,
    chapters,
  };
}

async function mtImages(chapterUrl) {
  const res = await safeFetch(chapterUrl, {
    headers: HEADERS,
  });
  const html = await res.text();
  const $ = loadHtml(html);
  return findChapterImages($, chapterUrl);
}

// --- MangaDex ---
async function buildMangaDexQuery(lang, page, filters = {}, query = "") {
  const source = lang === "id" ? "MangaDex (Bahasa Indonesia)" : "MangaDex (JSON API)";
  const safeFilters = sanitizeCatalogFilters(source, filters);
  const offset = (page - 1) * 20;
  const params = new URLSearchParams();
  params.set("limit", "20");
  params.set("offset", String(offset));
  params.append("includes[]", "cover_art");
  if (query) params.set("title", query);
  if (lang === "id") params.append("availableTranslatedLanguage[]", "id");

  const rating = safeFilters.contentRating;
  if (rating === "safe") {
    params.append("contentRating[]", "safe");
  } else if (rating === "suggestive") {
    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");
  } else {
    ["safe", "suggestive", "erotica"].forEach((value) => {
      params.append("contentRating[]", value);
    });
  }

  if (safeFilters.status !== "all") {
    params.append("status[]", safeFilters.status);
  }

  const originalLanguage = mdOriginalLanguageForType(safeFilters.type);
  if (originalLanguage) {
    params.append("originalLanguage[]", originalLanguage);
  }

  if (safeFilters.genre !== "all") {
    const tagMap = await getMangaDexTagMap();
    const tagId = tagMap[safeFilters.genre];
    if (tagId) {
      params.append("includedTags[]", tagId);
      params.set("includedTagsMode", "AND");
    }
  }

  const order = mdOrderForSort(safeFilters.sort, Boolean(query));
  params.set(`order[${order.key}]`, order.direction);
  return params.toString();
}

async function mdLatest(lang, page = 1, filters = {}) {
  const q = await buildMangaDexQuery(lang, page, filters);
  const res = await safeFetch(`https://api.mangadex.org/manga?${q}`, {
    headers: HEADERS,
  });
  const json = await res.json();
  const src =
    lang === "id" ? "MangaDex (Bahasa Indonesia)" : "MangaDex (JSON API)";
  return (json.data || []).map((m) => {
    const cover = m.relationships?.find((r) => r.type === "cover_art");
    const fileName = cover?.attributes?.fileName;
    const titles = m.attributes?.title || {};
    return {
      title: titles.en || Object.values(titles)[0] || "Unknown",
      url: m.id,
      image: fileName
        ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
        : "",
      source: src,
    };
  });
}

async function mdSearch(lang, query, filters = {}) {
  const q = await buildMangaDexQuery(lang, 1, filters, query);
  const res = await safeFetch(
    `https://api.mangadex.org/manga?${q}`,
    { headers: HEADERS },
  );
  const json = await res.json();
  const src =
    lang === "id" ? "MangaDex (Bahasa Indonesia)" : "MangaDex (JSON API)";
  return (json.data || []).map((m) => {
    const cover = m.relationships?.find((r) => r.type === "cover_art");
    const fileName = cover?.attributes?.fileName;
    const titles = m.attributes?.title || {};
    return {
      title: titles.en || Object.values(titles)[0] || "Unknown",
      url: m.id,
      image: fileName
        ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
        : "",
      source: src,
    };
  });
}

async function mdFetchChapterFeed(id, translatedLanguage) {
  const chapters = [];
  let offset = 0;
  const pageSize = 500;
  const maxPages = 20; // safety: max 10000 entries per language

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    params.set("translatedLanguage[]", translatedLanguage);
    params.set("order[chapter]", "desc");

    const res = await safeFetch(
      `https://api.mangadex.org/manga/${id}/feed?${params.toString()}`,
      { headers: HEADERS },
    );
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    chapters.push(...data);

    const total = Number(json.total) || chapters.length;
    if (chapters.length >= total || data.length < pageSize) break;
    offset += pageSize;
  }

  return chapters;
}

function mdChapterKey(chapter) {
  const attrs = chapter?.attributes || {};
  const chapterNo = String(attrs.chapter || "").trim();
  const volume = String(attrs.volume || "").trim();
  return chapterNo ? `${volume}|${chapterNo}` : chapter?.id || "";
}

function mdChapterNumber(chapter) {
  const raw = String(chapter?.attributes?.chapter || "").trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function mdChapterDate(chapter) {
  const attrs = chapter?.attributes || {};
  const value = attrs.readableAt || attrs.publishAt || attrs.updatedAt || attrs.createdAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function mdIsReadableChapter(chapter) {
  const attrs = chapter?.attributes || {};
  return !attrs.externalUrl && Number(attrs.pages || 0) > 0;
}

function mdChooseBetterChapter(current, candidate, languagePriority) {
  if (!current) return candidate;

  const currentReadable = mdIsReadableChapter(current) ? 1 : 0;
  const candidateReadable = mdIsReadableChapter(candidate) ? 1 : 0;
  if (candidateReadable !== currentReadable) {
    return candidateReadable > currentReadable ? candidate : current;
  }

  const currentLang = current?.attributes?.translatedLanguage || "";
  const candidateLang = candidate?.attributes?.translatedLanguage || "";
  const currentRank = languagePriority.indexOf(currentLang);
  const candidateRank = languagePriority.indexOf(candidateLang);
  const normalizedCurrentRank = currentRank === -1 ? languagePriority.length : currentRank;
  const normalizedCandidateRank = candidateRank === -1 ? languagePriority.length : candidateRank;
  if (normalizedCandidateRank !== normalizedCurrentRank) {
    return normalizedCandidateRank < normalizedCurrentRank ? candidate : current;
  }

  const currentPages = Number(current?.attributes?.pages || 0);
  const candidatePages = Number(candidate?.attributes?.pages || 0);
  if (candidatePages !== currentPages) {
    return candidatePages > currentPages ? candidate : current;
  }

  return mdChapterDate(candidate) > mdChapterDate(current) ? candidate : current;
}

function mdUniqueReadableChapters(chapters, languagePriority) {
  const byChapter = new Map();
  chapters.forEach((chapter) => {
    const key = mdChapterKey(chapter);
    if (!key) return;
    byChapter.set(
      key,
      mdChooseBetterChapter(byChapter.get(key), chapter, languagePriority),
    );
  });

  return [...byChapter.values()]
    .filter(mdIsReadableChapter)
    .sort((a, b) => {
      const chapterDiff = mdChapterNumber(b) - mdChapterNumber(a);
      if (chapterDiff !== 0) return chapterDiff;
      const volumeDiff =
        Number.parseFloat(b?.attributes?.volume || "0") -
        Number.parseFloat(a?.attributes?.volume || "0");
      if (Number.isFinite(volumeDiff) && volumeDiff !== 0) return volumeDiff;
      return mdChapterDate(b) - mdChapterDate(a);
    });
}

function mdChapterName(chapter, preferredLanguage) {
  const attrs = chapter?.attributes || {};
  const chapterNo = attrs.chapter || "?";
  const title = typeof attrs.title === "string" ? attrs.title.trim() : "";
  const lang = attrs.translatedLanguage || "";
  const fallbackSuffix = lang && lang !== preferredLanguage ? ` (${lang.toUpperCase()})` : "";
  const base = `Ch. ${chapterNo}`;
  return title ? `${base}: ${title}${fallbackSuffix}` : `${base}${fallbackSuffix}`;
}

async function mdDetails(lang, id) {
  const res = await safeFetch(
    `https://api.mangadex.org/manga/${id}?includes[]=cover_art`,
    { headers: HEADERS },
  );
  const json = await res.json();
  const m = json?.data;
  if (!m) throw new Error("MangaDex manga not found");
  const preferredLanguage = lang === "id" ? "id" : "en";
  const languagePriority = lang === "id" ? ["id", "en"] : ["en"];
  const languageChapters = await Promise.all(
    languagePriority.map((language) => mdFetchChapterFeed(id, language)),
  );
  const allChapters = mdUniqueReadableChapters(
    languageChapters.flat(),
    languagePriority,
  );
  const cover = m.relationships?.find((r) => r.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  const titles = m.attributes?.title || {};
  return {
    title: titles.en || Object.values(titles)[0] || "Unknown",
    image: fileName
      ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg`
      : "",
    description:
      m.attributes?.description?.en ||
      m.attributes?.description?.id ||
      "No description",
    chapters: allChapters.map((c) => ({
      name: mdChapterName(c, preferredLanguage),
      url: c.id,
    })),
  };
}

async function mdImages(chapterId) {
  const res = await safeFetch(
    `https://api.mangadex.org/at-home/server/${chapterId}`,
    { headers: HEADERS },
  );
  const json = await res.json();
  if (!json?.chapter?.hash || !json?.baseUrl) {
    throw new Error("MangaDex chapter image server unavailable");
  }
  const hash = json.chapter.hash;
  return (json.chapter.data || []).map(
    (img) => `${json.baseUrl}/data/${hash}/${img}`,
  );
}

// --- Bato.to (Indonesian catalog) ---
async function batoLatest(page = 1) {
  const path = page > 1 ? `/updated?page=${page}` : "/updated";
  const { html, base } = await batoTryDomains(path);
  return batoFilterReadableResults(batoParseBrowse(html, "Bato.to (ID)", base), base);
}

async function batoSearch(query) {
  const { html, base } = await batoTryDomains(
    `/?s=${encodeURIComponent(query)}`,
  );
  return batoFilterReadableResults(batoParseBrowse(html, "Bato.to (ID)", base), base);
}

function batoParseBrowse(html, sourceKey, baseForAbs) {
  const $ = loadHtml(html);
  const results = [];
  const seen = new Set();

  const posterImages = new Map();
  $('a[href*="/manga/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const fullUrl = absUrl(baseForAbs, href);
    if (!fullUrl || posterImages.has(fullUrl)) return;

    const image = firstUsableCoverImage($, el, baseForAbs);
    if (image) {
      posterImages.set(fullUrl, image);
    }
  });

  $('a[href*="/manga/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    if (href && text.length > 3 && text.length < 100 && !href.includes("#")) {
      const fullUrl = absUrl(baseForAbs, href);
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      const $parent = $(el).closest(".info, .item, div");
      const image =
        firstUsableCoverImage($, $parent, baseForAbs) ||
        firstUsableCoverImage($, el, baseForAbs) ||
        posterImages.get(fullUrl) ||
        "";
      results.push({
        title: text,
        image: absUrl(baseForAbs, image),
        url: fullUrl,
        source: sourceKey,
      });
    }
  });
  return results;
}

function batoSlugFromUrl(value) {
  const match = String(value || "").match(/\/manga\/([^/?#]+)/);
  return match ? match[1] : "";
}

function batoApiChaptersToItems(base, slug, chapters = []) {
  return chapters
    .map((chapter) => ({
      name: chapter.chapter_name || `Chapter ${chapter.chapter_num || ""}`,
      url: chapter.chapter_slug ? `${base}/read/${slug}/${chapter.chapter_slug}` : "",
    }))
    .filter((chapter) => chapter.url);
}

async function batoFetchChapterList(base, slug) {
  if (!slug) return [];
  const chRes = await safeFetch(
    `${base}/get-chapter-list?slug=${encodeURIComponent(slug)}`,
    { headers: { ...HEADERS, "X-Requested-With": "XMLHttpRequest" } },
  );
  if (!chRes.ok) return [];
  const chJson = await chRes.json();
  const chArr = Array.isArray(chJson) ? chJson : chJson.data || [];
  return batoApiChaptersToItems(base, slug, chArr);
}

async function batoFilterReadableResults(items = [], base, desired = 30) {
  const candidates = items.slice(0, Math.max(desired * 2, 40));
  const valid = [];
  const batchSize = 6;

  for (let i = 0; i < candidates.length && valid.length < desired; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const checked = await Promise.allSettled(
      batch.map(async (item) => {
        const slug = batoSlugFromUrl(item?.url);
        const chapters = await batoFetchChapterList(base, slug);
        return chapters.length > 0 ? item : null;
      }),
    );
    checked.forEach((result) => {
      if (result.status === "fulfilled" && result.value && valid.length < desired) {
        valid.push(result.value);
      }
    });
  }

  return valid;
}

async function batoDetails(pageUrl) {
  const { html, base } = await batoTryDomains(pageUrl);
  const $ = loadHtml(html);
  const title = $("h1").first().text().trim();
  const metaImage = $('meta[property="og:image"]').attr("content") || "";
  const image =
    firstUsableCoverImage($, $(".poster, .manga-detail, main, body").first(), base) ||
    (isLikelyNonCoverImage(metaImage) ? "" : metaImage);
  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  const slug = batoSlugFromUrl(pageUrl);
  let chapters = [];

  // Use the full chapter list API
  if (slug) {
    try {
      chapters = await batoFetchChapterList(base, slug);
    } catch {}
  }

  // Fallback: parse from initial page HTML
  if (chapters.length === 0) {
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (
        href.includes("/read/") &&
        href.includes("chapter") &&
        text.length > 2
      ) {
        chapters.push({ name: text, url: absUrl(base, href) });
      }
    });
  }

  return {
    title,
    image: absUrl(base, image),
    description,
    chapters,
  };
}

async function batoImages(chapterUrl) {
  const { html } = await batoTryDomains(chapterUrl);
  const $ = loadHtml(html);
  const images = [];
  $("img").each((_, el) => {
    const u = imgAttr($, el);
    if (
      u &&
      (u.includes("cdn") || u.includes("manga") || u.includes("chapter")) &&
      !u.includes("avatar") &&
      !u.includes("icon") &&
      !u.includes("logo") &&
      !u.includes("banner") &&
      !u.includes("default")
    ) {
      if (!images.includes(u)) images.push(u);
    }
  });
  if (images.length > 0) {
    return normalizeChapterImages(images, chapterUrl);
  }
  // Fallback: regex on HTML
  const imgRegex =
    /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp|gif)(\?[^"'\s]*)?/gi;
  const matches = html.match(imgRegex);
  if (matches) {
    return normalizeChapterImages(matches, chapterUrl);
  }
  return [];
}

// --- ManhwaRead ---
const MANHWAREAD_DOMAINS = ["https://manhwaread.com"];

async function manhwareadTryDomains(path) {
  let lastErr = "Unknown error";
  for (const domain of MANHWAREAD_DOMAINS) {
    try {
      const url = path.startsWith("http") ? path : `${domain}${path}`;
      const res = await safeFetch(url, { headers: HEADERS });
      if (res.ok) return { html: await res.text(), base: domain };
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message || e;
    }
  }
  throw new Error(`ManhwaRead failed. Last error: ${lastErr}`);
}

async function manhwareadLatest(page = 1) {
  const path = page > 1 ? `/manhwa/page/${page}/` : "/manhwa/";
  const { html, base } = await manhwareadTryDomains(path);
  const $ = loadHtml(html);
  const results = [];
  $(".manga-item").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find("h3 a").first().text().trim() ||
      $el.find(".manga-item__link").first().text().trim() ||
      $el.find("img").first().attr("alt") || "";
    const href =
      $el.find("h3 a").first().attr("href") ||
      $el.find('a[href*="/manhwa/"]').first().attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && href)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, href),
        source: "ManhwaRead",
      });
  });
  return results;
}

async function manhwareadSearch(query) {
  const { html, base } = await manhwareadTryDomains(
    `/?s=${encodeURIComponent(query)}`,
  );
  const $ = loadHtml(html);
  const results = [];
  $(".manga-item").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find("h3 a").first().text().trim() ||
      $el.find(".manga-item__link").first().text().trim() ||
      $el.find("img").first().attr("alt") || "";
    const href =
      $el.find("h3 a").first().attr("href") ||
      $el.find('a[href*="/manhwa/"]').first().attr("href");
    const image = firstUsableCoverImage($, el, base);
    if (title && href)
      results.push({
        title,
        image: absUrl(base, image),
        url: absUrl(base, href),
        source: "ManhwaRead",
      });
  });
  return results;
}

async function manhwareadDetails(url) {
  const { html } = await manhwareadTryDomains(url);
  const $ = loadHtml(html);
  // Title: prefer h1 (skip site name), fallback to og:title cleaned
  let title = "";
  $("h1").each((_, el) => {
    const t = $(el).text().trim();
    if (t && t !== "ManhwaRead" && !title) title = t;
  });
  if (!title) {
    const ogTitle = $('meta[property="og:title"]').attr("content") || "";
    title = ogTitle.replace(/\s*-\s*#\d+\s*-\s*Read.*$/i, "").trim();
  }
  if (!title) title = $("title").text().trim();
  const metaImage = $('meta[property="og:image"]').attr("content") || "";
  const image = isLikelyNonCoverImage(metaImage) ? "" : metaImage;
  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";
  const chapters = [];
  const mangaBase = url.replace(/\/+$/, "");
  $("a.chapter-item").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const fullUrl = absUrl(url, href);
    // Only include chapters belonging to this manga (skip sidebar items)
    if (!fullUrl.startsWith(mangaBase + "/chapter")) return;
    // Extract clean chapter name — strip dates, "New" badges, time ago
    const rawText = $(el).text().replace(/\s+/g, " ").trim();
    const name = rawText
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b.*/g, "")
      .replace(/\s+New\b.*/gi, "")
      .replace(/\s+\d+[dwmy]\b.*/gi, "")
      .trim();
    if (name) chapters.push({ name, url: fullUrl });
  });
  return { title, image, description, chapters };
}

function decodeBase64Utf8(b64) {
  try {
    // atob is available in Hermes / modern RN
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    try {
      return CryptoJS.enc.Base64.parse(b64).toString(CryptoJS.enc.Utf8);
    } catch {
      return "[]";
    }
  }
}

async function manhwareadImages(chapterUrl) {
  const { html } = await manhwareadTryDomains(chapterUrl);
  const $ = loadHtml(html);

  // Extract chapterData from inline script
  let chapterDataRaw = null;
  $("script").each((_, el) => {
    const content = $(el).html() || "";
    const match = content.match(/var chapterData\s*=\s*(\{[^;]+\})/);
    if (match) {
      try {
        chapterDataRaw = JSON.parse(match[1]);
      } catch {}
    }
  });

  if (chapterDataRaw && chapterDataRaw.data) {
    try {
      const decoded = decodeBase64Utf8(chapterDataRaw.data);
      const pages = JSON.parse(decoded);
      const imgBase = (chapterDataRaw.base || "").replace(/\/+$/, "");
      if (Array.isArray(pages)) {
        return normalizeChapterImages(
          pages.map((p) => (p?.src ? `${imgBase}/${p.src}` : "")),
          chapterUrl,
        );
      }
    } catch {
      // Fall through to generic image extraction.
    }
  }

  // Fallback: standard image selectors
  return findChapterImages($, chapterUrl);
}

function dispatchLatest(source, page = 1, filters = {}) {
  if (source === ALL_ID_SOURCE) {
    return aggregateLatest(source, page, filters);
  }
  switch (source) {
    case "Komikindo":
      return komikindoLatest(page);
    case "BacaKomik":
      return bacakomikLatest(page, filters);
    case "Komik Station":
      return mtLatest(source, page, filters);
    case "Komiku":
      return komikuLatest(page);
    case "ManhwaRead":
      return manhwareadLatest(page);
    case "MangaDex (JSON API)":
      return mdLatest("en", page, filters);
    case "MangaDex (Bahasa Indonesia)":
      return mdLatest("id", page, filters);
    case "Bato.to (ID)":
      return batoLatest(page);
    default:
      return Promise.resolve([]);
  }
}

function dispatchSearch(source, query, filters = {}) {
  if (source === ALL_ID_SOURCE) {
    return aggregateSearch(source, query, filters);
  }
  return sourceSearch(source, query, filters);
}

function dispatchDetails(source, url) {
  switch (source) {
    case "Komikindo":
      return komikindoDetails(url);
    case "BacaKomik":
      return bacakomikDetails(url);
    case "Komik Station":
      return mtDetails(url);
    case "Komiku":
      return komikuDetails(url);
    case "ManhwaRead":
      return manhwareadDetails(url);
    case "MangaDex (JSON API)":
      return mdDetails("en", url);
    case "MangaDex (Bahasa Indonesia)":
      return mdDetails("id", url);
    case "Bato.to (ID)":
      return batoDetails(url);
    default:
      return Promise.resolve({
        title: "",
        image: "",
        description: "",
        chapters: [],
      });
  }
}

function dispatchImages(source, chapterUrl) {
  switch (source) {
    case "Komikindo":
      return komikindoImages(chapterUrl);
    case "BacaKomik":
      return bacakomikImages(chapterUrl);
    case "Komik Station":
      return mtImages(chapterUrl);
    case "Komiku":
      return komikuImages(chapterUrl);
    case "ManhwaRead":
      return manhwareadImages(chapterUrl);
    case "MangaDex (JSON API)":
    case "MangaDex (Bahasa Indonesia)":
      return mdImages(chapterUrl);
    case "Bato.to (ID)":
      return batoImages(chapterUrl);
    default:
      return Promise.resolve([]);
  }
}

export const Scraper = {
  fetchLatest: (source, page = 1, filters = {}) => dispatchLatest(source, page, filters),
  fetchSearch: (source, query, filters = {}) => dispatchSearch(source, query, filters),
  fetchDetails: (source, url) => dispatchDetails(source, url),
  fetchImages: async (source, chapterUrl) => {
    const imgs = await dispatchImages(source, chapterUrl);
    return Array.isArray(imgs)
      ? imgs.filter((img) => typeof img === 'string' && img.trim())
      : [];
  },
};
