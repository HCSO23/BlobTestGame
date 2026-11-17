// Game entry: loop, input, camera, sound, HUD and the in-run upgrade panel. Wires sim ↔ render ↔ menu.
import { makeConfig, ABILITIES, BIOMES } from "./config.js";
import { buildMap } from "./map.js";
import { createRun, step, stats, tryDash, buy, canBuy, subCost, unlockCost, isPlaying, radiusOf, comboMult } from "./sim.js";
import { migrate, runMods, recordClear, makeWallet, equippedCosmetic } from "./meta.js";
import { createRenderer, fmtNum, fmtTime } from "./render.js";
import { createMenu } from "./ui.js";

const params = new URLSearchParams(location.search);
const DEBUG = params.get("debug") === "1";
const cfg = makeConfig(DEBUG);
const $ = (id) => document.getElementById(id);
const BUY_KEYS = ["z", "x", "c"];

// ---------- save ----------
const SAVE_KEY = DEBUG ? "blobDevourSave_debug" : "blobDevourSave";
let save;
try { save = migrate(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch { save = migrate(null); }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
persist();
const wallet = makeWallet(save, persist);

// ---------- sound (tiny WebAudio synth, no files) ----------
const sfx = (() => {
  let ac = null, noise = null, lastEat = 0;
  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function tone(freq, { type = "sine", dur = 0.09, vol = 0.1, slide = 1, delay = 0 } = {}) {
    if (save.muted || !ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function whoosh(dur) {
    if (save.muted || !ac) return;
    if (!noise) {
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.6), ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime, src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise;
    bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(600, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t); src.stop(t + dur + 0.05);
  }
  return {
    unlock: ctx,
    // soft "bloop": low sine that rises a little, pitch follows the combo
    eat(combo, special) {
      const now = performance.now();
      if (!special && now - lastEat < 34) return;
      lastEat = now;
      const f = 260 * 2 ** (Math.min(combo, 24) / 24);
      if (special) { tone(f * 1.5, { type: "triangle", dur: 0.18, vol: 0.09, slide: 1.04 }); tone(f * 2.25, { dur: 0.24, vol: 0.05, delay: 0.05 }); }
      else tone(f, { dur: 0.08, vol: 0.06, slide: 1.45 });
    },
    dash() { whoosh(0.32); tone(140, { dur: 0.14, vol: 0.08, slide: 0.5 }); },
    refund() { tone(880, { type: "triangle", dur: 0.12, vol: 0.07, delay: 0.06 }); },
    buy() { tone(523, { type: "triangle", dur: 0.08, vol: 0.06 }); tone(784, { type: "triangle", dur: 0.12, vol: 0.06, delay: 0.07 }); },
    unlockBiome() { [392, 523, 659].forEach((f, i) => tone(f, { type: "triangle", dur: 0.22, vol: 0.07, delay: i * 0.09 })); },
    finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { type: "triangle", dur: 0.28, vol: 0.08, delay: i * 0.11 })); },
  };
})();
window.addEventListener("pointerdown", () => sfx.unlock());
window.addEventListener("keydown", () => sfx.unlock());

// ---------- world ----------
let MAP, R, menu, run;
const cam = { x: cfg.world / 2, y: cfg.world / 2, zoom: 1, punch: 0 };
let cos = {};
function loadCosmetics() {
  cos = { skin: equippedCosmetic(save, "skin"), eyes: equippedCosmetic(save, "eyes").eyes, trail: equippedCosmetic(save, "trail").trail, eat: equippedCosmetic(save, "eat").eat };
}

// ---------- input ----------
const pointer = { x: 0, y: 0, active: false };
const keys = new Set();
const canvas = $("c");
const setPointer = (x, y) => { pointer.x = x; pointer.y = y; pointer.active = true; };
canvas.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
canvas.addEventListener("touchend", (e) => { if (!e.touches.length) pointer.active = false; });
window.addEventListener("blur", () => keys.clear());
window.addEventListener("resize", () => R && R.resize());
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
function keyDir() {
  let x = 0, y = 0;
  for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
  const d = Math.hypot(x, y);
  return d ? { x: x / d, y: y / d } : null;
}
function cursorWorld() {
  const { W, H } = R.size();
  return { x: cam.x + (pointer.x - W / 2) / cam.zoom, y: cam.y + (pointer.y - H / 2) / cam.zoom };
}
function aimDir() {
  const kd = keyDir();
  if (kd) return kd;
  if (pointer.active && run) {
    const cw = cursorWorld(), dx = cw.x - run.p.x, dy = cw.y - run.p.y, d = Math.hypot(dx, dy);
    if (d > 4) return { x: dx / d, y: dy / d };
  }
  return run ? run.aim : { x: 1, y: 0 };
}
function moveInput() {
  const kd = keyDir();
  if (kd) return { x: kd.x, y: kd.y, throttle: 1 };
  if (pointer.active) {
    const cw = cursorWorld(), dx = cw.x - run.p.x, dy = cw.y - run.p.y, d = Math.hypot(dx, dy);
    if (d > 3) {
      const top = cfg.baseSpeed * stats(run).speedMult * Math.pow(radiusOf(cfg, run.p.m) / radiusOf(cfg, cfg.startMass), cfg.sizeSpeedExp);
      const { W, H } = R.size();
      const screenD = Math.hypot(pointer.x - W / 2, pointer.y - H / 2);
      return { x: dx / d, y: dy / d, throttle: Math.min(1, (d * 5) / top), started: screenD > 20 };
    }
  }
  return { x: 0, y: 0, throttle: 0 };
}

window.addEventListener("keydown", (e) => {
  if (e.target === $("name")) { if (e.key === "Enter") { menu.saveName(); startRun(false); } return; }
  if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); if (run && isPlaying(run)) pointer.active = false; return; }
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (e.code === "Space" || k === "shift") { e.preventDefault(); doDash(); }
  else if (k === "u" || k === "tab") { if (run && isPlaying(run)) { e.preventDefault(); toggleShop(); } }
  else if (k === "m") toggleMute();
  else if (k >= "1" && k <= "3") selectAbility(Number(k) - 1);
  else if (BUY_KEYS.includes(k)) buyRow(BUY_KEYS.indexOf(k));
  else if (k === "r" && run && run.state !== "menu") startRun(run.fresh);
  else if (k === "escape" && run && run.state !== "menu") toMenu();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
$("dashBtn").addEventListener("click", () => doDash());
$("upgBtn").addEventListener("click", () => toggleShop());
$("shopClose").addEventListener("click", () => toggleShop(false));
$("muteBtn").addEventListener("click", () => toggleMute());
function toggleMute() { save.muted = !save.muted; persist(); $("muteBtn").classList.toggle("muted", !!save.muted); }
$("muteBtn").classList.toggle("muted", !!save.muted);
function toggleShop(force) {
  const open = typeof force === "boolean" ? force : !$("shop").classList.contains("open");
  $("shop").classList.toggle("open", open);
  $("upgBtn").hidden = open || !(run && isPlaying(run));
  if (open) updateShop();
}
function doDash() {
  if (!run || !isPlaying(run)) return;
  if (tryDash(run, aimDir(), hooks)) { cam.punch = 0.07; sfx.dash(); }
}

// ---------- sim → effects ----------
let floatsThisFrame = 0;
const hooks = {
  onEat(i, gain, gold, pearl) {
    R.onEat(i, gain, gold, pearl, cam.zoom, cos, floatsThisFrame++ < 4);
    sfx.eat(run.combo, gold || pearl || run.left < cfg.finalStretch);
  },
  onDashMove(p, r) { R.onDashMove(p, r, cos); },
  onRefund() { sfx.refund(); },
  onBiomeEnter(b, first) {
    const r = radiusOf(cfg, run.p.m);
    if (r >= cfg.gates[b]) banner(BIOMES[b].name, first ? "New waters" : "");
    else banner(BIOMES[b].name, `Grow to size ${fmtNum(cfg.gates[b])} to feed here`);
  },
  onGate(b) { banner(`${BIOMES[b].name} unlocked`, "You're big enough to feed there now"); sfx.unlockBiome(); },
  onBiomeClear(b, bonus) { banner(`${BIOMES[b].name} cleared`, `+${fmtNum(bonus)} Goo`); R.floatText(run.p.x, run.p.y - radiusOf(cfg, run.p.m) - 30 / cam.zoom, `${BIOMES[b].name} cleared`, true); sfx.unlockBiome(); },
  onCheckpoint(n, t) {
    const pb = (run.fresh ? save.splitsFresh : save.splitsNormal) || [];
    const ref = pb[n - 1], el = $("splitDelta");
    if (ref != null) { const d = (t * 1000 - ref) / 1000; el.textContent = `Checkpoint ${n}: ${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(1)}s`; el.className = "num " + (d <= 0 ? "good" : "bad"); }
    else { el.textContent = `Checkpoint ${n} · ${fmtTime(t * 1000)}`; el.className = "num"; }
    deltaUntil = performance.now() + 4000;
  },
  onFinish() { finishRun(); },
};
let bannerTimer = 0, deltaUntil = 0;
function banner(title, sub) {
  $("bannerTitle").textContent = title;
  $("bannerSub").textContent = sub || "";
  $("banner").classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $("banner").classList.remove("show"), 2600);
}

