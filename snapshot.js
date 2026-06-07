#!/usr/bin/env node
/**
 * snapshot.js — WoW Midnight market price collector
 *
 * Self-contained. Zero npm dependencies. Pure Node.js built-ins + native fetch.
 * Writes price-snapshots.json in the same directory.
 *
 * Key format: "eu:ITEMID" — matches pricehistory.js in the MCP server.
 * ts format:  Unix ms (Date.now()) — matches pricehistory.js.
 *
 * Env vars required:
 *   BLIZZARD_CLIENT_ID
 *   BLIZZARD_CLIENT_SECRET
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const REGION      = 'eu';
// gzipped on disk — raw 60-day JSON is ~180MB (> GitHub 100MB limit); gzip → ~16MB.
const FILE        = join(__dirname, 'price-snapshots.json.gz');
const LEGACY_FILE = join(__dirname, 'price-snapshots.json'); // pre-gzip; read once for migration
const MAX_PER_KEY = 5760; // 15min × 24h × 60 days
const DEDUP_MS    = 10 * 60 * 1000; // skip if last snapshot < 10min ago

// Read DB from gzipped file (or legacy plain JSON during migration). Returns {} if neither exists.
function loadDb() {
  if (existsSync(FILE)) return JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8'));
  if (existsSync(LEGACY_FILE)) return JSON.parse(readFileSync(LEGACY_FILE, 'utf8'));
  return {};
}

// ── Tracked items — all viable Midnight flip candidates ────────────────────────
const TRACKED_IDS = [
  // Gems: Peridot
  240855, 240856, 240857, 240858, 240859, 240860, 240861, 240862,
  // Gems: Amethyst
  240863, 240864, 240865, 240866, 240867, 240868, 240869, 240870,
  // Gems: Garnet
  240871, 240872, 240873, 240874, 240875, 240876, 240877, 240878,
  // Gems: Lapis
  240879, 240880, 240881, 240882, 240883, 240884, 240885, 240886,
  // Flawless gems — Q1/Q2 pairs per color × stat variant
  // (what was labeled "Gem cuts" were actually Q2 flawless gems — fixed 2026-05-23)
  240887, 240888, // Quick Peridot Q1/Q2
  240889, 240890, // Deadly Peridot Q1/Q2
  240891, 240892, // Masterful Peridot Q1/Q2
  240893, 240894, // Versatile Peridot Q1/Q2
  240895, 240896, // Masterful Amethyst Q1/Q2
  240897, 240898, // Deadly Amethyst Q1/Q2
  240899, 240900, // Quick Amethyst Q1/Q2
  240901, 240902, // Versatile Amethyst Q1/Q2
  240903, 240904, // Deadly Garnet Q1/Q2
  240905, 240906, // Quick Garnet Q1/Q2
  240907, 240908, // Masterful Garnet Q1/Q2
  240909, 240910, // Versatile Garnet Q1/Q2
  240911, 240912, // Versatile Lapis Q1/Q2
  240913, 240914, // Deadly Lapis Q1/Q2
  240915, 240916, // Quick Lapis Q1/Q2
  240917, 240918, // Masterful Lapis Q1/Q2
  // Eversong Diamonds
  240966, 240967, 240968, 240969, 240970, 240971, 240982, 240983,
  // Heliotropes (R1=0.71g skip; 241142=Determined ~850g)
  241142, 241143, 241144,
  // Cloth / Spellthreads / Linings (240156=R1 5.7g skip, 240157=18g skip)
  240094, 240133, 240154, 240155, 240165, 240166,
  // Armor Kits + Void-Touched Drums (Bloodlust alt)
  244635, 244636, 244639, 244640, 244641, 244643, 244644, 244645,
  // Enchants (all slots, all tiers confirmed live)
  243946, 243947, 243951, 243952, 243953, 243956, 243957, 243958, 243959,
  243962, 243963, 243965, 243967, 243968, 243969, 243970, 243971,
  243972, 243973, 243974, 243975, 243977, 243980, 243981, 243982,
  243983, 243986, 243987, 243990, 243991, 243993, 243994, 243995,
  243997, 243999, 244001, 244002, 244003, 244006, 244007, 244008,
  244009, 244014, 244015, 244016, 244017, 244020, 244021, 244023,
  244024, 244025, 244026, 244027, 244028, 244029, 244030, 244031,
  244037,
  // Blacksmithing consumables (whetstones/razorstone — 124-315g)
  237369, 237370, 237371, 237372, 237373,
  // Weapon oils (R1 dump <25g skipped; 243736=Oil Of Dawn, 243738=Smuggler's Edge)
  243736, 243738,
  // Thalassian Phoenix Oil (weapon buff — 8/10 top specs; Q1/Q3, no Q2 exists)
  243733, 243734,
  // Contracts
  243821, 245794, 245796, 245797, 245798, 245799, 245800,
  // Thalassian Missives (Q1 + Q2)
  245818, 245819, 245820, 245821, 245822, 245823, 245824, 245825,
  245826, 245827,
  // Aces / Darkmoon Sigils (Q1 + Q2) + Hunt + Rot
  245830, 245847, 245871, 245872, 245873, 245874, 245875,
  245876, // Darkmoon Sigil: Hunt (~750g, 872 qty)
  245877, 245878, // Darkmoon Sigil: Rot Q3/Q2 (~2000g / ~1348g)
  // Phials (Q3 tracked; Q1 too cheap to flip)
  241310, 241312, 241316,
  // Flasks — all 4 types × Q3 + Q1
  241320, 241321, // Thalassian Resistance Q3/Q1
  241322, 241323, // Magisters Q3/Q1
  241324, 241325, // Blood Knights Q3/Q1
  241326, 241327, // Shattered Sun Q3/Q1
  // Combat potions (R1 neighbors all <30g, skipped)
  241286, // Light's Preservation (~271g)
  241288, // Potion of Recklessness Q3 — main DPS combat pot (42k qty)
  241292, // Draught of Rampant Abandon
  241294, // Potion of Devoured Dreams
  241296, // Potion of Zealotry (~501g)
  241298, // Amani Extract (~532g)
  241300, // Lightfused Mana Potion Q3
  241302, // Void-Shrouded Tincture (~250g)
  241304, // Silvermoon Health Potion Q3
  241334, // Vicious Thalassian Flask of Honor
  // Core crafting mat (high-volume, used in all alchemy)
  241308, // Light's Potential Q3
  // Feasts (individual stat foods <100g, skip)
  242272, // Quel'dorei Medley (~298g, 7k qty)
  242273, // Blooming Feast (~377g, 5k qty)
  255845, // Silvermoon Parade (~400g, 5k qty)
  255846, // Harandar Celebration (~264g, 69k qty)
  // Personal foods — recommended by multiple top specs; was missing from tracking
  242274, 242746, // Champion's Bento Q1 / Q2 (Hearty; no Q3 exists)
  242275, 242747, 255847, // Royal Roast Q1 / Q2 (Hearty) / Q3 (Impossibly)
  // Food / Drinks
  264982, 264995, 260270,
  // Raw crafting mats
  242606, 240973,
  // Rare herbs/ores (high price, not bot-farmed)
  236780, // Nocturnal Lotus (900g — rare bonus drop, used in premium crafting)
  // High-volume consumables
  260232, 248331, 262650,
  // Vantus Runes (raid boss buffs — spike on reset day)
  244149,
  245879, 245880, // Vantus Rune: Radiant Q1/Q2 (~215g / ~550g)
  // Augment Rune
  259085, // Void-Touched Augment Rune (870g, 14k qty)
  // Crafted gear mats
  248133,
  // Consumables / Crafted
  248137, 257746, 257748, 257750, 257752, 262799,
  // Battle Pets (commodity-traded)
  248135, 248592, 255843, 257735, 257741,
];

// ── Blizzard OAuth ─────────────────────────────────────────────────────────────
let _token = null;
let _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;

  const id     = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET');

  const res = await fetch('https://oauth.battle.net/token', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`OAuth failed ${res.status}: ${await res.text()}`);
  const d = await res.json();
  _token    = d.access_token;
  _tokenExp = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

// ── Blizzard commodity fetch ───────────────────────────────────────────────────
async function fetchCommodities() {
  const token = await getToken();
  const url   = `https://eu.api.blizzard.com/data/wow/auctions/commodities` +
                `?namespace=dynamic-eu&locale=en_US`;
  const res   = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent':    'wow-snapshot/1.0',
    },
  });
  if (!res.ok) throw new Error(`Commodity fetch failed ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json(); // { auctions: [{ item: { id }, quantity, unit_price }] }
}

// ── Parse commodity dump → per-item depth stats ────────────────────────────────
function parseDepth(raw, itemIds) {
  const byItem = {};
  for (const a of raw.auctions ?? []) {
    const id = a.item?.id;
    if (!id || !itemIds.has(id)) continue;
    if (!byItem[id]) byItem[id] = [];
    byItem[id].push({ qty: a.quantity, price: +(a.unit_price / 10000).toFixed(4) });
  }

  const result = {};
  for (const id of itemIds) {
    const listings = byItem[id];
    if (!listings?.length) { result[id] = { found: false }; continue; }

    listings.sort((a, b) => a.price - b.price);
    const minP           = listings[0].price;
    const floorListings  = listings.filter(l => l.price <= minP * 1.05);
    const depthAtMin     = floorListings.reduce((s, l) => s + l.qty, 0);
    const totalQty       = listings.reduce((s, l) => s + l.qty, 0);
    const nextTier       = listings.find(l => l.price > minP * 1.05 && l.price < 100_000);

    const weightedAvgGold = +(listings.reduce((s, l) => s + l.price * l.qty, 0) / totalQty).toFixed(4);

    result[id] = {
      found:            true,
      minPriceGold:     minP,
      weightedAvgGold,                           // volume-weighted avg — immune to 1-unit bot posts
      depthAtMinPrice:  depthAtMin,
      totalQuantity:    totalQty,
      listingsAtFloor:  floorListings.length,   // # postings at floor — 1 = whale risk
      totalListings:    listings.length,         // all postings across all prices
      nextTierGold:     nextTier?.price ?? null,
      priceGapPct:      nextTier ? +((nextTier.price / minP - 1) * 100).toFixed(1) : null,
    };
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const ts    = Date.now();
  const tsIso = new Date(ts).toISOString();
  console.log(`[snapshot] ${tsIso} — fetching ${TRACKED_IDS.length} items (${REGION} commodity)`);

  let raw;
  try {
    raw = await fetchCommodities();
  } catch (err) {
    console.error(`[snapshot] Fetch failed: ${err.message}`);
    process.exit(1);
  }

  const items  = parseDepth(raw, new Set(TRACKED_IDS));
  const db     = loadDb();

  let added   = 0;
  let missing = 0;

  for (const id of TRACKED_IDS) {
    const item = items[id];
    if (!item?.found) { missing++; continue; }

    const key  = `${REGION}:${id}`;   // "eu:240865" — matches pricehistory.js
    if (!db[key]) db[key] = [];

    // Deduplicate: skip if snapshot too recent
    const last = db[key].at(-1);
    if (last && ts - last.ts < DEDUP_MS) continue;

    db[key].push({
      ts,
      price:         item.minPriceGold,
      weightedAvg:   item.weightedAvgGold,
      depth:         item.depthAtMinPrice,
      total:         item.totalQuantity,
      listings:      item.listingsAtFloor,
      totalListings: item.totalListings,
      nextTier:      item.nextTierGold  ?? null,
      gap:           item.priceGapPct   ?? null,
    });

    // Cap history
    if (db[key].length > MAX_PER_KEY) db[key] = db[key].slice(-MAX_PER_KEY);
    added++;
  }

  writeFileSync(FILE, gzipSync(JSON.stringify(db))); // gzipped minified JSON — keeps 60d under 100MB

  const tracked = Object.keys(db).filter(k => k.startsWith(`${REGION}:`)).length;
  console.log(`[snapshot] Done. +${added} snapshots | ${missing} not listed | ${tracked} items tracked total`);
}

main().catch(err => { console.error(err); process.exit(1); });
