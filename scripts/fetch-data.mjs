// Fetches the Metacritic all-time top 250 games (by Metascore) and cover art.
// Run: node scripts/fetch-data.mjs
// Re-running is safe: existing covers are skipped.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const OUT_DATA = path.join(ROOT, 'data');
const OUT_COVERS = path.join(ROOT, 'assets', 'covers');
const CACHE_PAGES = path.join(ROOT, '.cache', 'mc-pages');
const CACHE_ORIGINALS = path.join(ROOT, '.cache', 'covers-original');
const API = 'https://backend.metacritic.com/finder/metacritic/web';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const PAGE_SIZE = 24;
const TARGET = 250;
const COVER_W = 340;
const COVER_H = 465;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 6) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

async function getPage(page) {
  const file = path.join(CACHE_PAGES, `page-${String(page).padStart(2, '0')}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {}

  const url = `${API}?mcoTypeId=13&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&sortBy=-metaScore`;
  const json = await getJson(url);
  await fs.mkdir(CACHE_PAGES, { recursive: true });
  await fs.writeFile(file, JSON.stringify(json, null, 1));
  return json;
}

async function getBuffer(url, tries = 5) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(900 * attempt);
    }
  }
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/\s*\((19|20)\d{2}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(raw, max = 700) {
  const text = String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > max * 0.55 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…');
}

function coverSource(item) {
  const img = item.image;
  if (!img || !img.bucketPath) return null;
  const bucket = img.bucketType === 'catalog' ? '/a/img/catalog' : '/a/img';
  return `www.metacritic.com${bucket}${img.bucketPath}`;
}

function proxiedCover(source) {
  return (
    'https://external-content.duckduckgo.com/iu/?u=' +
    encodeURIComponent('https://' + source) +
    '&f=1&nofb=1'
  );
}

function slugFile(slug) {
  const safe = String(slug || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'game'}.webp`;
}

async function fetchTop() {
  const seen = new Set();
  const games = [];

  for (let page = 0; page < 14; page++) {
    const json = await getPage(page);
    const items = json?.data?.items;
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      const slug = String(item.slug || '').trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      games.push(item);
      if (games.length >= TARGET) break;
    }

    console.log(`page ${page + 1}: ${items.length} items, ${games.length} unique games`);
    if (games.length >= TARGET) break;
    await sleep(250);
  }

  return games.slice(0, TARGET);
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  await fs.mkdir(OUT_DATA, { recursive: true });
  await fs.mkdir(OUT_COVERS, { recursive: true });

  console.log('Fetching Metacritic top 250…');
  const items = await fetchTop();
  if (items.length < TARGET) {
    throw new Error(`Only collected ${items.length} games`);
  }

  const games = [];
  const covers = [];

  items.forEach((item, index) => {
    const rank = index + 1;
    const source = coverSource(item);
    const game = {
      rank,
      sourceRank: Number(item.rank) || null,
      title: cleanTitle(item.title),
      slug: String(item.slug),
      year: Number(item.premiereYear) || null,
      releaseDate: item.releaseDate || null,
      score: Number(item.criticScoreSummary?.score) || null,
      reviews: Number(item.criticScoreSummary?.reviewCount) || null,
      userScore: item.userScore?.score != null ? Number(item.userScore.score) : null,
      genres: [...new Set((item.genres || []).map((g) => String(g?.name || '').trim()).filter(Boolean))],
      platforms: [...new Set((item.platforms || []).map((p) => String(p?.name || '').trim()).filter(Boolean))],
      description: cleanText(item.description),
      cover: null,
      coverSource: source,
    };
    game.coverFile = source ? slugFile(game.slug) : null;
    if (source) covers.push(game);
    games.push(game);
  });

  console.log(`Downloading ${covers.length} covers via DuckDuckGo image proxy…`);
  let done = 0;
  let failed = 0;

  await mapPool(covers, 6, async (game) => {
    const dest = path.join(OUT_COVERS, game.coverFile);
    const original = path.join(CACHE_ORIGINALS, game.coverFile.replace(/\.webp$/, '.img'));
    try {
      const stat = await fs.stat(dest).catch(() => null);
      if (!stat || stat.size < 1500) {
        let buf;
        try {
          buf = await fs.readFile(original);
        } catch {
          buf = await getBuffer(proxiedCover(game.coverSource));
          await fs.mkdir(CACHE_ORIGINALS, { recursive: true });
          await fs.writeFile(original, buf);
        }
        await sharp(buf)
          .rotate()
          .resize(COVER_W, COVER_H, { fit: 'cover', position: 'centre' })
          .webp({ quality: 80 })
          .toFile(dest);
      }
      game.cover = `assets/covers/${game.coverFile}`;
    } catch (err) {
      failed++;
      game.cover = null;
      console.warn(`cover failed: ${game.title} — ${err.message}`);
    }
    done++;
    if (done % 25 === 0 || done === covers.length) {
      console.log(`  covers ${done}/${covers.length} (failed: ${failed})`);
    }
  });

  const withoutCover = games.filter((g) => !g.cover);
  const dupTitles = new Map();
  for (const g of games) {
    const key = g.title.toLowerCase();
    dupTitles.set(key, (dupTitles.get(key) || 0) + 1);
  }
  const duplicates = [...dupTitles.entries()].filter(([, n]) => n > 1);

  const payload = {
    source: 'Metacritic',
    metric: 'Metascore',
    fetchedAt: new Date().toISOString(),
    total: games.length,
    games: games.map((g) => ({
      rank: g.rank,
      title: g.title,
      slug: g.slug,
      year: g.year,
      releaseDate: g.releaseDate,
      score: g.score,
      reviews: g.reviews,
      userScore: g.userScore,
      genres: g.genres,
      platforms: g.platforms,
      description: g.description,
      cover: g.cover,
    })),
  };

  const body =
    '/* Generated by scripts/fetch-data.mjs — Metacritic top 250 by Metascore */\n' +
    `window.DATA_META = ${JSON.stringify(
      { source: payload.source, metric: payload.metric, fetchedAt: payload.fetchedAt, total: payload.total },
      null,
      2
    )};\n` +
    `window.GAMES = ${JSON.stringify(payload.games, null, 2)};\n`;

  await fs.writeFile(path.join(OUT_DATA, 'games.js'), body, 'utf8');

  console.log('\nDone.');
  console.log(`Games: ${games.length}`);
  console.log(`Years: ${Math.min(...games.map((g) => g.year || 9999))}–${Math.max(...games.map((g) => g.year || 0))}`);
  console.log(`Scores: ${Math.min(...games.map((g) => g.score || 999))}–${Math.max(...games.map((g) => g.score || 0))}`);
  console.log(`Covers: ${games.length - withoutCover.length}/${games.length}`);
  if (withoutCover.length) console.log('No cover:', withoutCover.map((g) => g.title).join(' | '));
  if (duplicates.length) console.log('Duplicate titles:', duplicates.map(([t, n]) => `${t} ×${n}`).join(' | '));
  console.log('Top 10:');
  for (const g of games.slice(0, 10)) console.log(`  #${g.rank} ${g.title} (${g.year}) — ${g.score}`);
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exitCode = 1;
});