// ---------- runs ----------
function setInRun(on) {
  $("overlay").hidden = on;
  $("hud").hidden = !on;
  $("abilities").hidden = true;
  $("shop").hidden = !on;
  $("upgBtn").hidden = !on;
  $("minimapCard").hidden = !on || !save.unlocks.minimap;
  $("tracker").hidden = !on || !save.unlocks.tracker;
  if (!on) $("shop").classList.remove("open");
}
function newRun(fresh, state) {
  run = createRun(cfg, MAP, runMods(save, fresh), fresh);
  if (state) run.state = state;
  R.reset(run);
  cam.x = run.p.x; cam.y = run.p.y;
}
function startRun(fresh) {
  loadCosmetics();
  newRun(fresh);
  setInRun(true);
  $("modeTag").textContent = fresh ? "Fresh run · no perks" : save.ascensions ? `Run · ascension ${save.ascensions}` : "Run";
  $("modeTag").className = "label" + (fresh ? " fresh" : "");
  $("splitDelta").textContent = "";
  selected = 0;
  buildShop();
  cam.zoom = 4;
  sfx.unlock();
  pointer.active = false;
  keys.clear();
  document.activeElement?.blur?.();
  banner("Shallows", "Eat everything. The rings outside open as you grow.");
}
function toMenu() {
  newRun(false, "menu");
  setInRun(false);
  menu.open(false);
}
function finishRun() {
  sfx.finish();
  toggleShop(false);
  $("upgBtn").hidden = true;
  $("abilities").hidden = true;
  R.finale(run.p.x, run.p.y, cam.zoom);
  finaleText = ["Map cleared", fmtTime(run.t * 1000)];
  const summary = recordClear(save, cfg, run);
  persist();
  const finished = run;
  setTimeout(() => { setInRun(false); menu.open(true); menu.showResults(finished, summary); }, 2600);
}
let finaleText = null;

