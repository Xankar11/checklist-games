// Builds the cleaned 250-game list for the redesign test build only.
// Removes re-releases, remakes, expansions and compilations, then backfills
// with the next clean games from the Metacritic score list.
//
// Run: node scripts/build-redesign-data.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

const ROOT = process.cwd();
const SOURCE_DATA = path.join(ROOT, 'data', 'games.js');
const OUT_DATA = path.join(ROOT, 'redesign', 'data', 'games.js');
const OUT_COVERS = path.join(ROOT, 'redesign', 'assets', 'covers');
const CACHE_ORIGINALS = path.join(ROOT, '.cache', 'covers-original');
const API = 'https://backend.metacritic.com/finder/metacritic/web';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COVER_W = 340;
const COVER_H = 465;
const TARGET = 250;

// slug to remove -> slug of the version we keep
const REMOVE = {
  'the-legend-of-zelda-breath-of-the-wild-nintendo': 'the-legend-of-zelda-breath-of-the-wild',
  'the-legend-of-zelda-tears-of-the-kingdom-nintendo': 'the-legend-of-zelda-tears-of-the-kingdom',
  'the-legend-of-zelda-ocarina-of-time-3d': 'the-legend-of-zelda-ocarina-of-time',
  'the-legend-of-zelda-ocarina-of-time-master-quest-2002': 'the-legend-of-zelda-ocarina-of-time',
  'the-last-of-us-remastered': 'the-last-of-us',
  'metroid-prime-remastered': 'metroid-prime',
  'metroid-prime-trilogy': 'metroid-prime',
  'the-witcher-3-wild-hunt-remastered': 'the-witcher-3-wild-hunt',
  'the-witcher-3-wild-hunt-blood-and-wine': 'the-witcher-3-wild-hunt',
  'divinity-original-sin-ii-definitive-edition': 'divinity-original-sin-ii',
  'persona-5': 'persona-5-royal',
  'grand-theft-auto-double-pack': 'grand-theft-auto-iii',
  'portal-companion-collection': 'portal-2',
  'the-legend-of-zelda-collectors-edition': 'the-legend-of-zelda-ocarina-of-time',
  'the-ico-and-shadow-of-the-colossus-collection': 'shadow-of-the-colossus',
  'resident-evil-4': 'resident-evil-4-2005',
};

// Next clean games after the original 250; all have Metascore 91.
const BACKFILL = [
  'planescape-torment',
  'gears-of-war-3',
  'neverwinter-nights',
  'no-one-lives-forever-2-a-spy-in-h-a-r-m-s-way',
  'castlevania-aria-of-sorrow',
  'legacy-of-kain-soul-reaver',
  'golden-sun',
  'disco-elysium',
  'world-soccer-winning-eleven-8-international',
  'the-legend-of-zelda-a-link-between-worlds',
  'castlevania-circle-of-the-moon',
  'donkey-kong-bananza',
  'satisfactory',
  'caves-of-qud',
  'dark-souls-ii',
  'crash-bandicoot-warped',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  return end > max * 0.55 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…';
}

function coverSource(item) {
  const image = item.image;
  if (!image?.bucketPath) return null;
  const bucket = image.bucketType === 'catalog' ? '/a/img/catalog' : '/a/img';
  return `www.metacritic.com${bucket}${image.bucketPath}`;
}

function proxiedCover(source) {
  return (
    'https://external-content.duckduckgo.com/iu/?u=' +
    encodeURIComponent('https://' + source) +
    '&f=1&nofb=1'
  );
}

