// Meta progression: save format, Essence perks, permanent unlocks, Ascension/Stars, gems and the
// wallet. Pure logic (storage is passed in), shared by the game and tools/balance.mjs.
import { PERKS, UNLOCKS, START_GOO, ESSENCE, ASCEND, STAR_SHOP, GEMS, COSMETICS, ESSENCE_PACKS, BIOMES } from "./config.js";

export const SAVE_VERSION = 2;

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    name: "",
    muted: false,
    runs: 0,
    essence: 0, essenceLifetime: 0, essenceSinceAscend: 0,
    perks: {},
    unlocks: {},
    stars: 0, starsEarned: 0, starLevels: {}, ascensions: 0,
    gems: 0, gemsLifetime: 0,
    owned: ["skin.teal", "eyes.round", "trail.echo", "eat.ripple"],
    equipped: { skin: "skin.teal", eyes: "eyes.round", trail: "trail.echo", eat: "eat.ripple" },
    milestones: {},
    bestNormal: null, bestFresh: null, splitsNormal: null, splitsFresh: null,
  };
}

// v1 (single perk list, old maps) → v2. Spent Essence on rebalanced perks is refunded; the old
// tracker/mini-map/radar perks become permanent unlocks. Old best times were on a different map.
const V1_PERK_BASE = { gooMult: 5, startSpeed: 6, startGoo: 4, headDash: 6, headSplit: 15, headMagnet: 8 };
export function migrate(raw) {
  const s = defaultSave();
  if (!raw || typeof raw !== "object") return s;
  if (raw.v === SAVE_VERSION) return { ...s, ...raw, perks: { ...raw.perks }, unlocks: { ...raw.unlocks }, starLevels: { ...raw.starLevels }, equipped: { ...s.equipped, ...raw.equipped }, owned: [...new Set([...s.owned, ...(raw.owned || [])])], milestones: { ...raw.milestones } };
  s.name = raw.name || "";
  s.muted = !!raw.muted;
  s.runs = raw.prestige || 0;
  let refund = 0;
  for (const [id, lvl] of Object.entries(raw.perks || {})) {
    if (id === "tracker" || id === "minimap" || id === "radar") { if (lvl) s.unlocks[id] = true; continue; }
    const base = V1_PERK_BASE[id];
    if (base) for (let l = 0; l < lvl; l++) refund += Math.round(base * 1.6 ** l);
  }
  s.essence = (raw.essence || 0) + refund;
  s.essenceLifetime = s.essence;
  s.essenceSinceAscend = s.essence;
  return s;
}

export const perkLvl = (save, id) => save.perks[id] || 0;
export const perkCost = (p, lvl) => Math.round(p.base * p.grow ** lvl);
export const starLvl = (save, id) => save.starLevels[id] || 0;

// Bonuses a run starts with. Fresh runs ignore perks and stars (but keep QoL unlocks).
export function runMods(save, fresh) {
  const P = (id) => (fresh ? 0 : perkLvl(save, id));
  const S = (id) => (fresh ? 0 : starLvl(save, id));
  return {
    gooMult: (1 + 0.25 * P("gooMult")) * 1.5 ** S("goo"),
    speedMult: (1 + 0.06 * P("speed")) * (1 + 0.1 * S("speed")),
    comboBonus: 0.2 * P("combo"),
    startMassMult: 1 + 0.6 * P("startMass"),
    startGoo: START_GOO[P("startGoo")],
    headDash: P("headDash") > 0,
    reefStart: S("reefStart") > 0,
    pearls: S("pearls") > 0,
    gilded: S("gilded") > 0,
  };
}
export const essenceMult = (save) => (1 + 0.1 * perkLvl(save, "essence")) * (1 + 0.25 * starLvl(save, "essence"));

export function essenceForRun(save, cfg, timeMs, isPb, hadPrevBest) {
  const par = Math.max(0, Math.floor((cfg.parMs - timeMs) / (cfg.debug ? 10000 : 60000))) * ESSENCE.perMinUnderPar;
  const pb = isPb && hadPrevBest ? ESSENCE.pbBonus : 0;
  const raw = ESSENCE.base + par + pb;
  return { total: Math.round(raw * essenceMult(save)), base: ESSENCE.base, par, pb, mult: essenceMult(save) };
}

