// Run simulation: movement, Dash, eating, combo, biomes, checkpoints. Pure (no DOM), shared by
// the game and tools/balance.mjs. Time is simulated time (run.t, seconds), not wall-clock.
import { ABILITIES, BIOMES } from "./config.js";
import { eachBlobIn } from "./map.js";

export const radiusOf = (cfg, m) => cfg.radiusK * Math.pow(m, cfg.radiusExp);
export const massForRadius = (cfg, r) => Math.pow(r / cfg.radiusK, 1 / cfg.radiusExp);
const easeOut = (x) => 1 - (1 - x) ** 3;

// mods: run-wide bonuses from perks/stars (see meta.runMods). All default to "no bonus".
export function createRun(cfg, MAP, mods = {}, fresh = false) {
  const m = {
    gooMult: 1, speedMult: 1, comboBonus: 0, startMassMult: 1, startGoo: 0,
    headDash: false, reefStart: false, pearls: false, gilded: false, ...mods,
  };
  const up = {};
  for (const a of ABILITIES) {
    up[a.id] = { owned: a.unlock === 0 };
    for (const s of a.subs) up[a.id][s.id] = 0;
  }
  if (m.headDash) up.dash.owned = true;

  const alive = new Uint8Array(MAP.N).fill(1);
  const cellAlive = new Int32Array(MAP.gw * MAP.gw);
  for (let k = 0; k < cellAlive.length; k++) cellAlive[k] = MAP.start[k + 1] - MAP.start[k];
  if (!m.pearls) {
    for (let i = MAP.pearlStart; i < MAP.N; i++) { alive[i] = 0; cellAlive[MAP.cellOf[i]]--; }
  }
  const required = MAP.pearlStart; // pearls never count toward clearing the map
  let startMass = cfg.startMass * m.startMassMult;
  if (m.reefStart) startMass = Math.max(startMass, massForRadius(cfg, cfg.gates[1] * 1.02));
  const c = cfg.world / 2;
  return {
    cfg, MAP, mods: m, fresh,
    state: "ready", t: 0,
    up, goo: m.startGoo, gooEarned: 0,
    alive, cellAlive,
    left: required, eaten: 0, required,
    biomeLeft: MAP.counts.slice(), biomesCleared: [],
    biome: 0, biomeSeen: [true, false, false, false], gateReached: 0,
    p: { x: c, y: c, m: startMass, vx: 0, vy: 0, pulse: 0, dash: null },
    aim: { x: 1, y: 0 },
    dash: { n: 1, prog: 0 },
    combo: 0, lastEat: -1e9, maxCombo: 0,
    pearlsEaten: 0,
    splits: [],
    buys: [], // [time, label] for the balance tool
  };
}

const PER = {};
for (const a of ABILITIES) for (const s of a.subs) PER[`${a.id}.${s.id}`] = s.per;
export function stats(run) {
  const u = run.up, m = run.mods, cfg = run.cfg;
  return {
    speedMult: (1 + PER["speed.lvl"] * u.speed.lvl) * m.speedMult,
    gooMult: (1 + PER["gobble.goo"] * u.gobble.goo) * m.gooMult,
    massMult: 1 + PER["gobble.mass"] * u.gobble.mass,
    comboWindow: cfg.comboBase + PER["gobble.combo"] * u.gobble.combo + m.comboBonus,
    dashCd: cfg.dashCd * PER["dash.cooldown"] ** u.dash.cooldown,
    dashDist: cfg.dashBase * (1 + PER["dash.distance"] * u.dash.distance),
    dashCharges: 1 + u.dash.charges,
  };
}
export const comboMult = (cfg, n) => 1 + cfg.comboStep * (Math.min(n, cfg.comboCap) - 1);
export const topSpeed = (run, st, r) => run.cfg.baseSpeed * st.speedMult * Math.pow(r / radiusOf(run.cfg, run.cfg.startMass), run.cfg.sizeSpeedExp);
export const subCost = (cfg, s, lvl) => Math.max(1, Math.round(s.tiers[lvl][0] * cfg.costScale));
export const unlockCost = (cfg, a) => Math.max(1, Math.round(a.unlock * cfg.costScale));
export const isPlaying = (run) => run.state === "ready" || run.state === "running";
export const canEatType = (run, t) => radiusOf(run.cfg, run.p.m) >= run.cfg.gates[run.MAP.tBiome[t]];

export function canBuy(run, a, s) {
  const st = run.up[a.id];
  if (!s) return !st.owned && run.goo >= unlockCost(run.cfg, a);
  const lvl = st[s.id];
  return st.owned && lvl < s.max && run.goo >= subCost(run.cfg, s, lvl);
}
export function buy(run, a, s) {
  if (!isPlaying(run) || !canBuy(run, a, s)) return false;
  const st = run.up[a.id];
  if (!s) {
    run.goo -= unlockCost(run.cfg, a);
    st.owned = true;
    run.buys.push([run.t, `${a.id}`]);
  } else {
    run.goo -= subCost(run.cfg, s, st[s.id]);
    st[s.id]++;
    run.buys.push([run.t, `${s.id}${st[s.id]}`]);
    if (a.id === "dash" && s.id === "charges") run.dash.n = Math.min(run.dash.n + 1, stats(run).dashCharges);
  }
  return true;
}

function begin(run) {
  if (run.state === "ready") run.state = "running";
}