function coverFile(slug) {
  const safe = String(slug || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${safe || 'game'}.webp`;
}

async function getJson(url, tries = 6) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === tries) throw error;
      await sleep(600 * attempt);
    }
  }
}

async function getBuffer(url, tries = 5) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === tries) throw error;
      await sleep(700 * attempt);
    }
  }
}

async function downloadCover(slug, source) {
  const filename = coverFile(slug);
  const dest = path.join(OUT_COVERS, filename);
  const original = path.join(CACHE_ORIGINALS, filename.replace(/\.webp$/, '.img'));

  const stat = await fs.stat(dest).catch(() => null);
  if (stat && stat.size >= 1500) return filename;

  let buf;
  try {
    buf = await fs.readFile(original);
  } catch {
    buf = await getBuffer(proxiedCover(source));
    await fs.mkdir(CACHE_ORIGINALS, { recursive: true });
    await fs.writeFile(original, buf);
  }

  await sharp(buf)
    .rotate()
    .resize(COVER_W, COVER_H, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toFile(dest);
  return filename;
}

async function main() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(await fs.readFile(SOURCE_DATA, 'utf8'), context);
  const sourceGames = context.window.GAMES;
  if (!Array.isArray(sourceGames) || sourceGames.length !== TARGET) {
    throw new Error('Expected 250 source games');
  }

  const sourceBySlug = new Map(sourceGames.map((game) => [game.slug, game]));
  for (const [slug, target] of Object.entries(REMOVE)) {
    if (!sourceBySlug.has(slug)) throw new Error(`Removal not found in source: ${slug}`);
    if (!sourceBySlug.has(target)) throw new Error(`Alias target not found in source: ${target}`);
  }

  const kept = sourceGames.filter((game) => !REMOVE[game.slug]);
  if (kept.length !== TARGET - Object.keys(REMOVE).length) {
    throw new Error(`Unexpected kept count: ${kept.length}`);
  }

  console.log(`Removed ${sourceGames.length - kept.length}; fetching backfill items…`);
  const json = await getJson(`${API}?mcoTypeId=13&limit=24&offset=264&sortBy=-metaScore`);
  const items = json?.data?.items;
  if (!Array.isArray(items)) throw new Error('Unexpected API response');

  const itemBySlug = new Map(items.map((item) => [String(item.slug), item]));
  const missing = BACKFILL.filter((slug) => !itemBySlug.has(slug));
  if (missing.length) throw new Error(`Backfill items missing: ${missing.join(', ')}`);

  await fs.mkdir(OUT_COVERS, { recursive: true });
  const backfill = [];

  for (const slug of BACKFILL) {
    const item = itemBySlug.get(slug);
    const source = coverSource(item);
    let cover = null;
    if (source) {
      try {
        const filename = await downloadCover(slug, source);
        cover = `assets/covers/${filename}`;
        console.log(`  cover ${filename}`);
      } catch (error) {
        console.warn(`  cover failed: ${slug} — ${error.message}`);
      }
    }

    backfill.push({
      title: cleanTitle(item.title),
      slug,
      year: Number(item.premiereYear) || null,
      releaseDate: item.releaseDate || null,
      score: Number(item.criticScoreSummary?.score) || null,
      reviews: Number(item.criticScoreSummary?.reviewCount) || null,
      userScore: item.userScore?.score != null ? Number(item.userScore.score) : null,
      genres: [...new Set((item.genres || []).map((g) => String(g?.name || '').trim()).filter(Boolean))],
      platforms: [...new Set((item.platforms || []).map((p) => String(p?.name || '').trim()).filter(Boolean))],
      description: cleanText(item.description),
      cover,
    });
    await sleep(150);
  }

  const withoutCover = backfill.filter((game) => !game.cover);
  if (withoutCover.length) {
    throw new Error(`No cover for: ${withoutCover.map((game) => game.title).join(', ')}`);
  }

  const games = [...kept, ...backfill].map((game, index) => ({
    rank: index + 1,
    title: game.title,
    slug: game.slug,
    year: game.year,
    releaseDate: game.releaseDate,
    score: game.score,
    reviews: game.reviews,
    userScore: game.userScore,
    genres: game.genres,
    platforms: game.platforms,
    description: game.description,
    cover: game.cover,
  }));

  if (new Set(games.map((game) => game.slug)).size !== TARGET) {
    throw new Error('Duplicate slugs after merge');
  }

  const fetchedAt = new Date().toISOString();
  const meta = {
    source: 'Metacritic',
    metric: 'Metascore',
    fetchedAt,
    total: TARGET,
    cleaned: true,
    removedCount: Object.keys(REMOVE).length,
    backfilledCount: BACKFILL.length,
    note: 'Без переизданий, ремейков, DLC и сборников.',
  };

  const body =
    '/* Generated by scripts/build-redesign-data.mjs — cleaned Metacritic top 250 */\n' +
    `window.DATA_META = ${JSON.stringify(meta, null, 2)};\n` +
    `window.GAME_ALIASES = ${JSON.stringify(REMOVE, null, 2)};\n` +
    `window.GAMES = ${JSON.stringify(games, null, 2)};\n`;

  await fs.writeFile(OUT_DATA, body, 'utf8');

  // Remove covers that no longer belong to the cleaned list.
  const keepCovers = new Set(games.map((game) => path.basename(game.cover)));
  let removedCovers = 0;
  for (const entry of await fs.readdir(OUT_COVERS)) {
    if (!entry.endsWith('.webp') || keepCovers.has(entry)) continue;
    await fs.unlink(path.join(OUT_COVERS, entry));
    removedCovers++;
  }

  console.log('\nDone.');
  console.log(`Games: ${games.length}`);
  console.log(`Removed entries: ${Object.keys(REMOVE).length}`);
  console.log(`Backfilled: ${backfill.length}`);
  console.log(`Covers: ${games.length - withoutCover.length}/${games.length}`);
  console.log(`Unused covers deleted: ${removedCovers}`);
  console.log('Backfill:', backfill.map((game) => game.title).join(' | '));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
