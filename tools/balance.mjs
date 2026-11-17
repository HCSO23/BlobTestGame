// Balance checker: runs headless bots on the real map with the real sim + config, at several
// meta-progression stages, then models how many runs it takes to unlock everything.
//   node tools/balance.mjs            all stages
//   node tools/balance.mjs fresh      one stage
import { makeConfig, ABILITIES, BIOMES, PERKS, UNLOCKS, STAR_SHOP, ASCEND } from "../public/js/config.js";
import { buildMap, nearestBlobs } from "../public/js/map.js";
import { createRun, step, tryDash, buy, canBuy, stats, radiusOf, subCost, unlockCost } from "../public/js/sim.js";
import { defaultSave, runMods, perkCost, essenceForRun, starsFor } from "../public/js/meta.js";

const HUMAN = 1.3; // humans are assumed this much slower than the bot
const cfg = makeConfig(false);
// quick tuning overrides, e.g. --cost=3 --gates=330,950,1700 --sizeSpeedExp=0.42 --baseSpeed=100
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
if (args.cost) for (const a of ABILITIES) { a.unlock *= +args.cost; for (const s of a.subs) s.tiers = s.tiers.map(([c, b]) => [c * +args.cost, b]); }
if (args.late) for (const a of ABILITIES) for (const s of a.subs) s.tiers = s.tiers.map(([c, b]) => [c * (+args.late) ** b, b]);
if (args.gates) cfg.gates = [0, ...args.gates.split(",").map(Number)];
for (const k of ["sizeSpeedExp", "baseSpeed", "radiusExp", "dashBase", "comboStep", "accel"]) if (args[k]) cfg[k] = +args[k];
const t0 = Date.now();
const MAP = buildMap(cfg);
console.log(`map: ${MAP.N.toLocaleString()} blobs in ${Date.now() - t0}ms`);

const maxed = (list) => Object.fromEntries(list.map((p) => [p.id, p.max]));
const STAGES = {
  fresh: { label: "Run 1 (fresh)", perks: {}, stars: {} },
  perks: { label: "~Run 15 (Essence perks mostly bought)", perks: { gooMult: 6, speed: 4, startGoo: 3, startMass: 2, combo: 2, essence: 3, headDash: 1 }, stars: {} },
  ascend1: { label: "After 1st Ascension (few Stars, some perks)", perks: { gooMult: 4, speed: 3, startGoo: 2, startMass: 1, headDash: 1 }, stars: { goo: 1, speed: 1, pearls: 1 } },
  late: { label: "~Run 50 (all perks + Stars)", perks: maxed(PERKS), stars: maxed(STAR_SHOP) },
};

function runBot(stageKey) {
  const st0 = STAGES[stageKey];
  const save = { ...defaultSave(), perks: st0.perks, starLevels: st0.stars };
  const run = createRun(cfg, MAP, runMods(save, false), false);
  const gateTimes = [0, null, null, null];
  const hooks = { onGate: (g) => { gateTimes[g] = run.t; } };
  const dt = 1 / 20;
  let target = -1, retarget = 0;
  const all = [];
  for (const a of ABILITIES) { all.push([a, null]); for (const s of a.subs) all.push([a, s]); }
  const price = ([a, s]) => (s ? (run.up[a.id].owned && run.up[a.id][s.id] < s.max ? subCost(cfg, s, run.up[a.id][s.id]) : Infinity) : (run.up[a.id].owned ? Infinity : unlockCost(cfg, a)));
  let wall = 0;
  const income = [0];
  while (run.state !== "done" && run.t < 3 * 3600) {
    // buy the cheapest affordable upgrade(s)
    for (;;) {
      let best = null, bp = Infinity;
      for (const it of all) { const c = price(it); if (c < bp) { bp = c; best = it; } }
      if (!best || !canBuy(run, best[0], best[1])) break;
      buy(run, best[0], best[1]);
    }
    const p = run.p, r = radiusOf(cfg, p.m);
    if (target < 0 || !run.alive[target] || run.t > retarget) {
      const near = nearestBlobs(MAP, run, p.x, p.y, 1, (i) => r >= cfg.gates[MAP.tBiome[MAP.bt[i]]]);
      target = near.length ? near[0] : -1;
      retarget = run.t + 0.5;
    }
    let input = { x: 0, y: 0, throttle: 1 };
    if (target >= 0) {
      const dx = MAP.bx[target] - p.x, dy = MAP.by[target] - p.y, d = Math.hypot(dx, dy) || 1;
      input = { x: dx / d, y: dy / d, throttle: 1 };
      const s = stats(run);
      if (d > r * 1.5 + s.dashDist && run.dash.n >= 1) tryDash(run, { x: dx / d, y: dy / d });
    }
    step(run, dt, input, hooks);
    if (Math.floor(run.t / 120) > income.length - 1) income.push(Math.round(run.gooEarned));
    if (++wall % 2000 === 0 && run.left === run.required) break; // stuck safety
  }
  const s = stats(run);
  let lv = 0, mx = 0;
  for (const a of ABILITIES) for (const sub of a.subs) { mx += sub.max; if (run.up[a.id].owned) lv += run.up[a.id][sub.id]; }
  return { stageKey, label: st0.label, t: run.t, gateTimes, left: run.left, goo: run.goo, r: radiusOf(cfg, run.p.m), tiers: `${lv}/${mx}`, buys: run.buys, income, maxCombo: run.maxCombo, splits: run.splits };
}

