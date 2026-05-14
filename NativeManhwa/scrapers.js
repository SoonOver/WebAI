/*https://komiku.org/
 * Multi - source scraper: Bato.to, MangaDex, Komikindo - style WP, BacaKomik - style WP,
 * dan situs ber - tema MangaThemesia(banyak scanlator Indonesia memakai tema ini).
 * Domain scanlator sering berpindah; daftar di SOURCE_ORDER bisa disesuaikan.
 */
import cheerio from "cheerio-without-node-native";
import CryptoJS from "crypto-js";
import { debugLog } from "./debugLog";

export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

/** @typedef {{ key: string, engine: string, baseUrl?: string, mangaDir?: string, siteLang?: string, mdLang?: string }} SourceDef */

/** Urutan tab sumber; tambah/ubah entri MangaThemesia sesuai domain yang masih aktif. */
export const SOURCE_ORDER = [
  "Komikindo",
  "BacaKomik",
  "Komik Station",
  "ManhwaDesu",
  "Komiku",
  "MangaDex (JSON API)",
  "MangaDex (Bahasa Indonesia)",
  "Bato.to (ID)",
];

const BATO_DOMAINS = ["https://xbato.co.uk", "https://bato.to"];

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

async function safeFetch(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOptions = { ...options, signal: controller.signal };

  // Helper for actual fetch call with retry
  const fetchWithRetry = async (targetUrl, opts, maxRetries = 1) => {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const res = await fetch(targetUrl, opts);
        if (res.ok) return res;
        if (i === maxRetries) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (i === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000)); // wait before retry
      }
    }
  };

  try {
    const res = await fetchWithRetry(url, fetchOptions);
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);

    // List of robust proxies to try if direct fetch fails
    const proxies = [
      `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://thingproxy.freeboard.io/fetch/${url}`,
      `https://yacdn.org/proxy/${url}`,
    ];

    for (const proxyUrl of proxies) {
      const pController = new AbortController();
      const pId = setTimeout(() => pController.abort(), timeoutMs);
      try {
        const pRes = await fetch(proxyUrl, {
          ...options,
          signal: pController.signal,
        });
        clearTimeout(pId);
        if (pRes.ok) return pRes;
      } catch (pErr) {
        clearTimeout(pId);
      }
    }
    throw err;
  }
}