export function tryDash(run, aim, hooks) {
  if (!isPlaying(run) || !run.up.dash.owned || run.dash.n < 1) return false;
  const st = stats(run), p = run.p;
  run.dash.n--;
  const r = radiusOf(run.cfg, p.m);
  const dist = st.dashDist * Math.pow(r / radiusOf(run.cfg, run.cfg.startMass), run.cfg.dashSizeExp);
  p.dash = { t: 0, dur: run.cfg.dashDur, dx: aim.x, dy: aim.y, dist, prevE: 0 };
  begin(run);
  hooks?.onDash?.();
  return true;
}

// input: { x, y } unit direction (or 0,0 for none), throttle 0..1
export function step(run, dt, input, hooks = {}) {
  const cfg = run.cfg, MAP = run.MAP, st = stats(run), p = run.p;
  if (run.up.dash.owned && run.dash.n < st.dashCharges) {
    run.dash.prog += dt / st.dashCd;
    if (run.dash.prog >= 1) { run.dash.n++; run.dash.prog = 0; }
  }
  if (!isPlaying(run)) return;
  if (run.state === "ready" && input.throttle > 0) begin(run);
  if (run.state !== "running") return;
  run.t += dt;

  const r = radiusOf(cfg, p.m);
  const top = topSpeed(run, st, r);
  const tx = input.x * top * input.throttle, ty = input.y * top * input.throttle;
  const follow = 1 - Math.exp(-cfg.accel * dt);
  p.vx += (tx - p.vx) * follow;
  p.vy += (ty - p.vy) * follow;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  let pickup = 1;
  if (p.dash) {
    const d = p.dash;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const e = easeOut(k);
    p.x += d.dx * (e - d.prevE) * d.dist;
    p.y += d.dy * (e - d.prevE) * d.dist;
    d.prevE = e;
    pickup = 1 + 0.5 * (1 - k);
    hooks.onDashMove?.(p, r);
    if (k >= 1) { p.vx = d.dx * top; p.vy = d.dy * top; p.dash = null; }
  }
  const nx = Math.min(cfg.world - r * 0.5, Math.max(r * 0.5, p.x)), ny = Math.min(cfg.world - r * 0.5, Math.max(r * 0.5, p.y));
  if (nx !== p.x) p.vx = 0;
  if (ny !== p.y) p.vy = 0;
  p.x = nx; p.y = ny;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > 20) run.aim = { x: p.vx / sp, y: p.vy / sp };

  // biome tracking
  const h = cfg.world / 2;
  const dc = Math.hypot(p.x - h, p.y - h) / h;
  let b = BIOMES.length - 1;
  for (let k = 0; k < BIOMES.length; k++) if (dc < BIOMES[k].outer) { b = k; break; }
  if (b !== run.biome) { run.biome = b; if (!run.biomeSeen[b]) { run.biomeSeen[b] = true; hooks.onBiomeEnter?.(b, true); } else hooks.onBiomeEnter?.(b, false); }
  while (run.gateReached < BIOMES.length - 1 && r >= cfg.gates[run.gateReached + 1]) {
    run.gateReached++;
    hooks.onGate?.(run.gateReached);
  }

  // eat everything edible under the blob
  const er = r * pickup;
  const { bx, by, bt, tR, tBiome } = MAP;
  const gates = cfg.gates;
  eachBlobIn(MAP, run, p.x - er - 25, p.y - er - 25, p.x + er + 25, p.y + er + 25, (i) => {
    const t = bt[i];
    if (r < gates[tBiome[t]]) return;
    const dx = p.x - bx[i], dy = p.y - by[i];
    const reach = er + tR[t] * 0.5;
    if (dx * dx + dy * dy < reach * reach) eat(run, i, st, hooks);
  });

  if (run.t - run.lastEat > st.comboWindow) run.combo = 0;
  if (run.left <= 0) {
    run.state = "done";
    p.dash = null;
    hooks.onFinish?.();
  }
}

function eat(run, i, st, hooks) {
  const MAP = run.MAP, cfg = run.cfg, p = run.p;
  run.alive[i] = 0;
  run.cellAlive[MAP.cellOf[i]]--;
  const t = MAP.bt[i];
  const gold = MAP.tGold[t] === 1, pearl = MAP.tPearl[t] === 1;
  run.combo = run.t - run.lastEat <= st.comboWindow ? run.combo + 1 : 1;
  run.lastEat = run.t;
  if (run.combo > run.maxCombo) { run.maxCombo = run.combo; hooks.onComboRecord?.(run.combo); }
  p.m += MAP.tMass[t] * st.massMult;
  let gain = MAP.tGoo[t] * st.gooMult * comboMult(cfg, run.combo);
  if (gold && !pearl && run.mods.gilded) gain *= 2;
  run.goo += gain;
  run.gooEarned += gain;
  p.pulse = Math.min(1, p.pulse + (gold ? 0.5 : 0.2));
  if (pearl) {
    run.pearlsEaten++;
  } else {
    run.left--;
    run.eaten++;
    const b = MAP.tBiome[t];
    if (--run.biomeLeft[b] === 0) {
      const bonus = BIOMES[b].clearGoo * cfg.costScale * st.gooMult;
      run.goo += bonus;
      run.gooEarned += bonus;
      run.biomesCleared.push(b);
      hooks.onBiomeClear?.(b, bonus);
    }
    const every = Math.max(1, Math.floor(run.required / cfg.splitCount));
    if (run.eaten % every === 0 && run.splits.length < cfg.splitCount) {
      run.splits.push(run.t);
      hooks.onCheckpoint?.(run.splits.length, run.t);
    }
  }
  if (gold && p.dash && run.dash.n < st.dashCharges) {
    run.dash.n++;
    hooks.onRefund?.();
  }
  hooks.onEat?.(i, gain, gold, pearl);
}