const fmt = (s) => (s == null ? "  —  " : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const which = process.argv.slice(2).find((a) => !a.startsWith("--"));
const results = {};
for (const key of Object.keys(STAGES)) {
  if (which && which !== key) continue;
  const t1 = Date.now();
  const r = runBot(key);
  results[key] = r;
  console.log(`\n== ${r.label} ==  (sim ${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  console.log(`  bot ${fmt(r.t)}  human ~${fmt(r.t * HUMAN)}  | gates Reef ${fmt(r.gateTimes[1])} Trench ${fmt(r.gateTimes[2])} Abyss ${fmt(r.gateTimes[3])} | tiers ${r.tiers} | Goo left ${Math.round(r.goo).toLocaleString()} | final r ${Math.round(r.r)} | best combo ${r.maxCombo}${r.left ? ` | UNFINISHED left ${r.left}` : ""}`);
  console.log(`  quarters: ${[1, 3, 5, 7].map((k) => fmt(r.splits[k])).join("  ")}`);
  console.log(`  Goo earned every 2 min: ${r.income.map((g) => (g >= 1e6 ? (g / 1e6).toFixed(1) + "M" : g >= 1e3 ? Math.round(g / 1e3) + "k" : g)).join(" ")}`);
  const timeline = r.buys.map(([t, l]) => `${l}@${fmt(t).trim()}`);
  console.log(`  buys: ${timeline.join(" ")}`);
}

// ---- meta progression model: runs needed to unlock everything ----
if (!which && results.fresh && results.perks && results.late) {
  const T0 = results.fresh.t, T1 = results.perks.t, T3 = results.late.t;
  const a = 1 - T1 / T0, b = 1 - T3 / T1;
  const perkTotal = PERKS.reduce((s, p) => { let c = 0; for (let l = 0; l < p.max; l++) c += perkCost(p, l); return s + c; }, 0) + UNLOCKS.reduce((s, u) => s + u.cost, 0);
  const starTotal = STAR_SHOP.reduce((s, it) => s + it.costs.reduce((x, y) => x + y, 0), 0);
  const save = defaultSave();
  let runs = 0, perksDoneAt = null;
  const ascendAt = [];
  const spentOn = () => PERKS.reduce((s, p) => { let c = 0; for (let l = 0; l < (save.perks[p.id] || 0); l++) c += perkCost(p, l); return s + c; }, 0);
  const starSpent = () => STAR_SHOP.reduce((s, it) => { let c = 0; for (let l = 0; l < (save.starLevels[it.id] || 0); l++) c += it.costs[l]; return s + c; }, 0);
  while (runs < 400) {
    runs++;
    const pf = spentOn() / (perkTotal - UNLOCKS.reduce((s, u) => s + u.cost, 0));
    const sf = starSpent() / starTotal;
    const tBot = T0 * (1 - a * pf) * (1 - b * sf);
    const ess = essenceForRun(save, cfg, tBot * HUMAN * 1000, false, true);
    save.essence += ess.total; save.essenceLifetime += ess.total; save.essenceSinceAscend += ess.total;
    // spend: unlocks first, then cheapest perk
    for (const u of UNLOCKS) if (!save.unlocks[u.id] && save.essence >= u.cost) { save.essence -= u.cost; save.unlocks[u.id] = true; }
    for (;;) {
      let best = null, bc = Infinity;
      for (const p of PERKS) { const l = save.perks[p.id] || 0; if (l < p.max && perkCost(p, l) < bc) { bc = perkCost(p, l); best = p; } }
      if (!best || save.essence < bc) break;
      save.essence -= bc; save.perks[best.id] = (save.perks[best.id] || 0) + 1;
    }
    const perksMaxed = PERKS.every((p) => (save.perks[p.id] || 0) >= p.max);
    if (perksMaxed && perksDoneAt == null) perksDoneAt = runs;
    const allStars = STAR_SHOP.every((it) => (save.starLevels[it.id] || 0) >= it.max);
    if (allStars && perksMaxed) break;
    if (perksMaxed && !allStars && save.essenceLifetime >= ASCEND.minLifetimeEssence) {
      const g = starsFor(save.essenceSinceAscend);
      save.stars += g; save.perks = {}; save.essence = 0; save.essenceSinceAscend = 0;
      ascendAt.push(`${runs}(+${g}★)`);
      for (;;) {
        let best = null, bc = Infinity;
        for (const it of STAR_SHOP) { const l = save.starLevels[it.id] || 0; if (l < it.max && it.costs[l] < bc) { bc = it.costs[l]; best = it; } }
        if (!best || save.stars < bc) break;
        save.stars -= bc; save.starLevels[best.id] = (save.starLevels[best.id] || 0) + 1;
      }
    }
  }
  console.log(`\n== Meta progression (human pace) ==`);
  console.log(`  Essence layer: perks + unlocks cost ${perkTotal} Essence; first all-perks at run ${perksDoneAt}`);
  console.log(`  Ascensions at runs: ${ascendAt.join(", ") || "none"}`);
  console.log(`  Everything unlocked by run ${runs}  (star shop total ${starTotal}★)`);
}
