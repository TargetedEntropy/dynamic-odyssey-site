#!/usr/bin/env node
// gen-site-data.js
// Regenerates the MODS and QUESTS data arrays in index.html directly from the
// Dynamic Odyssey pack metadata, and syncs the mod/quest/chapter counts and
// version everywhere they appear. This keeps the showcase in step with the pack
// instead of hand-editing two ~500-line arrays.
//
// Usage:
//   node gen-site-data.js [path-to-pack-repo]
//   DO2_PACK=/path/to/do2 node gen-site-data.js
// Default pack path: ../do2 (sibling checkout). Run from the site repo root.

const fs = require('fs');
const path = require('path');

const SITE_DIR = __dirname;
const PACK = path.resolve(SITE_DIR, process.argv[2] || process.env.DO2_PACK || '../do2');
const INDEX = path.join(SITE_DIR, 'index.html');

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }
if (!fs.existsSync(path.join(PACK, 'pack.toml'))) die(`pack.toml not found under ${PACK} (pass the pack path as an argument or set DO2_PACK)`);

const read = (p) => fs.readFileSync(p, 'utf8');
const jsStr = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ---------- version ----------
const version = (read(path.join(PACK, 'pack.toml')).match(/^version\s*=\s*"(.*)"/m) || [, '?'])[1];

// ---------- MODS ----------
// Strip trailing loader/platform bracket tags and a trailing parenthetical
// qualifier for display; keep the full name when cleaning would collide (e.g.
// Every Compat "Wood Good" vs "Stone Zone").
function cleanModName(name) {
  let n = name.trim();
  n = n.replace(/\s*\[[^\]]*(?:Forge|Fabric|Neo|Quilt)[^\]]*\]\s*$/, '');
  n = n.replace(/\s*\([^()]*\)\s*$/, '');
  return n.trim();
}

const modsDir = path.join(PACK, 'mods');
const rawMods = fs.readdirSync(modsDir).sort()
  .filter((f) => f.endsWith('.pw.toml'))
  .map((f) => read(path.join(modsDir, f)))
  .map((t) => ({
    name: (t.match(/^name\s*=\s*"(.*)"/m) || [, null])[1],
    side: (t.match(/^side\s*=\s*"(\w+)"/m) || [, 'both'])[1],
  }))
  .filter((m) => m.name);

const cleanCount = {};
for (const m of rawMods) { const c = cleanModName(m.name); cleanCount[c] = (cleanCount[c] || 0) + 1; }

const mods = rawMods
  .map((m) => {
    const clean = cleanModName(m.name);
    const disp = cleanCount[clean] > 1 ? m.name.trim() : clean; // keep full name when ambiguous
    return { name: disp, side: m.side };
  })
  .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

const modsArray =
  'const MODS = [\n' +
  mods.map((m) => `  { name: "${jsStr(m.name)}", side: "${m.side}" },`).join('\n') +
  '\n];';

// ---------- QUESTS ----------
const groupTitles = {};
for (const m of read(path.join(PACK, 'config/ftbquests/quests/chapter_groups.snbt'))
  .matchAll(/id: "([A-F0-9]+)", title: "([^"]+)"/g)) groupTitles[m[1]] = m[2];