// ---------- upgrade panel ----------
let selected = 0, detailKey = "", rowRefs = [];
const tileRefs = [];
const rowsFor = (a) => (run.up[a.id].owned ? a.subs.map((s) => ({ a, s })) : [{ a, s: null }]);
function buildShop() {
  const root = $("tiles");
  root.replaceChildren();
  tileRefs.length = 0;
  ABILITIES.forEach((a, i) => {
    const t = document.createElement("button");
    t.className = "tile";
    t.innerHTML = `<kbd>${i + 1}</kbd><span class="dot"></span><span class="ico"></span><span class="tn"></span><span class="tl num"></span>`;
    t.querySelector(".ico").textContent = a.icon;
    t.querySelector(".tn").textContent = a.name;
    t.addEventListener("click", () => selectAbility(i));
    root.appendChild(t);
    tileRefs.push({ el: t, lvl: t.querySelector(".tl"), a });
  });
  detailKey = "";
  updateShop();
}
function selectAbility(i) { if (run && i >= 0 && i < ABILITIES.length) { selected = i; updateShop(); } }
function buildDetail() {
  const a = ABILITIES[selected], root = $("detail");
  root.replaceChildren();
  const head = document.createElement("div");
  head.className = "detail-head";
  head.innerHTML = `<strong></strong><span class="tag"></span>`;
  head.querySelector("strong").textContent = `${a.icon} ${a.name}`;
  head.querySelector(".tag").textContent = a.kind;
  const desc = document.createElement("div");
  desc.className = "detail-desc";
  desc.textContent = a.desc;
  root.append(head, desc);
  rowRefs = rowsFor(a).map(({ s }, i) => {
    const el = document.createElement("button");
    el.className = "up" + (s ? "" : " unlock");
    el.innerHTML = `<div class="main"><div class="nm"><kbd>${BUY_KEYS[i].toUpperCase()}</kbd><span class="n"></span><span class="btag"></span></div><div class="val"></div></div><span class="cost num"></span>` + (s ? `<div class="pips">${"<i></i>".repeat(s.max)}</div>` : "");
    el.querySelector(".n").textContent = s ? s.name : `Unlock ${a.name}`;
    el.addEventListener("click", () => buyRow(i));
    root.appendChild(el);
    return { el, s, a, val: el.querySelector(".val"), pips: el.querySelector(".pips"), cost: el.querySelector(".cost"), btag: el.querySelector(".btag") };
  });
}
function fmtInfo(s, l) {
  if (s.id === "combo") return s.fmt(l, cfg.comboBase + run.mods.comboBonus);
  if (s.id === "cooldown") return s.fmt(l, cfg.dashCd);
  return s.fmt(l);
}
function updateShop() {
  if (!run || !tileRefs.length) return;
  const playing = isPlaying(run);
  let afford = 0;
  tileRefs.forEach((t, i) => {
    const st = run.up[t.a.id];
    t.el.classList.toggle("sel", i === selected);
    t.el.classList.toggle("locked", !st.owned);
    if (!st.owned) t.lvl.textContent = `${fmtNum(unlockCost(cfg, t.a))} Goo`;
    else t.lvl.textContent = `${t.a.subs.reduce((n, x) => n + st[x.id], 0)}/${t.a.subs.reduce((n, x) => n + x.max, 0)}`;
    const n = rowsFor(t.a).filter(({ a, s }) => canBuy(run, a, s)).length;
    afford += n;
    t.el.classList.toggle("can", playing && n > 0);
  });
  const a = ABILITIES[selected], key = `${selected}:${run.up[a.id].owned}`;
  if (key !== detailKey) { detailKey = key; buildDetail(); }
  for (const r of rowRefs) {
    const st = run.up[r.a.id];
    if (!r.s) {
      r.val.textContent = "Unlocks this ability";
      r.cost.textContent = `${fmtNum(unlockCost(cfg, r.a))} Goo`;
      r.cost.className = "cost num";
      r.btag.textContent = "Shallows";
      r.el.disabled = !playing || !canBuy(run, r.a, null);
      continue;
    }
    const lvl = st[r.s.id], maxed = lvl >= r.s.max;
    r.val.replaceChildren(document.createTextNode(fmtInfo(r.s, lvl)));
    if (!maxed) { const nx = document.createElement("span"); nx.className = "next"; nx.textContent = ` → ${fmtInfo(r.s, lvl + 1)}`; r.val.appendChild(nx); }
    [...r.pips.children].forEach((pip, i) => pip.classList.toggle("on", i < lvl));
    r.cost.textContent = maxed ? "Maxed" : `${fmtNum(subCost(cfg, r.s, lvl))} Goo`;
    r.cost.className = "cost num" + (maxed ? " max" : "");
    const tb = maxed ? -1 : r.s.tiers[lvl][1];
    r.btag.textContent = tb < 0 ? "" : BIOMES[tb] ? BIOMES[tb].name : "Endgame";
    r.btag.classList.toggle("end", tb >= BIOMES.length);
    r.btag.hidden = maxed;
    r.el.disabled = !playing || maxed || !canBuy(run, r.a, r.s);
  }
  $("shopGoo").textContent = fmtNum(run.goo);
  $("upgGoo").textContent = `${fmtNum(run.goo)} Goo`;
  $("upgBadge").textContent = playing && afford ? afford : "";
  $("upgBtn").classList.toggle("has", playing && afford > 0);
}
function buyRow(i) {
  if (!run || !isPlaying(run)) return;
  if (!rowRefs.length) updateShop();
  const r = rowRefs[i];
  if (!r || !buy(run, r.a, r.s)) return;
  sfx.buy();
  updateShop();
  const again = rowRefs[i];
  if (again) { again.el.classList.remove("flash"); void again.el.offsetWidth; again.el.classList.add("flash"); }
}