export function buyPerk(save, id) {
  const p = PERKS.find((x) => x.id === id);
  const l = perkLvl(save, id);
  if (!p || l >= p.max) return false;
  const c = perkCost(p, l);
  if (save.essence < c) return false;
  save.essence -= c;
  save.perks[id] = l + 1;
  return true;
}
export function buyUnlock(save, id) {
  const u = UNLOCKS.find((x) => x.id === id);
  if (!u || save.unlocks[id] || save.essence < u.cost) return false;
  save.essence -= u.cost;
  save.unlocks[id] = true;
  return true;
}

// ----- Ascension -----
export const starsFor = (essence) => Math.floor(Math.sqrt(Math.max(0, essence) / ASCEND.starDiv));
export const canAscend = (save) => save.essenceLifetime >= ASCEND.minLifetimeEssence && starsFor(save.essenceSinceAscend) >= 1;
export function ascend(save) {
  if (!canAscend(save)) return 0;
  const gained = starsFor(save.essenceSinceAscend);
  save.stars += gained;
  save.starsEarned += gained;
  save.ascensions += 1;
  save.essence = 0;
  save.essenceSinceAscend = 0;
  save.perks = {};
  credit(save, GEMS.ascend, "ascend");
  return gained;
}
export function buyStar(save, id) {
  const it = STAR_SHOP.find((x) => x.id === id);
  const l = starLvl(save, id);
  if (!it || l >= it.max || save.stars < it.costs[l]) return false;
  save.stars -= it.costs[l];
  save.starLevels[id] = l + 1;
  return true;
}

// ----- gems + wallet -----
// Today gems are credited by gameplay. A server-backed wallet (accounts + payments) can replace
// these three functions later without touching the UI.
export function credit(save, amount, source) {
  if (amount <= 0) return;
  save.gems += amount;
  save.gemsLifetime += amount;
}
export function makeWallet(save, persist) {
  return {
    balance: () => save.gems,
    credit: (amount, source) => { credit(save, amount, source); persist(); },
    spend: (amount) => {
      if (amount > save.gems) return false;
      save.gems -= amount;
      persist();
      return true;
    },
  };
}
export function buyCosmetic(save, wallet, id) {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c || save.owned.includes(id)) return false;
  if (!wallet.spend(c.price)) return false;
  save.owned.push(id);
  save.equipped[c.slot] = id;
  return true;
}
export function equip(save, id) {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c || !save.owned.includes(id)) return false;
  save.equipped[c.slot] = id;
  return true;
}
export function buyPack(save, wallet, id) {
  const p = ESSENCE_PACKS.find((x) => x.id === id);
  if (!p || !wallet.spend(p.price)) return false;
  save.essence += p.essence;
  save.essenceLifetime += p.essence;
  save.essenceSinceAscend += p.essence;
  return true;
}
export const equippedCosmetic = (save, slot) => COSMETICS.find((c) => c.id === save.equipped[slot]) || COSMETICS.find((c) => c.slot === slot);

// Applies a finished run to the save. Returns a summary for the results screen.
export function recordClear(save, cfg, run) {
  const timeMs = run.t * 1000;
  const key = run.fresh ? "bestFresh" : "bestNormal";
  const prev = save[key];
  const isPb = prev == null || timeMs < prev;
  const ess = essenceForRun(save, cfg, timeMs, isPb, prev != null);
  save.essence += ess.total;
  save.essenceLifetime += ess.total;
  save.essenceSinceAscend += ess.total;
  save.runs += 1;
  if (isPb) { save[key] = timeMs; save[run.fresh ? "splitsFresh" : "splitsNormal"] = run.splits.map((t) => t * 1000); }
  // gems
  let gems = GEMS.perClear + GEMS.perBiomeClear * run.biomesCleared.length + run.pearlsEaten;
  const notes = [];
  for (const b of run.biomesCleared) {
    const k = `clear${b}`;
    if (!save.milestones[k]) { save.milestones[k] = true; gems += GEMS.firstBiomeClear; notes.push(`first ${BIOMES[b].name} clear`); }
  }
  for (const [n, g] of [[50, GEMS.combo50], [100, GEMS.combo100]]) {
    const k = `combo${n}`;
    if (run.maxCombo >= n && !save.milestones[k]) { save.milestones[k] = true; gems += g; notes.push(`${n} combo`); }
  }
  credit(save, gems, "run");
  return { timeMs, prev, isPb, essence: ess, gems, notes };
}