const CHAPTER_NAMES = {
  advanced_peripherals: 'Advanced Peripherals', applied_energistics_2: 'Applied Energistics 2',
  artifacts_and_relics: 'Artifacts & Relics', cheesed: 'Cheesed', create: 'Create',
  croptopia: 'Croptopia', deeper_and_darker: 'Deeper & Darker', fine_dining: 'Fine Dining',
  getting_started: 'Getting Started', margaritaville: 'Margaritaville', mekanism: 'Mekanism',
  minecolonies: 'MineColonies', mob_heads_n_spawn_eggs: 'Mob Heads & Spawn Eggs',
  modern_industrialization: 'Modern Industrialization', music_discs: 'Music Discs',
  oktoberfest: 'Oktoberfest', powah: 'Powah', saplings: 'Saplings',
  spawner_manipulation: 'Spawner Manipulation', spectrum: 'Spectrum', spectrum_2: 'Spectrum 2',
  spectrum_3: 'Spectrum 3', toms: "Tom's Simple Storage", trinkets: 'Trinkets',
  vines_and_wines: 'Vines & Wines',
};
const GROUP_COLOR = {
  Technology: '#e17055', Storage: '#a29bfe', "Let's Do": '#fdcb6e', Collectables: '#fd79a8',
  Magic: '#6c5ce7', Colony: '#00b894', 'Quick Guides': '#74b9ff', Guides: '#74b9ff',
};
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const chapDir = path.join(PACK, 'config/ftbquests/quests/chapters');
const quests = fs.readdirSync(chapDir).sort()
  .filter((f) => f.endsWith('.snbt'))
  .map((f) => {
    const t = read(path.join(chapDir, f));
    const fn = (t.match(/filename: "([^"]+)"/) || [, f.replace('.snbt', '')])[1];
    const gid = (t.match(/group: "([A-F0-9]*)"/) || [, ''])[1];
    const count = (t.match(/^\t\t\tid: "/gm) || []).length; // quest-level ids are 3-tab indented
    const group = groupTitles[gid] || 'Guides';
    return { name: CHAPTER_NAMES[fn] || titleCase(fn), count, group, color: GROUP_COLOR[group] || '#74b9ff' };
  })
  .filter((q) => q.count > 0) // skip empty chapters (e.g. red_bread_redemption)
  .sort((a, b) => b.count - a.count);

const questsArray =
  'const QUESTS = [\n' +
  quests.map((q) => `  { name: "${jsStr(q.name)}", count: ${q.count}, group: "${q.group}", color: "${q.color}" },`).join('\n') +
  '\n];';

// ---------- totals ----------
const modCount = mods.length;
const chapterCount = quests.length;
const questCount = quests.reduce((n, q) => n + q.count, 0);

// ---------- patch index.html ----------
let html = read(INDEX);
const before = html;

function replaceOne(re, val, label) {
  if (!re.test(html)) die(`could not find ${label} in index.html`);
  html = html.replace(re, val);
}
function heroStat(reLabel, value) {
  const re = new RegExp(`(data-count=")\\d+("[^>]*>0</div>\\s*<div class="hero-stat-label">${reLabel}</div>)`);
  replaceOne(re, `$1${value}$2`, `hero stat "${reLabel}"`);
}

replaceOne(/const MODS = \[[\s\S]*?\n\];/, modsArray, 'MODS array');
replaceOne(/const QUESTS = \[[\s\S]*?\n\];/, questsArray, 'QUESTS array');
heroStat('Mods', modCount);
heroStat('Quests', questCount);
heroStat('Quest Chapters', chapterCount);
html = html.replace(/All \d+ Mods/g, `All ${modCount} Mods`);
html = html.replace(/\b\d+ Mods\b/g, `${modCount} Mods`);
html = html.replace(/\b\d+ Quests\b/g, `${questCount} Quests`);
html = html.replace(/&bull; v\d+\.\d+\.\d+ &bull;/g, `&bull; v${version} &bull;`);
html = html.replace(/with \d+ mods, \d+ quests/g, `with ${modCount} mods, ${questCount} quests`);

if (html === before) { console.log('No changes (already in sync).'); }
else { fs.writeFileSync(INDEX, html); }

const sides = mods.reduce((a, m) => ((a[m.side] = (a[m.side] || 0) + 1), a), {});
console.log(`Pack v${version} @ ${PACK}`);
console.log(`  MODS:   ${modCount} (both:${sides.both || 0} client:${sides.client || 0} server:${sides.server || 0})`);
console.log(`  QUESTS: ${questCount} across ${chapterCount} chapters`);
console.log(`  index.html ${html === before ? 'unchanged' : 'updated'}.`);