// ---------- HUD ----------
let lastShopUpdate = 0, miniAt = 0;
function updateHud(now) {
  if (!run || run.state === "menu") return;
  const st = stats(run);
  $("timer").textContent = fmtTime(run.t * 1000);
  $("goo").textContent = fmtNum(run.goo);
  const r = radiusOf(cfg, run.p.m);
  $("size").textContent = fmtNum(r);
  // biome + next gate
  $("biomeName").textContent = BIOMES[run.biome].name;
  const next = run.gateReached + 1;
  if (next < BIOMES.length) {
    const prev = cfg.gates[run.gateReached] || radiusOf(cfg, cfg.startMass);
    $("gateTxt").textContent = `${BIOMES[next].name} at size ${fmtNum(cfg.gates[next])}`;
    $("gateFill").style.width = `${Math.min(100, Math.max(0, (r - prev) / (cfg.gates[next] - prev)) * 100)}%`;
  } else { $("gateTxt").textContent = "All biomes open"; $("gateFill").style.width = "100%"; }
  if (run.combo > 0) {
    $("comboTxt").textContent = `${fmtNum(run.combo)}  ×${comboMult(cfg, run.combo).toFixed(2)}`;
    $("comboFill").style.width = `${Math.min(1, Math.max(0, 1 - (run.t - run.lastEat) / st.comboWindow)) * 100}%`;
  } else { $("comboTxt").textContent = "—"; $("comboFill").style.width = "0%"; }
  if (save.unlocks.tracker) {
    const frac = run.eaten / run.required;
    $("trackPct").textContent = `${(frac * 100).toFixed(frac < 0.1 ? 2 : 1)}%`;
    $("trackFill").style.width = `${frac * 100}%`;
    $("trackEaten").textContent = fmtNum(run.eaten);
    $("trackLeft").textContent = fmtNum(run.left);
  }
  const final = run.left <= cfg.finalStretch && run.left > 0;
  $("finalTag").hidden = !final;
  if (final) $("finalTag").textContent = `Final ${run.left} — follow the arrows`;
  if (deltaUntil && now > deltaUntil) { $("splitDelta").textContent = ""; deltaUntil = 0; }
  const playing = isPlaying(run);
  $("abilities").hidden = !run.up.dash.owned || !playing;
  if (run.up.dash.owned) {
    $("dashSub").textContent = run.dash.n;
    $("dashRing").style.setProperty("--p", run.dash.n >= st.dashCharges ? 1 : run.dash.prog);
    $("dashBtn").classList.toggle("ready", run.dash.n > 0);
  }
  if (now - lastShopUpdate > 150) { updateShop(); lastShopUpdate = now; }
  if (save.unlocks.minimap && now - miniAt > 120) { miniAt = now; R.minimap($("minimap"), run, cam); }
}