function absUrl(base, href) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function decodeBatoPass(code) {
  let c = String(code);
  c = c.split("!+[]").join("1");
  c = c.split("!![]").join("1");
  c = c.split("[]").join("0");
  c = c.replace(/^\+/, "").replace(/\(\+/g, "(").replace(/ /g, "");
  c = c.split("+((1+[+1]+(1+0)[1+1+1]+[1+1]+[+0])+0)[+1]+").join(".");
  c = c.split("]+[").join(" ");
  c = c.split("[").join("").split("]").join("");
  let res = "";
  for (const numPart of c.split(".")) {
    const parts = numPart.trim().split(/\s+/).filter(Boolean);
    for (const num of parts) {
      res += String((num.match(/1/g) || []).length);
    }
    res += ".";
  }
  return res.replace(/^\.+|\.+$/g, "").replace(/\.+$/, "");
}

function decryptBatoWord(encryptedB64, passphrase) {
  const decrypted = CryptoJS.AES.decrypt(encryptedB64, passphrase);
  const utf8 = decrypted.toString(CryptoJS.enc.Utf8);
  return utf8;
}

function extractJsonArrayAfter(html, constName) {
  const marker = `const ${constName} =`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  let i = idx + marker.length;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== "[") return null;
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        const slice = html.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractBatoScript(html) {
  const $ = cheerio.load(html);
  const scripts = $("script")
    .toArray()
    .map((el) => $(el).html() || "")
    .filter(
      (s) =>
        s.includes("imgHttps") &&
        s.includes("batoWord") &&
        s.includes("batoPass"),
    );
  return scripts[0] || null;
}

function imgAttr($, el) {
  const $el = $(el);
  return (
    $el.attr("data-src") ||
    $el.attr("data-lazy-src") ||
    $el.attr("data-original") ||
    $el.attr("data-original-src") ||
    $el.attr("data-cfsrc") ||
    $el.attr("src") ||
    ""
  ).trim();
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

  return [...new Set(images)].map((u) => absUrl(chapterUrl, u)).filter(u => u.startsWith('http'));
}

export function sourceShortLabel(sourceKey) {
  if (sourceKey === "MangaDex (JSON API)") return "MangaDex";
  if (sourceKey === "MangaDex (Bahasa Indonesia)") return "MD · ID";
  if (sourceKey === "Bato.to (ID)") return "Bato";
  if (sourceKey === "Komik Station") return "K.Station";
  if (sourceKey === "ManhwaDesu") return "M.Desu";
  if (sourceKey === "BacaKomik") return "Baca";
  if (sourceKey === "Komikindo") return "Komikindo";
  if (sourceKey === "Komiku") return "Komiku";
  return sourceKey.length > 14 ? `${sourceKey.slice(0, 12)}…` : sourceKey;
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

async function komikuLatest() {
  const { html, base } = await komikuTryDomains("/");
  const $ = cheerio.load(html);
  const results = [];
  $(".ls4, .ls4w, .bima, .ls2, .ls2j").each((_, el) => {
    const title = $(el).find("h3 a, h4 a, .kan a").first().text().trim();
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const imgEl = $(el).find("img").first();
    const image = imgEl.attr("data-src") || imgEl.attr("src");
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
  const $ = cheerio.load(html);
  const results = [];
  $(".bima").each((_, el) => {
    const title = $(el).find("h3 a, h4 a, .kan a").first().text().trim();
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const imgEl = $(el).find("img").first();
    const image = imgEl.attr("data-src") || imgEl.attr("src");
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
    const title = $(el).find("h3 a, h4 a, .kan a").first().text().trim();
    const url = $(el).find("h3 a, h4 a, .kan a, a").first().attr("href");
    const imgEl = $(el).find("img").first();
    const image = imgEl.attr("data-src") || imgEl.attr("src");
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
  const $ = cheerio.load(html);
  const title = $("#Judul h1").text().trim() || $("h1").first().text().trim();
  const imgEl = $(".ims img").first();
  const image = imgEl.attr("data-src") || imgEl.attr("src") || "";
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
  const $ = cheerio.load(html);
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
  const $ = cheerio.load(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const title =
      $(el).find(".tt h3 a").text().trim() ||
      $(el).find(".tt h4").text().trim();
    const url =
      $(el).find(".tt h3 a").attr("href") || $(el).find("a").attr("href");
    const image = $(el).find("img").attr("src");
    if (title && url)
      results.push({
        title,
        image,
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
  const $ = cheerio.load(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const title =
      $(el).find(".tt h3 a").text().trim() ||
      $(el).find(".tt h4").text().trim();
    const url =
      $(el).find(".tt h3 a").attr("href") || $(el).find("a").attr("href");
    const image = $(el).find("img").attr("src");
    if (title && url)
      results.push({
        title,
        image,
        url: absUrl(base, url),
        source: "Komikindo",
      });
  });
  return results;
}

async function komikindoDetails(url) {
  const { html } = await komikindoTryDomains(url);
  const $ = cheerio.load(html);
  const title = $(".entry-title").text().trim();
  const image = $(".thumb img").attr("src");
  const description = $('div[itemprop="description"]').text().trim();
  const chapters = [];
  $("#chapter_list li").each((_, el) => {
    const href = $(el).find(".lchx a").attr("href");
    const name = $(el).find(".lchx a").text().trim();
    if (href && name) chapters.push({ name, url: absUrl(url, href) });
  });
  return { title, image, description, chapters };
}

async function komikindoImages(chapterUrl) {
  const { html } = await komikindoTryDomains(chapterUrl);
  const $ = cheerio.load(html);
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

async function bacakomikLatest() {
  const { html, base } = await bacakomikTryDomains(
    "/daftar-komik/?order=update",
  );
  return parseBacakomikListing(html, base);
}

async function bacakomikSearch(query) {
  const { html, base } = await bacakomikTryDomains(
    `/daftar-komik/?title=${encodeURIComponent(query)}`,
  );
  return parseBacakomikListing(html, base);
}

function parseBacakomikListing(html, baseForAbs) {
  const $ = cheerio.load(html);
  const results = [];
  $(".animepost").each((_, el) => {
    const $el = $(el);
    const a = $el.find("div.animposx > a").first();
    const url = a.attr("href");
    const title = $el.find(".animposx .tt h4").text().trim();
    const $img = $el.find("div.limit img").first();
    const image =
      $img.attr("data-lazy-src") ||
      $img.attr("data-src") ||
      $img.attr("src") ||
      "";
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
  const $ = cheerio.load(html);
  const title =
    $("#breadcrumbs li:last-child span").text().trim() ||
    $(".entry-title").text().trim();
  const $thumb = $(".thumb > img").first();
  const image =
    $thumb.attr("data-src") ||
    $thumb.attr("data-lazy-src") ||
    $thumb.attr("src") ||
    "";
  const descEl = $("div.desc > .entry-content.entry-content-single");
  const description = descEl.length ? descEl.find("p").text().trim() : "";
  const chapters = [];
  $("#chapter_list li").each((_, el) => {
    const href = $(el).find(".lchx a").attr("href");
    const name = $(el).find(".lchx a").text().trim();
    if (href && name) chapters.push({ name, url: absUrl(url, href) });
  });
  return { title, image: absUrl(url, image), description, chapters };
}

async function bacakomikImages(chapterUrl) {
  const { html } = await bacakomikTryDomains(chapterUrl);
  const $ = cheerio.load(html);
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
  ManhwaDesu: [
    "https://manhwadesu.store",
    "https://manhwadesu.com",
    "https://manhwadesu.co",
    "https://manhwadesu.id",
  ],
};

const MT_SOURCE_DIRS = {
  "Komik Station": "manga",
  ManhwaDesu: "komik",
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

function mtBuildListUrl(baseUrl, mangaDir, page, order, title) {
  const b = baseUrl.replace(/\/$/, "");
  const dir = (mangaDir || "manga").replace(/^\/|\/$/g, "");
  const u = new URL(`${b}/${dir}/`);
  u.searchParams.set("page", String(page));
  if (title !== undefined && title !== null) u.searchParams.set("title", title);
  if (order) u.searchParams.set("order", order);
  return u.href;
}

async function mtLatest(sourceKey) {
  const domains = MT_SOURCE_DOMAINS[sourceKey] || [sourceKey];
  const mangaDir = MT_SOURCE_DIRS[sourceKey] || "manga";
  let lastErr = null;
  for (const domain of domains) {
    try {
      const url = mtBuildListUrl(domain, mangaDir, 1, "update", "");
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

async function mtSearch(sourceKey, query) {
  const domains = MT_SOURCE_DOMAINS[sourceKey] || [sourceKey];
  const mangaDir = MT_SOURCE_DIRS[sourceKey] || "manga";
  let lastErr = null;
  for (const domain of domains) {
    try {
      const url = mtBuildListUrl(domain, mangaDir, 1, "", query);
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
  const $ = cheerio.load(html);
  const sel = ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx";
  const results = [];
  $(sel).each((_, el) => {
    const $el = $(el);
    const a = $el.find("a").first();
    const href = a.attr("href");
    const title = (a.attr("title") || a.text() || "").trim();
    const $img = $el.find("img").first();
    const image = imgAttr($, $img) || $img.attr("src") || "";
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
  const $ = cheerio.load(html);
  const root = $(
    "div.bigcontent, div.animefull, div.main-info, div.postbody",
  ).first();
  const title =
    root
      .find("h1.entry-title, .ts-breadcrumb li:last-child span")
      .first()
      .text()
      .trim() || $("h1").first().text().trim();
  const image = imgAttr(
    $,
    root.find('.thumb img, .infomanga img, [itemprop="image"] img').first(),
  );
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
      $el.find(".lch a, .chapternum").text().trim() || $a.text().trim();
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
  const $ = cheerio.load(html);
  return findChapterImages($, chapterUrl);
}

// --- MangaDex ---
async function mdLatest(lang) {
  const q =
    lang === "id"
      ? "limit=20&availableTranslatedLanguage[]=id&includes[]=cover_art"
      : "limit=20&contentRating[]=safe&includes[]=cover_art";
  const res = await safeFetch(`https://api.mangadex.org/manga?${q}`, {
    headers: HEADERS,
  });
  const json = await res.json();
  const src =
    lang === "id" ? "MangaDex (Bahasa Indonesia)" : "MangaDex (JSON API)";
  return json.data.map((m) => {
    const cover = m.relationships.find((r) => r.type === "cover_art");
    const fileName = cover?.attributes?.fileName;
    return {
      title: m.attributes.title.en || Object.values(m.attributes.title)[0],
      url: m.id,
      image: `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`,
      source: src,
    };
  });
}

async function mdSearch(lang, query) {
  const tl = lang === "id" ? "&availableTranslatedLanguage[]=id" : "";
  const res = await safeFetch(
    `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=20&includes[]=cover_art${tl}`,
    { headers: HEADERS },
  );
  const json = await res.json();
  const src =
    lang === "id" ? "MangaDex (Bahasa Indonesia)" : "MangaDex (JSON API)";
  return json.data.map((m) => {
    const cover = m.relationships.find((r) => r.type === "cover_art");
    const fileName = cover?.attributes?.fileName;
    return {
      title: m.attributes.title.en || Object.values(m.attributes.title)[0],
      url: m.id,
      image: `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`,
      source: src,
    };
  });
}

async function mdDetails(lang, id) {
  const res = await safeFetch(
    `https://api.mangadex.org/manga/${id}?includes[]=cover_art`,
    { headers: HEADERS },
  );
  const m = (await res.json()).data;
  const tl = lang === "id" ? "id" : "en";
  const chRes = await safeFetch(
    `https://api.mangadex.org/manga/${id}/feed?limit=500&translatedLanguage[]=${tl}&order[chapter]=desc`,
    { headers: HEADERS },
  );
  const chJson = await chRes.json();
  const cover = m.relationships.find((r) => r.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  return {
    title: m.attributes.title.en || Object.values(m.attributes.title)[0],
    image: `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg`,
    description:
      m.attributes.description.en ||
      m.attributes.description.id ||
      "No description",
    chapters: chJson.data.map((c) => ({
      name: `Ch. ${c.attributes.chapter || "?"}`,
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
  const hash = json.chapter.hash;
  return json.chapter.data.map((img) => `${json.baseUrl}/data/${hash}/${img}`);
}

// --- Bato.to (Indonesian catalog) ---
async function batoLatest() {
  const { html, base } = await batoTryDomains(
    `/browse?langs=id&sort=update&page=1`,
  );
  return batoParseBrowse(html, "Bato.to (ID)", base);
}

async function batoSearch(query) {
  const { html, base } = await batoTryDomains(
    `/search?word=${encodeURIComponent(query)}&page=1`,
  );
  return batoParseBrowse(html, "Bato.to (ID)", base);
}

function batoParseBrowse(html, sourceKey, baseForAbs) {
  const $ = cheerio.load(html);
  const results = [];
  let cols = $("#series-list div.col").filter(
    (_, el) => $(el).find('[data-lang="id"]').length > 0,
  );
  if (!cols.length) cols = $("#series-list div.col");
  cols.each((_, el) => {
    const $el = $(el);
    const coverA = $el.find("a.item-cover").first();
    const titleA = $el.find("a.item-title").first();
    const href = coverA.attr("href") || titleA.attr("href");
    const title = titleA.text().trim();
    const img =
      coverA.find("img").attr("src") ||
      coverA.find("img").attr("data-src") ||
      "";
    if (title && href) {
      results.push({
        title,
        image: absUrl(baseForAbs, img),
        url: absUrl(baseForAbs, href),
        source: sourceKey,
      });
    }
  });
  return results;
}

async function batoDetails(pageUrl) {
  const { html } = await batoTryDomains(pageUrl);
  const $ = cheerio.load(html);
  const info = $("div#mainer div.container-fluid").first();
  const title = info.find("h3").first().text().trim();
  const image = $("div.attr-cover img").attr("src") || "";
  const description = info.find("div.limit-html").text().trim();
  const chapters = [];
  $("div.main div.p-2").each((_, el) => {
    const $el = $(el);
    const a = $el.find("a.chapt").first();
    const href = a.attr("href");
    const name = a.text().trim();
    if (href && name) chapters.push({ name, url: absUrl(pageUrl, href) });
  });
  return {
    title,
    image: absUrl(pageUrl, image),
    description,
    chapters,
  };
}

async function batoImages(chapterUrl) {
  const { html } = await batoTryDomains(chapterUrl);
  // #region agent log
  debugLog(
    "scrapers.js:batoImages",
    "after_fetch",
    {
      ok: res.ok,
      status: res.status,
      htmlLen: html.length,
      hasImgHttps: html.includes("imgHttps"),
      hasBatoWord: html.includes("batoWord"),
      hasJustAMoment: html.toLowerCase().includes("just a moment"),
    },
    "H5",
  );
  // #endregion
  const script = extractBatoScript(html);
  // #region agent log
  debugLog(
    "scrapers.js:batoImages",
    "script_extract",
    { scriptFound: !!script, scriptLen: script ? script.length : 0 },
    "H1",
  );
  // #endregion
  if (!script) {
    // Fallback: try to find image URLs directly in the HTML
    const $ = cheerio.load(html);
    const directImages = [];
    $("img").each((_, el) => {
      const u = imgAttr($, el);
      if (
        u &&
        (u.includes("bato") ||
          u.includes("chapter") ||
          u.includes("comic") ||
          u.includes("manga") ||
          u.includes("series"))
      ) {
        directImages.push(absUrl(chapterUrl, u));
      }
    });
    if (directImages.length > 0) return directImages;
    // Try regex fallback
    const imgRegex =
      /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp|gif)(\?[^"'\s]*)?/gi;
    const matches = html.match(imgRegex);
    if (matches) {
      return matches.filter(
        (u) =>
          !u.includes("avatar") && !u.includes("icon") && !u.includes("logo"),
      );
    }
    throw new Error("Bato chapter script missing and no fallback images found");
  }
  const imgHttps = extractJsonArrayAfter(script, "imgHttps");
  if (!imgHttps || !Array.isArray(imgHttps))
    throw new Error("imgHttps parse failed");

  let passExpr = "";
  const passIdx = script.indexOf("const batoPass =");
  if (passIdx !== -1) {
    const after = script.slice(passIdx + "const batoPass =".length);
    const semi = after.indexOf(";");
    passExpr = semi === -1 ? after.trim() : after.slice(0, semi).trim();
  }
  let wordQuoted = "";
  const wordIdx = script.indexOf("const batoWord =");
  if (wordIdx !== -1) {
    const after = script.slice(wordIdx + "const batoWord =".length);
    const semi = after.indexOf(";");
    wordQuoted = semi === -1 ? after.trim() : after.slice(0, semi).trim();
  }
  const batoWord = wordQuoted.replace(/^["']|["']$/g, "");
  let queryArgs = [];
  let decryptErr = "";
  try {
    const pass = decodeBatoPass(passExpr);
    const dec = decryptBatoWord(batoWord, pass);
    queryArgs = JSON.parse(dec);
  } catch (e) {
    decryptErr = String(e?.message || e).slice(0, 160);
    queryArgs = [];
  }
  // #region agent log
  debugLog(
    "scrapers.js:batoImages",
    "decrypt_state",
    {
      imgHttpsLen: imgHttps.length,
      passExprLen: passExpr.length,
      batoWordLen: batoWord.length,
      queryArgsLen: Array.isArray(queryArgs) ? queryArgs.length : -1,
      decryptErr: decryptErr || null,
    },
    "H2",
  );
  // #endregion
  // If decryption fails, still return the raw image URLs (they might work without query args)
  if (!Array.isArray(queryArgs) || queryArgs.length !== imgHttps.length) {
    return imgHttps.map((u) => String(u));
  }
  return imgHttps.map((u, i) => {
    const acc = queryArgs[i];
    return acc ? `${u}?${acc}` : String(u);
  });
}

function dispatchLatest(source) {
  switch (source) {
    case "Komikindo":
      return komikindoLatest();
    case "BacaKomik":
      return bacakomikLatest();
    case "Komik Station":
      return mtLatest(source);
    case "ManhwaDesu":
      return mtLatest(source);
    case "Komiku":
      return komikuLatest();
    case "MangaDex (JSON API)":
      return mdLatest("en");
    case "MangaDex (Bahasa Indonesia)":
      return mdLatest("id");
    case "Bato.to (ID)":
      return batoLatest();
    default:
      return Promise.resolve([]);
  }
}

function dispatchSearch(source, query) {
  switch (source) {
    case "Komikindo":
      return komikindoSearch(query);
    case "BacaKomik":
      return bacakomikSearch(query);
    case "Komik Station":
      return mtSearch(source, query);
    case "ManhwaDesu":
      return mtSearch(source, query);
    case "Komiku":
      return komikuSearch(query);
    case "MangaDex (JSON API)":
      return mdSearch("en", query);
    case "MangaDex (Bahasa Indonesia)":
      return mdSearch("id", query);
    case "Bato.to (ID)":
      return batoSearch(query);
    default:
      return Promise.resolve([]);
  }
}

function dispatchDetails(source, url) {
  switch (source) {
    case "Komikindo":
      return komikindoDetails(url);
    case "BacaKomik":
      return bacakomikDetails(url);
    case "Komik Station":
    case "ManhwaDesu":
      return mtDetails(url);
    case "Komiku":
      return komikuDetails(url);
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
    case "ManhwaDesu":
      return mtImages(chapterUrl);
    case "Komiku":
      return komikuImages(chapterUrl);
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
  fetchLatest: (source) => dispatchLatest(source),
  fetchSearch: (source, query) => dispatchSearch(source, query),
  fetchDetails: (source, url) => dispatchDetails(source, url),
  fetchImages: async (source, chapterUrl) => {
    // #region agent log
    debugLog(
      "scrapers.js:fetchImages",
      "enter",
      {
        source,
        chapterUrlPreview: String(chapterUrl).slice(0, 120),
        isHttp: String(chapterUrl).startsWith("http"),
      },
      "H3",
    );
    // #endregion
    try {
      const imgs = await dispatchImages(source, chapterUrl);
      const arr = imgs || [];
      // #region agent log
      debugLog(
        "scrapers.js:fetchImages",
        "exit_ok",
        {
          count: arr.length,
          firstPreview: arr[0] ? String(arr[0]).slice(0, 80) : null,
        },
        "H1",
      );
      // #endregion
      return arr;
    } catch (e) {
      // #region agent log
      debugLog(
        "scrapers.js:fetchImages",
        "exit_throw",
        { name: e?.name, message: String(e?.message || e).slice(0, 220) },
        "H2",
      );
      // #endregion
      throw e;
    }
  },
};
