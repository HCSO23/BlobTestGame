(() => {
  // ================= config =================
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const CFG = {
    world: DEBUG ? 3000 : 20500,
    blobCount: DEBUG ? 20 : 25000,
    startMass: 20,
    parMs: DEBUG ? 30000 : 25 * 60 * 1000, // beat par (25 min) for bonus Essence
    seed: 1337, // same map every run, so routes can be learned
    baseSpeed: 90,
    sizeSpeedExp: 0.35, // bigger blobs move faster: speed × (radius/18)^this
    gridSize: 250, // spatial grid cell size for blob lookups
    accel: 9, // how quickly velocity catches up to input (higher = less drift)
    splitCount: 6, // speedrun splits per run
    comboBase: 1.1, // seconds between bites to keep a combo
    comboCap: 40,
  };
  const SAVE_KEY = DEBUG ? "blobDevourSave_debug" : "blobDevourSave";
  // upgrade cost = base + step * currentLevel (steady, linear progression)
  const PERK_MULT = 1.6;
  const BUY_KEYS = ["z", "x", "c"];

  // Upgrade tiers scale with the map: more blobs means more Goo, so every upgrade gets more (smaller)
  // levels at higher prices. TIER is 10 on the full map; levels and base prices scale by √TIER and each
  // level gives 1/√TIER of the old step, so fully upgraded effects stay the same.
  const TIER = DEBUG ? 1 : CFG.blobCount / 2500;
  const LS = Math.sqrt(TIER);
  const lv = (n) => Math.round(n * LS);
  const pc = (n) => Math.round(n * LS);
  const per = (l) => l / LS;
  const pct = (x) => `${Math.round(x)}%`;

  // In-run abilities. unlock 0 = owned from the start. Each sub-upgrade's level feeds stats().
  const ABILITIES = [
    { id: "speed", icon: "»", name: "Speed", kind: "Passive", desc: "Higher top speed. You also get faster as you grow.", unlock: 0,
      subs: [
        { id: "lvl", name: "Top speed", max: lv(15), base: pc(20), step: 48, info: (l) => `+${pct(per(l) * 6)} speed` },
      ] },
    { id: "gobble", icon: "✦", name: "Gobble", kind: "Passive", desc: "More from every blob, longer combos.", unlock: 0,
      subs: [
        { id: "goo", name: "Goo per blob", max: lv(12), base: pc(30), step: 60, info: (l) => `+${pct(per(l) * 15)} Goo` },
        { id: "combo", name: "Combo window", max: lv(6), base: pc(160), step: 240, info: (l) => `${(CFG.comboBase + 0.2 * per(l)).toFixed(2)}s to keep combo` },
        { id: "mass", name: "Mass per blob", max: lv(6), base: pc(100), step: 160, info: (l) => `+${pct(per(l) * 15)} mass` },
      ] },
    { id: "dash", icon: "➤", name: "Dash", kind: "Active · Space", desc: "Short burst in your aim direction; reach grows with your size. Wider pickup while dashing; a gold blob mid-dash refunds the charge.", unlock: pc(300),
      subs: [
        { id: "cooldown", name: "Cooldown", max: lv(10), base: pc(200), step: 200, info: (l) => `${(3.5 * 0.88 ** per(l)).toFixed(2)}s recharge` },
        { id: "distance", name: "Distance", max: lv(8), base: pc(200), step: 240, info: (l) => `+${pct(per(l) * 15)} dash distance` },
        { id: "charges", name: "Charges", max: 4, base: 1600 * TIER, step: 1200 * TIER, info: (l) => `${1 + l} charge${l ? "s" : ""}` },
      ] },
  ];

  // Permanent prestige perks, bought with Essence.
  const PERKS = [
    { id: "gooMult", name: "Goo multiplier", max: 10, base: 5, info: (l) => `+${l * 20}% Goo` },
    { id: "startSpeed", name: "Quick feet", max: 5, base: 6, info: (l) => `+${l * 5}% base speed` },
    { id: "startGoo", name: "Starting Goo", max: 6, base: 4, info: (l) => `start with ${Math.round(l * 25 * LS)} Goo` },
    { id: "headDash", name: "Head start: Dash", max: 1, base: 10, info: () => "start runs with Dash unlocked" },
    { id: "radar", name: "Blob radar", max: 1, base: 12, info: () => "arrows point to the nearest blobs" },
  ];

  // ================= helpers =================
  const $ = (id) => document.getElementById(id);
  const radius = (m) => 4 * Math.sqrt(m);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const subCost = (sub, lvl) => sub.base + sub.step * lvl;
  const perkCost = (perk, lvl) => Math.round(perk.base * PERK_MULT ** lvl);
  function fmtTime(ms) {
    if (ms == null) return "—";
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const css = getComputedStyle(document.documentElement);
  const C = (name) => css.getPropertyValue(name).trim();
  const COLORS = { bg: C("--bg"), grid: C("--grid"), edge: C("--edge"), accent: C("--accent"), gold: C("--gold"), goo: C("--goo") };
  const FINAL_STRETCH = DEBUG ? 6 : 20; // last N blobs glow and get arrows

  // ================= save =================
  function defaultSave() {
    return { name: "", essence: 0, prestige: 0, perks: {}, bestNormal: null, bestFresh: null, splitsNormal: null, splitsFresh: null, muted: false };
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === "object") return { ...defaultSave(), ...s, perks: { ...(s.perks || {}) } };
    } catch {}
    return defaultSave();
  }
  let save = loadSave();
  // Split and Magnet were removed: refund their head-start perks
  if (save.perks.headSplit) { save.essence += 15; delete save.perks.headSplit; }
  if (save.perks.headMagnet) { save.essence += 8; delete save.perks.headMagnet; }
  persist();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  }
  const perkLvl = (id) => save.perks[id] || 0;

  // ================= sound (tiny WebAudio synth, no files) =================
  const sfx = (() => {
    let ac = null;
    let lastEat = 0;
    function ctx() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    function tone(freq, { type = "sine", dur = 0.09, vol = 0.12, slide = 1, delay = 0 } = {}) {
      if (save.muted || !ac) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    return {
      unlock: ctx,
      eat(combo, gold) {
        const now = performance.now();
        if (!gold && now - lastEat < 28) return; // avoid a wall of noise when eating many at once
        lastEat = now;
        // pitch climbs with the combo (one octave over 24 bites) so streaks sound like streaks
        const f = 330 * 2 ** (Math.min(combo, 24) / 24);
        if (gold) {
          tone(f * 1.5, { type: "triangle", dur: 0.16, vol: 0.13, slide: 1.02 });
          tone(f * 2.25, { type: "sine", dur: 0.22, vol: 0.07, delay: 0.05 });
        } else {
          tone(f, { type: "sine", dur: 0.07, vol: 0.09, slide: 1.35 });
        }
      },
      dash() { tone(220, { type: "sawtooth", dur: 0.18, vol: 0.05, slide: 2.2 }); },
      refund() { tone(880, { type: "triangle", dur: 0.12, vol: 0.08, delay: 0.06 }); },
      buy() { tone(523, { type: "triangle", dur: 0.08, vol: 0.08 }); tone(784, { type: "triangle", dur: 0.12, vol: 0.08, delay: 0.07 }); },
      finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { type: "triangle", dur: 0.25, vol: 0.1, delay: i * 0.11 })); },
    };
  })();
  window.addEventListener("pointerdown", () => sfx.unlock(), { once: false });
  window.addEventListener("keydown", () => sfx.unlock());

  // ================= particles =================
  function burst(x, y, color, n, speed) {
    if (!run) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random() * 0.7);
      run.parts.push({ x, y, vx: (Math.cos(a) * v) / cam.zoom, vy: (Math.sin(a) * v) / cam.zoom, t: 0, life: 0.3 + Math.random() * 0.2, color, size: (1.2 + Math.random() * 1.3) / cam.zoom });
    }
    if (run.parts.length > 500) run.parts.splice(0, run.parts.length - 500);
  }

  // ================= canvas =================
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
  }
  window.addEventListener("resize", resize);
  resize();

  // ================= run state =================
  let run = null;
  const cam = { x: CFG.world / 2, y: CFG.world / 2, zoom: 1 };

  function makeBlobs() {
    const rnd = mulberry32(CFG.seed);
    const blobs = [];
    for (let i = 0; i < CFG.blobCount; i++) {
      const roll = rnd();
      let m = 1, g = 1, gold = false;
      if (roll < 0.05) { m = 8; g = 10; gold = true; }
      else if (roll < 0.2) { m = 3; g = 3; }
      blobs.push({
        x: 40 + rnd() * (CFG.world - 80),
        y: 40 + rnd() * (CFG.world - 80),
        m, g, gold, r: radius(m) + 1,
        hue: Math.floor(rnd() * 360),
        alive: true,
      });
    }
    return blobs;
  }

  // Blobs bucketed into a coarse grid so eating, drawing and the radar only look at nearby cells.
  function makeGrid(blobs) {
    const cs = CFG.gridSize;
    const gw = Math.ceil(CFG.world / cs);
    const cells = Array.from({ length: gw * gw }, () => []);
    for (const b of blobs) cells[Math.min(gw - 1, Math.floor(b.y / cs)) * gw + Math.min(gw - 1, Math.floor(b.x / cs))].push(b);
    return { cs, gw, cells };
  }
  function eachBlobIn(x0, y0, x1, y1, fn) {
    const g = run.grid;
    const gx0 = Math.max(0, Math.floor(x0 / g.cs)), gx1 = Math.min(g.gw - 1, Math.floor(x1 / g.cs));
    const gy0 = Math.max(0, Math.floor(y0 / g.cs)), gy1 = Math.min(g.gw - 1, Math.floor(y1 / g.cs));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cell = g.cells[gy * g.gw + gx];
        for (let i = 0; i < cell.length; i++) if (cell[i].alive) fn(cell[i]);
      }
    }
  }
  // The `count` nearest live blobs outside the view rectangle, searched ring by ring outward.
  function nearestOutside(cx, cy, count, view) {
    const g = run.grid;
    const ccx = Math.floor(cx / g.cs), ccy = Math.floor(cy / g.cs);
    const found = [];
    for (let ring = 0; ring < g.gw; ring++) {
      for (let gy = ccy - ring; gy <= ccy + ring; gy++) {
        if (gy < 0 || gy >= g.gw) continue;
        const edgeRow = gy === ccy - ring || gy === ccy + ring;
        for (let gx = ccx - ring; gx <= ccx + ring; gx += edgeRow ? 1 : 2 * ring || 1) {
          if (gx < 0 || gx >= g.gw) continue;
          for (const b of g.cells[gy * g.gw + gx]) {
            if (!b.alive) continue;
            if (b.x > view[0] && b.x < view[1] && b.y > view[2] && b.y < view[3]) continue;
            found.push([(b.x - cx) ** 2 + (b.y - cy) ** 2, b]);
          }
        }
      }
      if (found.length >= count) {
        found.sort((a, b) => a[0] - b[0]);
        if (Math.sqrt(found[count - 1][0]) <= ring * g.cs) break;
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.slice(0, count).map((f) => f[1]);
  }

  function newRun(state, fresh) {
    const perm = {};
    for (const p of PERKS) perm[p.id] = fresh ? 0 : perkLvl(p.id);
    const up = {};
    for (const a of ABILITIES) {
      up[a.id] = { owned: a.unlock === 0 };
      for (const s of a.subs) up[a.id][s.id] = 0;
    }
    if (perm.headDash) up.dash.owned = true;
    const c = CFG.world / 2;
    run = {
      state, fresh,
      prestigeAtStart: save.prestige,
      perm, up,
      goo: Math.round(perm.startGoo * 25 * LS),
      blobs: null,
      grid: null,
      left: CFG.blobCount,
      eaten: 0,
      cells: [{ x: c, y: c, m: CFG.startMass, vx: 0, vy: 0, ix: 0, iy: 0 }],
      aim: { x: 1, y: 0 },
      startT: 0, endT: 0,
      dash: { n: 1, prog: 0 },
      dashUntil: 0,
      mergeAt: 0,
      combo: 0, lastEat: -1e9, maxCombo: 0,
      splits: [],
      deltaShowUntil: 0,
      pops: [],
      parts: [],
      floats: [],
      gooEarned: 0,
      finaleAt: 0,
      submitted: false,
    };
    run.blobs = makeBlobs();
    run.grid = makeGrid(run.blobs);
    cam.x = c; cam.y = c;
    selected = 0;
  }

  function stats() {
    const u = run.up, p = run.perm;
    return {
      speedMult: (1 + 0.06 * per(u.speed.lvl)) * (1 + 0.05 * p.startSpeed),
      accel: CFG.accel,
      gooMult: (1 + 0.15 * per(u.gobble.goo)) * (1 + 0.2 * p.gooMult),
      massMult: 1 + 0.15 * per(u.gobble.mass),
      comboWindow: (CFG.comboBase + 0.2 * per(u.gobble.combo)) * 1000,
      dashCd: 3500 * 0.88 ** per(u.dash.cooldown),
      dashDist: 180 * (1 + 0.15 * per(u.dash.distance)),
      dashCharges: 1 + u.dash.charges,
    };
  }
  const comboMult = (n) => 1 + 0.04 * (Math.min(n, CFG.comboCap) - 1); // x1 → ~x2.6 at 40
  const splitEvery = () => Math.max(1, Math.floor(CFG.blobCount / CFG.splitCount));

  // ================= input =================
  const pointer = { x: 0, y: 0, active: false };
  const keys = new Set();
  const setPointer = (x, y) => { pointer.x = x; pointer.y = y; pointer.active = true; };
  canvas.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { if (!e.touches.length) pointer.active = false; });
  window.addEventListener("blur", () => keys.clear());

  const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  function keyDir() {
    let x = 0, y = 0;
    for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
    const d = Math.hypot(x, y);
    return d ? { x: x / d, y: y / d } : null;
  }

  function cursorWorld() {
    return { x: cam.x + (pointer.x - W / 2) / cam.zoom, y: cam.y + (pointer.y - H / 2) / cam.zoom };
  }

  window.addEventListener("keydown", (e) => {
    if (e.target === $("name")) {
      if (e.key === "Enter") startRun(false);
      return;
    }
    if (MOVE[e.code]) {
      keys.add(e.code);
      e.preventDefault();
      if (isPlaying()) pointer.active = false; // keyboard takes over steering until the mouse moves again
      return;
    }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space" || k === "shift") { e.preventDefault(); doDash(); }
    else if (k === "u") toggleShop();
    else if (k === "m") toggleMute();
    else if (k >= "1" && k <= "4") selectAbility(Number(k) - 1);
    else if (BUY_KEYS.includes(k)) buyRow(BUY_KEYS.indexOf(k));
    else if (k === "r" && run && run.state !== "menu") startRun(run.fresh);
    else if (k === "escape" && run && run.state !== "menu") openMenu();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  $("dashBtn").addEventListener("click", doDash);
  $("shopToggle").addEventListener("click", toggleShop);
  function toggleShop() { $("shop").classList.toggle("open"); }
  function toggleMute() {
    save.muted = !save.muted;
    persist();
    $("muteBtn").textContent = save.muted ? "Sound off" : "Sound on";
  }
  $("muteBtn").addEventListener("click", toggleMute);
  $("muteBtn").textContent = save.muted ? "Sound off" : "Sound on";

  // ================= abilities =================
  function isPlaying() { return run && (run.state === "ready" || run.state === "running"); }

  // Direction an ability fires for a given piece: keyboard direction, else toward the cursor, else last heading.
  function aimFor(c) {
    const kd = keyDir();
    if (kd) return kd;
    if (pointer.active) {
      const cw = cursorWorld();
      const dx = cw.x - c.x, dy = cw.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) return { x: dx / d, y: dy / d };
    }
    return run.aim;
  }

  function doDash() {
    if (!isPlaying() || !run.up.dash.owned || run.dash.n < 1) return;
    const st = stats();
    run.dash.n--;
    for (const c of run.cells) {
      const a = aimFor(c);
      const v = st.dashDist * Math.sqrt(radius(c.m) / 18) * 8; // decays at 8/s, so it travels dashDist (scaled by size)
      c.ix += a.x * v;
      c.iy += a.y * v;
    }
    run.dashUntil = performance.now() + 320;
    sfx.dash();
    beginTimer();
  }

  function beginTimer() {
    if (run.state === "ready") {
      run.state = "running";
      run.startT = performance.now();
    }
  }

  // ================= shop (in-run) =================
  let selected = 0;
  let detailKey = "";
  const tileRefs = [];
  let rowRefs = [];

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
      tileRefs.push({ el: t, lvl: t.querySelector(".tl"), ability: a });
    });
    detailKey = "";
    updateShop();
  }

  function selectAbility(i) {
    if (!run || i < 0 || i >= ABILITIES.length) return;
    selected = i;
    updateShop();
  }

  // Rows shown for the selected ability: [unlock] when locked, otherwise its sub-upgrades.
  function rowsFor(a) {
    return run.up[a.id].owned ? a.subs.map((s) => ({ a, s })) : [{ a, s: null }];
  }

  function canBuy(a, s) {
    const st = run.up[a.id];
    if (!s) return !st.owned && run.goo >= a.unlock;
    const lvl = st[s.id];
    return st.owned && lvl < s.max && run.goo >= subCost(s, lvl);
  }

  function buildDetail() {
    const a = ABILITIES[selected];
    const root = $("detail");
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
      el.innerHTML = `<kbd>${BUY_KEYS[i].toUpperCase()}</kbd><span><div class="nm"></div><div class="val"></div><div class="bar"></div></span><span class="cost num"></span>`;
      el.querySelector(".nm").textContent = s ? s.name : `Unlock ${a.name}`;
      if (s) el.querySelector(".bar").innerHTML = "<i></i>".repeat(s.max);
      el.addEventListener("click", () => buyRow(i));
      root.appendChild(el);
      return { el, s, a, val: el.querySelector(".val"), bar: el.querySelector(".bar"), cost: el.querySelector(".cost") };
    });
  }

  function updateShop() {
    if (!run || !tileRefs.length) return;
    const playing = isPlaying();
    tileRefs.forEach((t, i) => {
      const a = t.ability;
      const st = run.up[a.id];
      t.el.classList.toggle("sel", i === selected);
      t.el.classList.toggle("locked", !st.owned);
      if (!st.owned) t.lvl.textContent = `${a.unlock} Goo`;
      else {
        const lv = a.subs.reduce((s, x) => s + st[x.id], 0);
        const mx = a.subs.reduce((s, x) => s + x.max, 0);
        t.lvl.textContent = `${lv}/${mx}`;
      }
      t.el.classList.toggle("can", playing && rowsFor(a).some(({ s }) => canBuy(a, s)));
    });
    const a = ABILITIES[selected];
    const key = `${selected}:${run.up[a.id].owned}`;
    if (key !== detailKey) { detailKey = key; buildDetail(); }
    for (const r of rowRefs) {
      const st = run.up[r.a.id];
      if (!r.s) {
        r.val.textContent = "Unlocks this ability";
        r.cost.textContent = `${r.a.unlock} Goo`;
        r.cost.className = "cost num";
        r.el.disabled = !playing || !canBuy(r.a, null);
        continue;
      }
      const lvl = st[r.s.id];
      const maxed = lvl >= r.s.max;
      r.val.replaceChildren(document.createTextNode(r.s.info(lvl)));
      if (!maxed) {
        const nx = document.createElement("span");
        nx.className = "next";
        nx.textContent = ` → ${r.s.info(lvl + 1)}`;
        r.val.appendChild(nx);
      }
      [...r.bar.children].forEach((pip, i) => pip.classList.toggle("on", i < lvl));
      r.cost.textContent = maxed ? "MAX" : `${subCost(r.s, lvl)} Goo`;
      r.cost.className = "cost num" + (maxed ? " max" : "");
      r.el.disabled = !playing || maxed || !canBuy(r.a, r.s);
    }
    $("shopGoo").textContent = Math.floor(run.goo);
    $("shopSub").textContent = `${Math.floor(run.goo)} Goo`;
  }

  function buyRow(i) {
    if (!isPlaying() || !rowRefs[i]) return;
    const { a, s, el } = rowRefs[i];
    if (!canBuy(a, s)) return;
    const st = run.up[a.id];
    if (!s) {
      run.goo -= a.unlock;
      st.owned = true;
    } else {
      run.goo -= subCost(s, st[s.id]);
      st[s.id]++;
      if (a.id === "dash" && s.id === "charges") run.dash.n = Math.min(run.dash.n + 1, stats().dashCharges);
    }
    sfx.buy();
    updateShop();
    const again = rowRefs[i];
    if (again) { again.el.classList.remove("flash"); void again.el.offsetWidth; again.el.classList.add("flash"); }
  }

  // ================= menu / prestige =================
  let lbBoard = "all";
  let lbData = { all: [], fresh: [] };

  function openMenu(results) {
    if (!results) newRun("menu", false);
    $("overlay").hidden = false;
    $("hud").hidden = true;
    $("abilities").hidden = true;
    $("shop").hidden = true;
    $("results").hidden = !results;
    renderMenu();
    fetchLeaderboard();
  }

  function renderMenu() {
    $("name").value = save.name;
    $("stPrestige").textContent = save.prestige;
    $("stEssence").textContent = save.essence;
    $("stBestN").textContent = fmtTime(save.bestNormal);
    $("stBestF").textContent = fmtTime(save.bestFresh);
    const root = $("prestigeCards");
    root.replaceChildren();
    for (const p of PERKS) {
      const lvl = perkLvl(p.id);
      const maxed = lvl >= p.max;
      const cost = perkCost(p, lvl);
      const el = document.createElement("button");
      el.className = "buy";
      el.innerHTML = `<span class="name"><span class="n"></span><small></small></span><span><span class="pips"></span> <span class="cost"></span></span>`;
      el.querySelector(".n").textContent = p.name;
      el.querySelector("small").textContent = p.info(Math.max(lvl, 1)) + (lvl ? "" : " (not owned)");
      el.querySelector(".pips").textContent = p.max > 1 ? "●".repeat(lvl) + "○".repeat(p.max - lvl) : "";
      el.querySelector(".cost").textContent = maxed ? (p.max === 1 ? "OWNED" : "MAX") : `${cost} Ess`;
      el.disabled = maxed || save.essence < cost;
      el.addEventListener("click", () => {
        const l = perkLvl(p.id);
        const c = perkCost(p, l);
        if (l >= p.max || save.essence < c) return;
        save.essence -= c;
        save.perks[p.id] = l + 1;
        persist();
        renderMenu();
      });
      root.appendChild(el);
    }
  }

  function saveName() {
    save.name = $("name").value.replace(/[<>]/g, "").trim().slice(0, 16);
    persist();
  }
  $("name").addEventListener("change", saveName);

  $("startNormal").addEventListener("click", () => startRun(false));
  $("startFresh").addEventListener("click", () => startRun(true));

  function startRun(fresh) {
    saveName();
    newRun("ready", fresh);
    $("overlay").hidden = true;
    $("hud").hidden = false;
    $("abilities").hidden = false;
    $("shop").hidden = false;
    $("modeTag").textContent = fresh ? "Fresh run · no prestige" : `Normal run · prestige ${save.prestige}`;
    $("modeTag").className = fresh ? "fresh" : "";
    $("splitDelta").textContent = "";
    buildShop();
    cam.zoom = 4; // start right up close, then pull out
    sfx.unlock();
    pointer.active = false;
    keys.clear();
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }

  function finishRun() {
    run.state = "done";
    run.endT = performance.now();
    run.finaleAt = run.endT;
    sfx.finish();
    for (const c of run.cells) burst(c.x, c.y, COLORS.gold, 40, 420);
    const t = run.endT - run.startT;
    const key = run.fresh ? "bestFresh" : "bestNormal";
    const splitKey = run.fresh ? "splitsFresh" : "splitsNormal";
    const prev = save[key];
    const isPb = prev == null || t < prev;
    const parBonus = Math.max(0, Math.floor((CFG.parMs - t) / (DEBUG ? 10000 : 30000))); // +1 per 30s under par
    const pbBonus = isPb && prev != null ? 3 : 0;
    const ess = 10 + parBonus + pbBonus;
    save.essence += ess;
    save.prestige += 1;
    if (isPb) { save[key] = t; save[splitKey] = run.splits.slice(); }
    persist();
    run.timeMs = t;

    $("resMode").textContent = run.fresh ? "Fresh run complete" : "Run complete";
    $("resTime").textContent = fmtTime(t);
    $("resPb").replaceChildren();
    if (isPb) {
      const span = document.createElement("span");
      span.className = "pb";
      span.textContent = prev == null ? "First clear!" : `New personal best! (was ${fmtTime(prev)})`;
      $("resPb").appendChild(span);
    } else {
      $("resPb").textContent = `Personal best: ${fmtTime(prev)} (+${((t - prev) / 1000).toFixed(1)}s)`;
    }
    $("resCombo").textContent = run.maxCombo;
    $("resGoo").textContent = Math.round(run.gooEarned).toLocaleString();
    let lv = 0, mx = 0;
    for (const a of ABILITIES) for (const sub of a.subs) { mx += sub.max; if (run.up[a.id].owned) lv += run.up[a.id][sub.id]; }
    $("resUps").textContent = `${lv}/${mx}`;
    run.essGained = ess;
    $("resEss").textContent = "+0";
    const why = ["10 base"];
    if (parBonus) why.push(`${parBonus} under par`);
    if (pbBonus) why.push(`${pbBonus} PB`);
    $("resEssWhy").textContent = `(${why.join(" + ")})`;
    $("submitBtn").disabled = DEBUG;
    $("submitMsg").textContent = DEBUG ? "Debug runs can't be submitted." : "";
    setTimeout(() => { openMenu(true); countUpEssence(); }, 2600);
  }

  function countUpEssence() {
    const target = run.essGained || 0;
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      $("resEss").textContent = `+${Math.round(target * (1 - (1 - k) ** 3))}`;
      if (k >= 1) { clearInterval(id); sfx.buy(); }
    }, 30);
  }

  $("submitBtn").addEventListener("click", async () => {
    if (!run || run.state !== "done" || run.submitted) return;
    saveName();
    $("submitBtn").disabled = true;
    $("submitMsg").textContent = "Submitting…";
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: save.name || "Anonymous", timeMs: Math.round(run.timeMs), prestige: run.fresh ? 0 : run.prestigeAtStart, fresh: run.fresh }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      run.submitted = true;
      const onFresh = run.fresh || run.prestigeAtStart === 0;
      const rank = onFresh ? data.freshRank : data.rank;
      $("submitMsg").textContent = rank ? `Submitted! You're #${rank}${onFresh ? " on Fresh" : ""}.` : "Submitted (not in the top 100).";
      lbBoard = onFresh ? "fresh" : "all";
      fetchLeaderboard();
    } catch (err) {
      $("submitBtn").disabled = false;
      $("submitMsg").textContent = `Couldn't submit (${err.message}).`;
    }
  });

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/leaderboard");
      lbData = await res.json();
    } catch {}
    renderLeaderboard();
  }
  function renderLeaderboard() {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.board === lbBoard);
    const list = lbData[lbBoard] || [];
    $("lbEmpty").hidden = list.length > 0;
    $("lbList").replaceChildren(...list.map((e, i) => {
      const li = document.createElement("li");
      if (save.name && e.name === save.name) li.className = "me";
      const cells = [["rank", `${i + 1}.`], ["who", e.name], ["pl", e.fresh ? "fresh" : `P${e.prestige}`], ["num", fmtTime(e.timeMs)]];
      for (const [cls, text] of cells) {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = text;
        li.appendChild(s);
      }
      return li;
    }));
  }
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => { lbBoard = t.dataset.board; renderLeaderboard(); });
  }

  // ================= simulation =================
  function onEat(b, c, st, now) {
    b.alive = false;
    run.left--;
    run.eaten++;
    run.combo = now - run.lastEat <= st.comboWindow ? run.combo + 1 : 1;
    run.lastEat = now;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    c.m += b.m * st.massMult;
    const gain = b.g * st.gooMult * comboMult(run.combo);
    run.goo += gain;
    run.pops.push({ x: b.x, y: b.y, r: b.r, t: 0, gold: b.gold });
    c.pulse = Math.min(1, (c.pulse || 0) + (b.gold ? 0.5 : 0.2));
    if (b.gold) burst(b.x, b.y, "rgba(245,197,66,0.7)", 4, 60);
    run.gooEarned += gain;
    run.floats.push({ x: b.x, y: b.y - b.r, t: 0, text: `+${Math.max(1, Math.round(gain))}`, gold: b.gold, big: b.gold });
    if (run.combo % 10 === 0) run.floats.push({ x: c.x, y: c.y - radius(c.m) - 12, t: 0, text: `${run.combo}× combo!`, gold: true, big: true });
    if (run.floats.length > 90) run.floats.splice(0, run.floats.length - 90);
    sfx.eat(run.combo, b.gold || run.left < FINAL_STRETCH);
    // dash tech: gold blob eaten mid-dash refunds the charge
    if (b.gold && now < run.dashUntil && run.dash.n < st.dashCharges) {
      run.dash.n++;
      run.pops.push({ x: c.x, y: c.y, r: radius(c.m), t: 0, gold: true });
      sfx.refund();
    }
    // speedrun splits
    if (run.eaten % splitEvery() === 0 && run.splits.length < CFG.splitCount) {
      const t = now - run.startT;
      run.splits.push(t);
      const pb = (run.fresh ? save.splitsFresh : save.splitsNormal) || [];
      const ref = pb[run.splits.length - 1];
      const el = $("splitDelta");
      if (ref != null) {
        const d = (t - ref) / 1000;
        el.textContent = `Checkpoint ${run.splits.length}: ${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(1)}s`;
        el.className = "num " + (d <= 0 ? "good" : "bad");
      } else {
        el.textContent = `Checkpoint ${run.splits.length}: ${fmtTime(t)}`;
        el.className = "num";
      }
      run.deltaShowUntil = now + 4000;
    }
  }

  function update(dt, now) {
    if (!run || run.state === "menu") return;
    const st = stats();
    const playing = isPlaying();

    if (run.up.dash.owned && run.dash.n < st.dashCharges) {
      run.dash.prog += (dt * 1000) / st.dashCd;
      if (run.dash.prog >= 1) { run.dash.n++; run.dash.prog = 0; }
    }
    if (run.state === "done" && now - run.finaleAt < 2300) {
      if (now > (run.nextFirework || 0)) {
        run.nextFirework = now + 160;
        const sx = cam.x + (Math.random() - 0.5) * (W / cam.zoom) * 0.8;
        const sy = cam.y + (Math.random() - 0.5) * (H / cam.zoom) * 0.8;
        burst(sx, sy, `hsl(${Math.floor(Math.random() * 360)} 90% 65%)`, 22, 260);
        run.pops.push({ x: sx, y: sy, r: 6, t: 0, gold: true });
      }
    }
    if (!playing) return;

    const kd = keyDir();
    if (run.state === "ready") {
      if (kd) beginTimer();
      else if (pointer.active && Math.hypot(pointer.x - W / 2, pointer.y - H / 2) > 20) beginTimer();
    }
    const steering = run.state === "running";
    const cw = cursorWorld();
    const cells = run.cells;
    const merging = cells.length > 1 && now >= run.mergeAt;
    const dashing = now < run.dashUntil;
    let cx = 0, cy = 0, tm = 0;
    for (const c of cells) { cx += c.x * c.m; cy += c.y * c.m; tm += c.m; }
    cx /= tm; cy /= tm;
    const follow = 1 - Math.exp(-st.accel * dt);

    for (const c of cells) {
      const r = radius(c.m);
      const top = CFG.baseSpeed * st.speedMult * Math.pow(r / 18, CFG.sizeSpeedExp);
      let tx = 0, ty = 0;
      if (steering && kd) { tx = kd.x * top; ty = kd.y * top; }
      else if (steering && pointer.active) {
        const dx = cw.x - c.x, dy = cw.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) { const sp = Math.min(top, d * 5); tx = (dx / d) * sp; ty = (dy / d) * sp; }
      }
      if (merging) {
        const dx = cx - c.x, dy = cy - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) { tx += (dx / d) * 170; ty += (dy / d) * 170; }
      }
      c.vx += (tx - c.vx) * follow;
      c.vy += (ty - c.vy) * follow;
      c.x += (c.vx + c.ix) * dt;
      c.y += (c.vy + c.iy) * dt;
      const decay = Math.exp(-8 * dt);
      c.ix *= decay; c.iy *= decay;
      const nx = clamp(c.x, r * 0.5, CFG.world - r * 0.5), ny = clamp(c.y, r * 0.5, CFG.world - r * 0.5);
      if (nx !== c.x) { c.vx = 0; c.ix = 0; }
      if (ny !== c.y) { c.vy = 0; c.iy = 0; }
      c.x = nx; c.y = ny;
    }
    // remember heading for aiming when there is no input
    const lead = cells[0];
    const sp = Math.hypot(lead.vx, lead.vy);
    if (sp > 20) run.aim = { x: lead.vx / sp, y: lead.vy / sp };

    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        const ra = radius(a.m), rb = radius(b.m);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (merging) {
          if (d < Math.max(ra, rb) * 0.8) {
            const m = a.m + b.m;
            a.x = (a.x * a.m + b.x * b.m) / m;
            a.y = (a.y * a.m + b.y * b.m) / m;
            a.vx = (a.vx * a.m + b.vx * b.m) / m;
            a.vy = (a.vy * a.m + b.vy * b.m) / m;
            a.m = m;
            cells.splice(j, 1);
            j--;
          }
        } else if (d < ra + rb) {
          const push = (ra + rb - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }

    for (const c of cells) {
      const r = radius(c.m) * (dashing ? 1.5 : 1);
      const reach = r + 10;
      eachBlobIn(c.x - reach, c.y - reach, c.x + reach, c.y + reach, (b) => {
        const dx = c.x - b.x, dy = c.y - b.y;
        if (dx * dx + dy * dy < (r + b.r * 0.5) ** 2) onEat(b, c, st, now);
      });
    }

    if (now - run.lastEat > st.comboWindow) run.combo = 0;
    if (run.left <= 0) finishRun();
  }

  // ================= rendering =================
  let lastShopUpdate = 0;
  function updateHud(now) {
    if (!isPlaying() && run.state !== "done") return;
    const st = stats();
    const t = run.state === "running" ? now - run.startT : run.state === "done" ? run.endT - run.startT : 0;
    $("timer").textContent = fmtTime(t);
    $("left").textContent = run.left;
    $("left").classList.toggle("final", run.left <= FINAL_STRETCH);
    $("goo").textContent = Math.floor(run.goo);
    $("mass").textContent = Math.round(run.cells.reduce((s, c) => s + c.m, 0));
    if (run.combo > 0) {
      $("comboTxt").textContent = `${run.combo} · ×${comboMult(run.combo).toFixed(2)}`;
      $("comboFill").style.width = `${clamp(1 - (now - run.lastEat) / st.comboWindow, 0, 1) * 100}%`;
    } else {
      $("comboTxt").textContent = "—";
      $("comboFill").style.width = "0%";
    }
    if (run.deltaShowUntil && now > run.deltaShowUntil) { $("splitDelta").textContent = ""; run.deltaShowUntil = 0; }

    const dashBtn = $("dashBtn");
    dashBtn.hidden = !run.up.dash.owned;
    if (run.up.dash.owned) {
      $("dashSub").textContent = `${run.dash.n}/${st.dashCharges}`;
      const full = run.dash.n >= st.dashCharges;
      dashBtn.querySelector(".cd").style.height = full ? "0%" : `${(1 - run.dash.prog) * 100}%`;
      dashBtn.classList.toggle("ready", run.dash.n > 0);
    }
    if (now - lastShopUpdate > 120) { updateShop(); lastShopUpdate = now; }
  }

  function updateCamera(dt) {
    const cells = run.cells;
    let cx = 0, cy = 0, tm = 0;
    for (const c of cells) { cx += c.x * c.m; cy += c.y * c.m; tm += c.m; }
    cx /= tm; cy /= tm;
    let spread = 0;
    for (const c of cells) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + radius(c.m));
    const screen = Math.min(1, Math.max(W, H) / 1100 + 0.25);
    // close-up while small, pulling out quickly as you grow
    const base = clamp(1.7 * Math.pow(18 / radius(tm), 0.55), 0.05, 1.7) * screen;
    const fit = (Math.min(W, H) * 0.42) / Math.max(spread, 1);
    const target = run.state === "menu" ? 0.6 * screen : run.state === "done" ? Math.min(base, fit) * 0.6 : Math.min(base, fit);
    const k = Math.min(1, dt * 8);
    cam.x += (cx - cam.x) * k;
    cam.y += (cy - cam.y) * k;
    cam.zoom += (target - cam.zoom) * Math.min(1, dt * 2.5);
  }

  function draw(now, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    const z = cam.zoom;
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));
    const vx0 = cam.x - W / 2 / z, vx1 = cam.x + W / 2 / z;
    const vy0 = cam.y - H / 2 / z, vy1 = cam.y + H / 2 / z;
    const world = CFG.world;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    let step = 50;
    while (step * z < 22) step *= 2; // keep grid lines readable when zoomed far out
    for (let x = Math.max(0, Math.floor(vx0 / step) * step); x <= Math.min(world, vx1); x += step) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(world, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / step) * step); y <= Math.min(world, vy1); y += step) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(world, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 4 / z;
    ctx.strokeRect(0, 0, world, world);

    const finalStretch = isPlaying() && run.left <= FINAL_STRETCH;
    const minR = 1.3 / z; // keep far-away blobs visible as dots
    eachBlobIn(vx0 - 20, vy0 - 20, vx1 + 20, vy1 + 20, (b) => {
      const br = Math.max(b.r, minR);
      ctx.fillStyle = b.gold ? COLORS.gold : `hsl(${b.hue} 70% 60%)`;
      if (br * z < 2.2 && !b.gold && !finalStretch) { ctx.fillRect(b.x - br, b.y - br, br * 2, br * 2); return; }
      ctx.beginPath();
      ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
      ctx.fill();
      if (b.gold) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
      }
      if (finalStretch) {
        ctx.strokeStyle = "rgba(245,197,66,0.85)";
        ctx.lineWidth = 2.5 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, br + (7 + 3 * Math.sin(now / 140)) / z, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    for (const p of run.pops) {
      p.t += dt;
      const a = 1 - p.t / 0.35;
      if (a <= 0) continue;
      ctx.strokeStyle = p.gold ? `rgba(245,197,66,${a * 0.6})` : `rgba(255,255,255,${a * 0.25})`;
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (p.t * 24) / z, 0, Math.PI * 2);
      ctx.stroke();
    }
    run.pops = run.pops.filter((p) => p.t < 0.35);

    // particles
    for (const p of run.parts) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-5 * dt); p.vy *= Math.exp(-5 * dt);
      const a = 1 - p.t / p.life;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + 0.4 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    run.parts = run.parts.filter((p) => p.t < p.life);


    if (run.state !== "menu") {
      const dashing = now < run.dashUntil;
      for (const c of run.cells) {
        const r = radius(c.m);
        if (dashing) {
          ctx.fillStyle = "rgba(88,196,168,0.16)";
          ctx.beginPath();
          ctx.arc(c.x, c.y, r * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // gulp: swell briefly after each bite
        c.pulse = (c.pulse || 0) * Math.exp(-9 * dt);
        const rr = r * (1 + 0.035 * c.pulse);
        ctx.fillStyle = COLORS.accent;
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = Math.max(3, rr * 0.08);
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // aim indicator
      if (isPlaying()) {
        const c = run.cells[0];
        const a = aimFor(c);
        const r = radius(c.m);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.moveTo(c.x + a.x * (r + 6 / z), c.y + a.y * (r + 6 / z));
        ctx.lineTo(c.x + a.x * (r + 16 / z), c.y + a.y * (r + 16 / z));
        ctx.stroke();
      }
    }

    // floating numbers
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of run.floats) {
      f.t += dt;
      const a = 1 - f.t / 0.8;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.font = `800 ${((f.big ? 19 : 13) / z).toFixed(2)}px system-ui, sans-serif`;
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(f.text, f.x, f.y - f.t * 45 / z);
      ctx.fillStyle = f.gold ? COLORS.gold : COLORS.goo;
      ctx.fillText(f.text, f.x, f.y - f.t * 45 / z);
    }
    ctx.globalAlpha = 1;
    run.floats = run.floats.filter((f) => f.t < 0.8);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (isPlaying() && (run.perm.radar || run.left <= FINAL_STRETCH)) drawRadar(vx0, vx1, vy0, vy1, run.left <= FINAL_STRETCH ? 6 : 3);
    // finale: white flash and banner
    if (run.state === "done" && run.finaleAt) {
      const e = now - run.finaleAt;
      if (e < 450) {
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - e / 450)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (e < 2600) {
        const a = Math.min(1, e / 200) * Math.min(1, (2600 - e) / 400);
        const scale = 1 + 0.25 * Math.max(0, 1 - e / 300);
        const big = Math.round((Math.min(W, 900) / 11) * scale);
        const small = Math.round(Math.min(W, 900) / 26);
        ctx.globalAlpha = a;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `900 ${big}px system-ui, sans-serif`;
        ctx.lineWidth = 8;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.strokeText("MAP CLEARED!", W / 2, H * 0.38);
        ctx.fillStyle = COLORS.gold;
        ctx.fillText("MAP CLEARED!", W / 2, H * 0.38);
        ctx.font = `700 ${small}px system-ui, sans-serif`;
        ctx.lineWidth = 5;
        const ty = H * 0.38 + Math.min(W, 900) / 12;
        ctx.strokeText(fmtTime(run.endT - run.startT), W / 2, ty);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(fmtTime(run.endT - run.startT), W / 2, ty);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawRadar(vx0, vx1, vy0, vy1, count) {
    const now = performance.now();
    if (!run.radarAt || now - run.radarAt > 250 || run.radarList.some((b) => !b.alive)) {
      run.radarAt = now;
      run.radarList = nearestOutside(cam.x, cam.y, count, [vx0, vx1, vy0, vy1]);
    }
    ctx.fillStyle = COLORS.gold;
    for (const b of run.radarList) {
      const ang = Math.atan2(b.y - cam.y, b.x - cam.x);
      const margin = 34;
      const hx = W / 2 - margin, hy = H / 2 - margin;
      const t = Math.min(hx / Math.abs(Math.cos(ang) || 1e-6), hy / Math.abs(Math.sin(ang) || 1e-6));
      ctx.save();
      ctx.translate(W / 2 + Math.cos(ang) * t, H / 2 + Math.sin(ang) * t);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ================= loop =================
  let last = performance.now();
  function tick(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (run && run.state === "done" && now - run.finaleAt < 900) dt *= 0.35; // slow-mo on the final bite
    update(dt, now);
    updateCamera(dt);
    draw(now, dt);
    updateHud(now);
  }
  function frame(now) {
    tick(now);
    requestAnimationFrame(frame);
  }
  // debug only: keep simulating when the tab can't animate (hidden test browsers)
  if (DEBUG) setInterval(() => { const now = performance.now(); if (now - last > 100) tick(now); }, 16);

  if (DEBUG) window.__blob = { get run() { return run; }, get save() { return save; }, stats: () => stats(), eachBlobIn: (...a) => eachBlobIn(...a), finish: () => { for (const b of run.blobs) b.alive = false; run.left = 0; } };

  openMenu(false);
  requestAnimationFrame(frame);
})();