// ---------- camera ----------
function updateCamera(dt) {
  const p = run.p, r = radiusOf(cfg, p.m);
  const { W, H } = R.size();
  const screen = Math.min(1, Math.max(W, H) / 1100 + 0.25);
  const base = Math.min(1.7, Math.max(0.01, 1.7 * Math.pow(radiusOf(cfg, cfg.startMass) / r, cfg.zoomExp))) * screen;
  const target = run.state === "menu" ? 0.35 * screen : run.state === "done" ? base * 0.6 : base;
  const k = Math.min(1, dt * (p.dash ? 5 : 8));
  cam.x += (p.x + p.vx * 0.12 - cam.x) * k;
  cam.y += (p.y + p.vy * 0.12 - cam.y) * k;
  cam.zoom += (target - cam.zoom) * Math.min(1, dt * 2.5);
  cam.punch *= Math.exp(-6 * dt);
}

// ---------- loop ----------
let last = performance.now();
function tick(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (run.state === "done" && finaleText && now - R.flashAt < 900) dt *= 0.35;
  floatsThisFrame = 0;
  if (isPlaying(run)) {
    const input = moveInput();
    if (run.state === "ready" && input.throttle > 0 && input.started === false) input.throttle = 0;
    step(run, dt, input, hooks);
  }
  updateCamera(dt);
  R.setAim(isPlaying(run) ? aimDir() : run.aim);
  const finalStretch = isPlaying(run) && run.left <= cfg.finalStretch;
  R.draw(now, dt, cam, run, { cos, showRadar: isPlaying(run) && (save.unlocks.radar || finalStretch), finalStretch, finaleText: run.state === "done" ? finaleText : null });
  updateHud(now);
}
function frame(now) { tick(now); requestAnimationFrame(frame); }

