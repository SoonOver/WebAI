/**
 * Multi-source scraper: Bato.to, MangaDex, Komikindo-style WP, BacaKomik-style WP,
 * dan situs ber-tema MangaThemesia (banyak scanlator Indonesia memakai tema ini).
 * Domain scanlator sering berpindah; daftar di SOURCE_ORDER bisa disesuaikan.
 */
import cheerio from 'cheerio-without-node-native';
import CryptoJS from 'crypto-js';
import { debugLog } from './debugLog';

export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/** @typedef {{ key: string, engine: string, baseUrl?: string, mangaDir?: string, siteLang?: string, mdLang?: string }} SourceDef */

/** Urutan tab sumber; tambah/ubah entri MangaThemesia sesuai domain yang masih aktif. */
export const SOURCE_ORDER = [
  'Komikindo',
  'BacaKomik',
  'Komik Station',
  'ManhwaDesu',
  'MangaDex (JSON API)',
  'MangaDex (Bahasa Indonesia)',
  'Bato.to (ID)',
];

const BATO_BASE = 'https://bato.to';

function absUrl(base, href) {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function decodeBatoPass(code) {
  let c = String(code);
  c = c.split('!+[]').join('1');
  c = c.split('!![]').join('1');
  c = c.split('[]').join('0');
  c = c.replace(/^\+/, '').replace(/\(\+/g, '(').replace(/ /g, '');
  c = c.split('+((1+[+1]+(1+0)[1+1+1]+[1+1]+[+0])+0)[+1]+').join('.');
  c = c.split(']+[').join(' ');
  c = c.split('[').join('').split(']').join('');
  let res = '';
  for (const numPart of c.split('.')) {
    const parts = numPart.trim().split(/\s+/).filter(Boolean);
    for (const num of parts) {
      res += String((num.match(/1/g) || []).length);
    }
    res += '.';
  }
  return res.replace(/^\.+|\.+$/g, '').replace(/\.+$/, '');
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
  if (html[i] !== '[') return null;
  let depth = 0;
  const start = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    if (ch === ']') {
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
  const scripts = $('script')
    .toArray()
    .map((el) => $(el).html() || '')
    .filter((s) => s.includes('imgHttps') && s.includes('batoWord') && s.includes('batoPass'));
  return scripts[0] || null;
}

function imgAttr($, el) {
  const $el = $(el);
  const raw =
    $el.attr('data-lazy-src') ||
    $el.attr('data-original-src') ||
    $el.attr('data-src') ||
    $el.attr('data-cfsrc') ||
    $el.attr('src') ||
    '';
  const t = String(raw).trim();
  if (!t || t.startsWith('data:')) return '';
  return t;
}

export function sourceShortLabel(sourceKey) {
  if (sourceKey === 'MangaDex (JSON API)') return 'MangaDex';
  if (sourceKey === 'MangaDex (Bahasa Indonesia)') return 'MD · ID';
  if (sourceKey === 'Bato.to (ID)') return 'Bato';
  if (sourceKey === 'Komik Station') return 'K.Station';
  if (sourceKey === 'ManhwaDesu') return 'M.Desu';
  if (sourceKey === 'BacaKomik') return 'Baca';
  if (sourceKey === 'Komikindo') return 'Komikindo';
  return sourceKey.length > 14 ? `${sourceKey.slice(0, 12)}…` : sourceKey;
}

// --- Komikindo (animepost + #chimg-auh) ---
async function komikindoLatest() {
  const res = await fetch('https://komikindo.ch/', { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('.animepost').each((_, el) => {
    const title = $(el).find('.tt h3 a').text().trim() || $(el).find('.tt h4').text().trim();
    const url = $(el).find('.tt h3 a').attr('href') || $(el).find('a').attr('href');
    const image = $(el).find('img').attr('src');
    if (title && url) results.push({ title, image, url, source: 'Komikindo' });
  });
  return results;
}

async function komikindoSearch(query) {
  const res = await fetch(`https://komikindo.ch/?s=${encodeURIComponent(query)}`, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('.animepost').each((_, el) => {
    const title = $(el).find('.tt h3 a').text().trim() || $(el).find('.tt h4').text().trim();
    const url = $(el).find('.tt h3 a').attr('href') || $(el).find('a').attr('href');
    const image = $(el).find('img').attr('src');
    if (title && url) results.push({ title, image, url, source: 'Komikindo' });
  });
  return results;
}

async function komikindoDetails(url) {
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $('.entry-title').text().trim();
  const image = $('.thumb img').attr('src');
  const description = $('div[itemprop="description"]').text().trim();
  const chapters = [];
  $('#chapter_list li').each((_, el) => {
    const href = $(el).find('.lchx a').attr('href');
    const name = $(el).find('.lchx a').text().trim();
    if (href && name) chapters.push({ name, url: absUrl('https://komikindo.ch', href) });
  });
  return { title, image, description, chapters };
}

async function komikindoImages(chapterUrl) {
  const res = await fetch(chapterUrl, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const images = [];
  $('#chimg-auh img').each((_, el) => {
    const s = $(el).attr('src');
    if (s) images.push(s);
  });
  return images;
}

// --- BacaKomik (animepost + reader onError / chapter imgs) ---
const BACA_BASE = 'https://bacakomik.my';

async function bacakomikLatest() {
  const res = await fetch(`${BACA_BASE}/daftar-komik/?order=update`, { headers: HEADERS });
  const html = await res.text();
  return parseBacakomikListing(html, `${BACA_BASE}/daftar-komik/?order=update`);
}

async function bacakomikSearch(query) {
  const res = await fetch(
    `${BACA_BASE}/daftar-komik/?title=${encodeURIComponent(query)}`,
    { headers: HEADERS }
  );
  const html = await res.text();
  return parseBacakomikListing(html, `${BACA_BASE}/daftar-komik/`);
}

function parseBacakomikListing(html, baseForAbs) {
  const $ = cheerio.load(html);
  const results = [];
  $('.animepost').each((_, el) => {
    const $el = $(el);
    const a = $el.find('div.animposx > a').first();
    const url = a.attr('href');
    const title = $el.find('.animposx .tt h4').text().trim();
    const $img = $el.find('div.limit img').first();
    const image =
      $img.attr('data-lazy-src') || $img.attr('data-src') || $img.attr('src') || '';
    if (title && url) {
      results.push({
        title,
        image: absUrl(baseForAbs, image),
        url: absUrl(BACA_BASE, url),
        source: 'BacaKomik',
      });
    }
  });
  return results;
}

async function bacakomikDetails(url) {
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $('#breadcrumbs li:last-child span').text().trim() || $('.entry-title').text().trim();
  const $thumb = $('.thumb > img').first();
  const image =
    $thumb.attr('data-src') || $thumb.attr('data-lazy-src') || $thumb.attr('src') || '';
  const descEl = $('div.desc > .entry-content.entry-content-single');
  const description = descEl.length ? descEl.find('p').text().trim() : '';
  const chapters = [];
  $('#chapter_list li').each((_, el) => {
    const href = $(el).find('.lchx a').attr('href');
    const name = $(el).find('.lchx a').text().trim();
    if (href && name) chapters.push({ name, url: absUrl(BACA_BASE, href) });
  });
  return { title, image: absUrl(BACA_BASE, image), description, chapters };
}

async function bacakomikImages(chapterUrl) {
  const res = await fetch(chapterUrl, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const images = [];
  $('div#chimg-auh img, div:has(> img[alt*="Chapter"]) img').each((_, el) => {
    const $el = $(el);
    let u = imgAttr($, el);
    if (!u) {
      const onErr = $el.attr('onerror') || $el.attr('onError') || '';
      const m = onErr.match(/src=['"]([^'"]+)['"]/);
      if (m) u = m[1];
    }
    if (u) images.push(absUrl(chapterUrl, u));
  });
  return images.filter(Boolean);
}

// --- MangaThemesia (reader #readerarea) ---
function mtBuildListUrl(baseUrl, mangaDir, page, order, title) {
  const b = baseUrl.replace(/\/$/, '');
  const dir = (mangaDir || 'manga').replace(/^\/|\/$/g, '');
  const u = new URL(`${b}/${dir}/`);
  u.searchParams.set('page', String(page));
  if (title !== undefined && title !== null) u.searchParams.set('title', title);
  if (order) u.searchParams.set('order', order);
  return u.href;
}

async function mtLatest(baseUrl, mangaDir, sourceKey) {
  const url = mtBuildListUrl(baseUrl, mangaDir, 1, 'update', '');
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  return mtParseListing(html, baseUrl, sourceKey);
}

async function mtSearch(baseUrl, mangaDir, sourceKey, query) {
  const url = mtBuildListUrl(baseUrl, mangaDir, 1, '', query);
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  return mtParseListing(html, baseUrl, sourceKey);
}

function mtParseListing(html, baseUrl, sourceKey) {
  const $ = cheerio.load(html);
  const sel = '.utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx';
  const results = [];
  $(sel).each((_, el) => {
    const $el = $(el);
    const a = $el.find('a').first();
    const href = a.attr('href');
    const title = (a.attr('title') || a.text() || '').trim();
    const $img = $el.find('img').first();
    const image = imgAttr($, $img) || $img.attr('src') || '';
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
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const root = $('div.bigcontent, div.animefull, div.main-info, div.postbody').first();
  const title =
    root.find('h1.entry-title, .ts-breadcrumb li:last-child span').first().text().trim() ||
    $('h1').first().text().trim();
  const image = imgAttr($, root.find('.thumb img, .infomanga img, [itemprop="image"] img').first());
  const description = root.find('.desc, .entry-content[itemprop=description]').text().trim();
  const chapters = [];
  const chSel = 'div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)';
  $(chSel).each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a').first();
    const href = $a.attr('href');
    const name = ($el.find('.lch a, .chapternum').text().trim() || $a.text().trim());
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
  const res = await fetch(chapterUrl, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const images = [];
  $('div#readerarea img')
    .filter((_, el) => {
      const name = (el.tagName || '').toLowerCase();
      if (name === 'noscript') return false;
      return true;
    })
    .each((_, el) => {
      const u = imgAttr($, el);
      if (u) images.push(absUrl(chapterUrl, u));
    });
  if (images.length > 0) return images;
  const m = html.match(/"images"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr)) return arr.map((u) => absUrl(chapterUrl, String(u)));
    } catch {
      /* ignore */
    }
  }
  return [];
}

// --- MangaDex ---
async function mdLatest(lang) {
  const q =
    lang === 'id'
      ? 'limit=20&availableTranslatedLanguage[]=id&includes[]=cover_art'
      : 'limit=20&contentRating[]=safe&includes[]=cover_art';
  const res = await fetch(`https://api.mangadex.org/manga?${q}`, { headers: HEADERS });
  const json = await res.json();
  const src = lang === 'id' ? 'MangaDex (Bahasa Indonesia)' : 'MangaDex (JSON API)';
  return json.data.map((m) => {
    const cover = m.relationships.find((r) => r.type === 'cover_art');
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
  const tl = lang === 'id' ? '&availableTranslatedLanguage[]=id' : '';
  const res = await fetch(
    `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=20&includes[]=cover_art${tl}`,
    { headers: HEADERS }
  );
  const json = await res.json();
  const src = lang === 'id' ? 'MangaDex (Bahasa Indonesia)' : 'MangaDex (JSON API)';
  return json.data.map((m) => {
    const cover = m.relationships.find((r) => r.type === 'cover_art');
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
  const res = await fetch(`https://api.mangadex.org/manga/${id}?includes[]=cover_art`, { headers: HEADERS });
  const m = (await res.json()).data;
  const tl = lang === 'id' ? 'id' : 'en';
  const chRes = await fetch(
    `https://api.mangadex.org/manga/${id}/feed?limit=500&translatedLanguage[]=${tl}&order[chapter]=desc`,
    { headers: HEADERS }
  );
  const chJson = await chRes.json();
  const cover = m.relationships.find((r) => r.type === 'cover_art');
  const fileName = cover?.attributes?.fileName;
  return {
    title: m.attributes.title.en || Object.values(m.attributes.title)[0],
    image: `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg`,
    description: m.attributes.description.en || m.attributes.description.id || 'No description',
    chapters: chJson.data.map((c) => ({
      name: `Ch. ${c.attributes.chapter || '?'}`,
      url: c.id,
    })),
  };
}

async function mdImages(chapterId) {
  const res = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}`, { headers: HEADERS });
  const json = await res.json();
  const hash = json.chapter.hash;
  return json.chapter.data.map((img) => `${json.baseUrl}/data/${hash}/${img}`);
}

// --- Bato.to (Indonesian catalog) ---
async function batoLatest() {
  const url = `${BATO_BASE}/browse?langs=id&sort=update&page=1`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  return batoParseBrowse(html, 'Bato.to (ID)');
}

async function batoSearch(query) {
  const u = `${BATO_BASE}/search?word=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(u, { headers: HEADERS });
  const html = await res.text();
  return batoParseBrowse(html, 'Bato.to (ID)');
}

function batoParseBrowse(html, sourceKey) {
  const $ = cheerio.load(html);
  const results = [];
  let cols = $('#series-list div.col').filter((_, el) => $(el).find('[data-lang="id"]').length > 0);
  if (!cols.length) cols = $('#series-list div.col');
  cols.each((_, el) => {
    const $el = $(el);
    const coverA = $el.find('a.item-cover').first();
    const titleA = $el.find('a.item-title').first();
    const href = coverA.attr('href') || titleA.attr('href');
    const title = titleA.text().trim();
    const img = coverA.find('img').attr('src') || coverA.find('img').attr('data-src') || '';
    if (title && href) {
      results.push({
        title,
        image: absUrl(BATO_BASE, img),
        url: absUrl(BATO_BASE, href),
        source: sourceKey,
      });
    }
  });
  return results;
}

async function batoDetails(pageUrl) {
  const res = await fetch(pageUrl, { headers: HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);
  const info = $('div#mainer div.container-fluid').first();
  const title = info.find('h3').first().text().trim();
  const image = $('div.attr-cover img').attr('src') || '';
  const description = info.find('div.limit-html').text().trim();
  const chapters = [];
  $('div.main div.p-2').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a.chapt').first();
    const href = a.attr('href');
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
  const res = await fetch(chapterUrl, { headers: HEADERS });
  const html = await res.text();
  // #region agent log
  debugLog(
    'scrapers.js:batoImages',
    'after_fetch',
    {
      ok: res.ok,
      status: res.status,
      htmlLen: html.length,
      hasImgHttps: html.includes('imgHttps'),
      hasBatoWord: html.includes('batoWord'),
      hasJustAMoment: html.toLowerCase().includes('just a moment'),
    },
    'H5'
  );
  // #endregion
  const script = extractBatoScript(html);
  // #region agent log
  debugLog(
    'scrapers.js:batoImages',
    'script_extract',
    { scriptFound: !!script, scriptLen: script ? script.length : 0 },
    'H1'
  );
  // #endregion
  if (!script) throw new Error('Bato chapter script missing');
  const imgHttps = extractJsonArrayAfter(script, 'imgHttps');
  if (!imgHttps || !Array.isArray(imgHttps)) throw new Error('imgHttps parse failed');

  let passExpr = '';
  const passIdx = script.indexOf('const batoPass =');
  if (passIdx !== -1) {
    const after = script.slice(passIdx + 'const batoPass ='.length);
    const semi = after.indexOf(';');
    passExpr = semi === -1 ? after.trim() : after.slice(0, semi).trim();
  }
  let wordQuoted = '';
  const wordIdx = script.indexOf('const batoWord =');
  if (wordIdx !== -1) {
    const after = script.slice(wordIdx + 'const batoWord ='.length);
    const semi = after.indexOf(';');
    wordQuoted = semi === -1 ? after.trim() : after.slice(0, semi).trim();
  }
  const batoWord = wordQuoted.replace(/^["']|["']$/g, '');
  let queryArgs = [];
  let decryptErr = '';
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
    'scrapers.js:batoImages',
    'decrypt_state',
    {
      imgHttpsLen: imgHttps.length,
      passExprLen: passExpr.length,
      batoWordLen: batoWord.length,
      queryArgsLen: Array.isArray(queryArgs) ? queryArgs.length : -1,
      decryptErr: decryptErr || null,
    },
    'H2'
  );
  // #endregion
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
    case 'Komikindo':
      return komikindoLatest();
    case 'BacaKomik':
      return bacakomikLatest();
    case 'Komik Station':
      return mtLatest('https://komikstation.org', 'manga', source);
    case 'ManhwaDesu':
      return mtLatest('https://manhwadesu.store', 'komik', source);
    case 'MangaDex (JSON API)':
      return mdLatest('en');
    case 'MangaDex (Bahasa Indonesia)':
      return mdLatest('id');
    case 'Bato.to (ID)':
      return batoLatest();
    default:
      return Promise.resolve([]);
  }
}

function dispatchSearch(source, query) {
  switch (source) {
    case 'Komikindo':
      return komikindoSearch(query);
    case 'BacaKomik':
      return bacakomikSearch(query);
    case 'Komik Station':
      return mtSearch('https://komikstation.org', 'manga', source, query);
    case 'ManhwaDesu':
      return mtSearch('https://manhwadesu.store', 'komik', source, query);
    case 'MangaDex (JSON API)':
      return mdSearch('en', query);
    case 'MangaDex (Bahasa Indonesia)':
      return mdSearch('id', query);
    case 'Bato.to (ID)':
      return batoSearch(query);
    default:
      return Promise.resolve([]);
  }
}

function dispatchDetails(source, url) {
  switch (source) {
    case 'Komikindo':
      return komikindoDetails(url);
    case 'BacaKomik':
      return bacakomikDetails(url);
    case 'Komik Station':
    case 'ManhwaDesu':
      return mtDetails(url);
    case 'MangaDex (JSON API)':
      return mdDetails('en', url);
    case 'MangaDex (Bahasa Indonesia)':
      return mdDetails('id', url);
    case 'Bato.to (ID)':
      return batoDetails(url);
    default:
      return Promise.resolve({ title: '', image: '', description: '', chapters: [] });
  }
}

function dispatchImages(source, chapterUrl) {
  switch (source) {
    case 'Komikindo':
      return komikindoImages(chapterUrl);
    case 'BacaKomik':
      return bacakomikImages(chapterUrl);
    case 'Komik Station':
    case 'ManhwaDesu':
      return mtImages(chapterUrl);
    case 'MangaDex (JSON API)':
    case 'MangaDex (Bahasa Indonesia)':
      return mdImages(chapterUrl);
    case 'Bato.to (ID)':
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
      'scrapers.js:fetchImages',
      'enter',
      {
        source,
        chapterUrlPreview: String(chapterUrl).slice(0, 120),
        isHttp: String(chapterUrl).startsWith('http'),
      },
      'H3'
    );
    // #endregion
    try {
      const imgs = await dispatchImages(source, chapterUrl);
      const arr = imgs || [];
      // #region agent log
      debugLog(
        'scrapers.js:fetchImages',
        'exit_ok',
        { count: arr.length, firstPreview: arr[0] ? String(arr[0]).slice(0, 80) : null },
        'H1'
      );
      // #endregion
      return arr;
    } catch (e) {
      // #region agent log
      debugLog(
        'scrapers.js:fetchImages',
        'exit_throw',
        { name: e?.name, message: String(e?.message || e).slice(0, 220) },
        'H2'
      );
      // #endregion
      throw e;
    }
  },
};