// ---------- boot ----------
setTimeout(() => {
  const t0 = performance.now();
  MAP = buildMap(cfg);
  R = createRenderer(canvas, cfg, MAP);
  R.flashAt = 0;
  const finaleOrig = R.finale;
  R.finale = (x, y, z) => { R.flashAt = performance.now(); finaleOrig(x, y, z); };
  loadCosmetics();
  menu = createMenu({ cfg, save, persist, wallet, sfx, onStart: (fresh) => startRun(fresh) });
  newRun(false, "menu");
  $("loading").hidden = true;
  setInRun(false);
  menu.open(false);
  if (DEBUG || params.get("perf") === "1") {
    window.__blob = {
      get run() { return run; }, save, MAP, cam, cfg, R,
      genMs: Math.round(performance.now() - t0),
      tick: (n = 1) => { for (let k = 0; k < n; k++) tick(last + 16.7); },
      finish: () => { for (let i = 0; i < MAP.N; i++) if (run.alive[i] && !MAP.tPearl[MAP.bt[i]]) { run.alive[i] = 0; run.cellAlive[MAP.cellOf[i]]--; } run.left = 0; },
      grow: (r) => { run.p.m = Math.pow(r / cfg.radiusK, 1 / cfg.radiusExp); },
      frameCost: (n = 10) => { const t1 = performance.now(); for (let k = 0; k < n; k++) R.draw(performance.now(), 0.016, cam, run, { cos, showRadar: false, finalStretch: false }); return (performance.now() - t1) / n; },
    };
    if (DEBUG) setInterval(() => { const now = performance.now(); if (now - last > 100) tick(now); }, 16);
  }
  requestAnimationFrame(frame);
}, 30);
