(() => {
  // ================= config =================
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const CFG = {
    world: 3000,
    blobCount: DEBUG ? 20 : 600,
    startMass: 20,
    parMs: DEBUG ? 30000 : 240000, // beat par for bonus Essence
    seed: 1337, // same map every run, so routes can be learned
    baseSpeed: 230,
    minSplitMass: 12,
  };
  const SAVE_KEY = DEBUG ? "blobDevourSave_debug" : "blobDevourSave";
  const COST_MULT = 1.5;
  const PERK_MULT = 1.6;

  // In-run abilities. Each has an unlock price (0 = owned from the start) and sub-upgrades.
  const ABILITIES = [
    { id: "speed", name: "Speed", kind: "Passive", desc: "Move faster.", unlock: 0,
      subs: [{ id: "lvl", name: "Speed", max: 5, base: 15, info: (l) => `+${l * 8}% speed` }] },
    { id: "magnet", name: "Magnet", kind: "Passive", desc: "Pull nearby blobs toward you.", unlock: 30,
      subs: [
        { id: "range", name: "Range", max: 5, base: 15, info: (l) => `${50 + 35 * l}px reach` },
        { id: "pull", name: "Pull strength", max: 3, base: 20, info: (l) => `${90 + 70 * l}px/s pull` },
      ] },
    { id: "gobble", name: "Gobble", kind: "Passive", desc: "Get more from every blob.", unlock: 0,
      subs: [
        { id: "goo", name: "Goo per blob", max: 5, base: 15, info: (l) => `+${l * 25}% Goo` },
        { id: "mass", name: "Mass per blob", max: 4, base: 15, info: (l) => `+${l * 20}% mass` },
      ] },
    { id: "dash", name: "Dash", kind: "Active · Space", desc: "Burst toward the cursor.", unlock: 50,
      subs: [
        { id: "cooldown", name: "Cooldown", max: 4, base: 20, info: (l) => `${(5 * 0.8 ** l).toFixed(1)}s recharge` },
        { id: "distance", name: "Distance", max: 4, base: 20, info: (l) => `${Math.round(240 * (1 + 0.25 * l))}px dash` },
        { id: "charges", name: "Charges", max: 2, base: 60, info: (l) => `${1 + l} charge${l ? "s" : ""}` },
      ] },
    { id: "split", name: "Split", kind: "Active · E", desc: "Split into pieces that eat on their own.", unlock: 80,
      subs: [
        { id: "pieces", name: "Pieces", max: 2, base: 100, info: (l) => `up to ${2 ** (1 + l)} pieces` },
        { id: "launch", name: "Launch distance", max: 3, base: 20, info: (l) => `${Math.round(160 * (1 + 0.3 * l))}px launch` },
        { id: "merge", name: "Merge time", max: 3, base: 20, info: (l) => `${(7 * (1 + 0.35 * l)).toFixed(1)}s apart` },
      ] },
  ];

  // Permanent prestige perks, bought with Essence.
  const PERKS = [
    { id: "gooMult", name: "Goo multiplier", max: 10, base: 5, info: (l) => `+${l * 20}% Goo` },
    { id: "startSpeed", name: "Quick feet", max: 5, base: 6, info: (l) => `+${l * 5}% base speed` },
    { id: "startGoo", name: "Starting Goo", max: 6, base: 4, info: (l) => `start with ${l * 25} Goo` },
    { id: "headDash", name: "Head start: Dash", max: 1, base: 10, info: () => "start runs with Dash unlocked" },
    { id: "headSplit", name: "Head start: Split", max: 1, base: 15, info: () => "start runs with Split unlocked" },
    { id: "radar", name: "Blob radar", max: 1, base: 12, info: () => "arrows point to the nearest blobs" },
  ];

  // ================= helpers =================
  const $ = (id) => document.getElementById(id);
  const radius = (m) => 4 * Math.sqrt(m);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const subCost = (sub, lvl) => Math.round(sub.base * COST_MULT ** lvl);
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
  const COLORS = { bg: C("--bg"), grid: C("--grid"), edge: C("--edge"), accent: C("--accent"), gold: C("--gold") };

  // ================= save =================
  function defaultSave() {
    return { name: "", essence: 0, prestige: 0, perks: {}, bestNormal: null, bestFresh: null };
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === "object") return { ...defaultSave(), ...s, perks: { ...(s.perks || {}) } };
    } catch {}
    return defaultSave();
  }
  let save = loadSave();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  }
  const perkLvl = (id) => save.perks[id] || 0;

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

  function newRun(state, fresh) {
    const perm = {};
    for (const p of PERKS) perm[p.id] = fresh ? 0 : perkLvl(p.id);
    const up = {};
    for (const a of ABILITIES) {
      up[a.id] = { owned: a.unlock === 0 };
      for (const s of a.subs) up[a.id][s.id] = 0;
    }
    if (perm.headDash) up.dash.owned = true;
    if (perm.headSplit) up.split.owned = true;
    const c = CFG.world / 2;
    run = {
      state, fresh,
      prestigeAtStart: save.prestige,
      perm, up,
      goo: perm.startGoo * 25,
      blobs: makeBlobs(),
      left: CFG.blobCount,
      cells: [{ x: c, y: c, m: CFG.startMass, ix: 0, iy: 0 }],
      startT: 0, endT: 0,
      dash: { n: 1, prog: 0 },
      mergeAt: 0,
      pops: [],
      submitted: false,
    };
    cam.x = c; cam.y = c;
  }

  function stats() {
    const u = run.up, p = run.perm;
    return {
      speedMult: (1 + 0.08 * u.speed.lvl) * (1 + 0.05 * p.startSpeed),
      magnetRange: u.magnet.owned ? 50 + 35 * u.magnet.range : 0,
      magnetPull: 90 + 70 * u.magnet.pull,
      gooMult: (1 + 0.25 * u.gobble.goo) * (1 + 0.2 * p.gooMult),
      massMult: 1 + 0.2 * u.gobble.mass,
      dashCd: 5000 * 0.8 ** u.dash.cooldown,
      dashDist: 240 * (1 + 0.25 * u.dash.distance),
      dashCharges: 1 + u.dash.charges,
      maxPieces: 2 ** (1 + u.split.pieces),
      splitLaunch: 160 * (1 + 0.3 * u.split.launch),
      mergeMs: 7000 * (1 + 0.35 * u.split.merge),
    };
  }

  // ================= input =================
  const pointer = { x: 0, y: 0, active: false };
  const setPointer = (x, y) => { pointer.x = x; pointer.y = y; pointer.active = true; };
  canvas.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { if (!e.touches.length) pointer.active = false; });

  function cursorWorld() {
    return { x: cam.x + (pointer.x - W / 2) / cam.zoom, y: cam.y + (pointer.y - H / 2) / cam.zoom };
  }

  window.addEventListener("keydown", (e) => {
    if (e.target === $("name")) {
      if (e.key === "Enter") startRun(false);
      return;
    }
    const k = e.key.toLowerCase();
    if (e.code === "Space") { e.preventDefault(); doDash(); }
    else if (k === "e") doSplit();
    else if (k === "u") toggleShop();
    else if (k === "r" && run && run.state !== "menu") startRun(run.fresh);
    else if (k === "escape" && run && run.state !== "menu") openMenu();
  });
  $("dashBtn").addEventListener("click", doDash);
  $("splitBtn").addEventListener("click", doSplit);
  $("shopToggle").addEventListener("click", toggleShop);
  function toggleShop() { $("shop").classList.toggle("open"); }

  // ================= abilities =================
  function isPlaying() { return run && (run.state === "ready" || run.state === "running"); }

  function doDash() {
    if (!isPlaying() || !run.up.dash.owned || run.dash.n < 1) return;
    const st = stats();
    run.dash.n--;
    const cw = cursorWorld();
    for (const c of run.cells) {
      const dx = cw.x - c.x, dy = cw.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = st.dashDist * 8; // impulse decays at rate 8/s, so it travels dashDist
      c.ix += (dx / d) * v;
      c.iy += (dy / d) * v;
    }
    beginTimer();
  }

  function doSplit() {
    if (!isPlaying() || !run.up.split.owned) return;
    const st = stats();
    const cw = cursorWorld();
    const before = run.cells.length;
    const snapshot = [...run.cells].sort((a, b) => b.m - a.m);
    for (const c of snapshot) {
      if (run.cells.length >= st.maxPieces) break;
      if (c.m < CFG.minSplitMass * 2) continue;
      c.m /= 2;
      const dx = cw.x - c.x, dy = cw.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = st.splitLaunch * 8;
      run.cells.push({ x: c.x, y: c.y, m: c.m, ix: (dx / d) * v, iy: (dy / d) * v });
    }
    if (run.cells.length > before) {
      run.mergeAt = performance.now() + st.mergeMs;
      beginTimer();
    }
  }

  function beginTimer() {
    if (run.state === "ready") {
      run.state = "running";
      run.startT = performance.now();
    }
  }

  // ================= shop (in-run) =================
  const shopRefs = []; // {btn, costEl, pipsEl, infoEl, ability, sub}
  function buildShop() {
    const root = $("shopCards");
    root.replaceChildren();
    shopRefs.length = 0;
    for (const a of ABILITIES) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<div class="card-head"><strong></strong><span class="tag"></span></div><div class="card-desc"></div>`;
      card.querySelector("strong").textContent = a.name;
      card.querySelector(".tag").textContent = a.kind;
      card.querySelector(".card-desc").textContent = a.desc;
      if (a.unlock > 0) {
        const btn = makeBuyButton(`Unlock ${a.name}`, "", true);
        btn.el.addEventListener("click", () => buy(a, null));
        card.appendChild(btn.el);
        shopRefs.push({ ...btn, ability: a, sub: null, card });
      }
      for (const s of a.subs) {
        const btn = makeBuyButton(s.name, "", false);
        btn.el.addEventListener("click", () => buy(a, s));
        card.appendChild(btn.el);
        shopRefs.push({ ...btn, ability: a, sub: s, card });
      }
      root.appendChild(card);
    }
    updateShop();
  }

  function makeBuyButton(name, info, unlock) {
    const el = document.createElement("button");
    el.className = "buy" + (unlock ? " unlock" : "");
    el.innerHTML = `<span class="name"><span class="n"></span><small></small></span><span><span class="pips"></span> <span class="cost goo"></span></span>`;
    el.querySelector(".n").textContent = name;
    return { el, infoEl: el.querySelector("small"), pipsEl: el.querySelector(".pips"), costEl: el.querySelector(".cost") };
  }

  function updateShop() {
    if (!run) return;
    for (const r of shopRefs) {
      const st = run.up[r.ability.id];
      if (!r.sub) {
        r.el.hidden = st.owned;
        r.costEl.textContent = `${r.ability.unlock} Goo`;
        r.infoEl.textContent = "";
        r.el.disabled = run.goo < r.ability.unlock || !isPlaying();
        continue;
      }
      r.el.hidden = !st.owned;
      const lvl = st[r.sub.id];
      const maxed = lvl >= r.sub.max;
      const cost = subCost(r.sub, lvl);
      r.infoEl.textContent = r.sub.info(lvl);
      r.pipsEl.textContent = "●".repeat(lvl) + "○".repeat(r.sub.max - lvl);
      r.costEl.textContent = maxed ? "MAX" : `${cost} Goo`;
      r.el.disabled = maxed || run.goo < cost || !isPlaying();
    }
    $("shopSub").textContent = `${Math.floor(run.goo)} Goo`;
  }

  function buy(a, s) {
    if (!isPlaying()) return;
    const st = run.up[a.id];
    if (!s) {
      if (st.owned || run.goo < a.unlock) return;
      run.goo -= a.unlock;
      st.owned = true;
    } else {
      if (!st.owned) return;
      const lvl = st[s.id];
      if (lvl >= s.max) return;
      const cost = subCost(s, lvl);
      if (run.goo < cost) return;
      run.goo -= cost;
      st[s.id] = lvl + 1;
      if (a.id === "dash" && s.id === "charges") run.dash.n = Math.min(run.dash.n + 1, stats().dashCharges);
    }
    updateShop();
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
      el.innerHTML = `<span class="name"><span class="n"></span><small></small></span><span><span class="pips"></span> <span class="cost essence"></span></span>`;
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
    buildShop();
    pointer.active = false;
  }

  function finishRun() {
    run.state = "done";
    run.endT = performance.now();
    const t = run.endT - run.startT;
    const key = run.fresh ? "bestFresh" : "bestNormal";
    const prev = save[key];
    const isPb = prev == null || t < prev;
    const parBonus = Math.max(0, Math.floor((CFG.parMs - t) / 10000));
    const pbBonus = isPb && prev != null ? 3 : 0;
    const ess = 5 + parBonus + pbBonus;
    save.essence += ess;
    save.prestige += 1;
    if (isPb) save[key] = t;
    persist();
    run.timeMs = t;

    $("resMode").textContent = run.fresh ? "Fresh run complete" : "Run complete";
    $("resTime").textContent = fmtTime(t);
    $("resPb").innerHTML = "";
    if (isPb) {
      const span = document.createElement("span");
      span.className = "pb";
      span.textContent = prev == null ? "First clear!" : `New personal best! (was ${fmtTime(prev)})`;
      $("resPb").appendChild(span);
    } else {
      $("resPb").textContent = `Personal best: ${fmtTime(prev)}`;
    }
    $("resEss").textContent = `+${ess}`;
    const why = ["5 base"];
    if (parBonus) why.push(`${parBonus} under par`);
    if (pbBonus) why.push(`${pbBonus} PB`);
    $("resEssWhy").textContent = `(${why.join(" + ")})`;
    $("submitBtn").disabled = DEBUG;
    $("submitMsg").textContent = DEBUG ? "Debug runs can't be submitted." : "";
    setTimeout(() => openMenu(true), 600);
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
      const rank = run.fresh || run.prestigeAtStart === 0 ? data.freshRank : data.rank;
      $("submitMsg").textContent = rank ? `Submitted! You're #${rank}${run.fresh || run.prestigeAtStart === 0 ? " on Fresh" : ""}.` : "Submitted (not in the top 100).";
      lbBoard = run.fresh ? "fresh" : "all";
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
  function update(dt, now) {
    if (!run || run.state === "menu") return;
    const st = stats();
    const playing = isPlaying();

    // dash recharge
    if (run.up.dash.owned && run.dash.n < st.dashCharges) {
      run.dash.prog += (dt * 1000) / st.dashCd;
      if (run.dash.prog >= 1) { run.dash.n++; run.dash.prog = 0; }
    }

    if (!playing) return;
    if (pointer.active && run.state === "ready") {
      const d = Math.hypot(pointer.x - W / 2, pointer.y - H / 2);
      if (d > 20) beginTimer();
    }

    const cw = cursorWorld();
    const cells = run.cells;
    const merging = cells.length > 1 && now >= run.mergeAt;
    let cx = 0, cy = 0, tm = 0;
    for (const c of cells) { cx += c.x * c.m; cy += c.y * c.m; tm += c.m; }
    cx /= tm; cy /= tm;

    for (const c of cells) {
      const r = radius(c.m);
      let vx = 0, vy = 0;
      if (pointer.active && run.state === "running") {
        const dx = cw.x - c.x, dy = cw.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 2) {
          const sp = Math.min(CFG.baseSpeed * st.speedMult * Math.pow(18 / r, 0.32), d / dt);
          vx = (dx / d) * sp; vy = (dy / d) * sp;
        }
      }
      if (merging) {
        const dx = cx - c.x, dy = cy - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) { vx += (dx / d) * 160; vy += (dy / d) * 160; }
      }
      c.x += (vx + c.ix) * dt;
      c.y += (vy + c.iy) * dt;
      const decay = Math.exp(-8 * dt);
      c.ix *= decay; c.iy *= decay;
      c.x = clamp(c.x, r * 0.5, CFG.world - r * 0.5);
      c.y = clamp(c.y, r * 0.5, CFG.world - r * 0.5);
    }

    // pieces push apart until merge time, then combine
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

    // magnet + eating
    for (const b of run.blobs) {
      if (!b.alive) continue;
      for (const c of cells) {
        const r = radius(c.m);
        const dx = c.x - b.x, dy = c.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < r + b.r * 0.5) {
          b.alive = false;
          run.left--;
          c.m += b.m * st.massMult;
          run.goo += b.g * st.gooMult;
          run.pops.push({ x: b.x, y: b.y, r: b.r, t: 0, gold: b.gold });
          break;
        }
        if (st.magnetRange && d < r + st.magnetRange) {
          const step = Math.min(d, st.magnetPull * dt);
          b.x += (dx / d) * step;
          b.y += (dy / d) * step;
        }
      }
    }

    if (run.left <= 0) finishRun();
  }

  // ================= rendering =================
  let lastShopUpdate = 0;
  function updateHud(now) {
    if (!isPlaying() && run.state !== "done") return;
    const t = run.state === "running" ? now - run.startT : run.state === "done" ? run.endT - run.startT : 0;
    $("timer").textContent = fmtTime(t);
    $("left").textContent = run.left;
    $("goo").textContent = Math.floor(run.goo);
    $("mass").textContent = Math.round(run.cells.reduce((s, c) => s + c.m, 0));

    const st = stats();
    const dashBtn = $("dashBtn");
    dashBtn.hidden = !run.up.dash.owned;
    if (run.up.dash.owned) {
      $("dashSub").textContent = `${run.dash.n}/${st.dashCharges}`;
      const full = run.dash.n >= st.dashCharges;
      dashBtn.querySelector(".cd").style.height = full ? "0%" : `${(1 - run.dash.prog) * 100}%`;
      dashBtn.classList.toggle("ready", run.dash.n > 0);
    }
    const splitBtn = $("splitBtn");
    splitBtn.hidden = !run.up.split.owned;
    if (run.up.split.owned) {
      const apart = run.cells.length > 1 && now < run.mergeAt;
      $("splitSub").textContent = apart ? `${run.cells.length}/${st.maxPieces} · ${((run.mergeAt - now) / 1000).toFixed(1)}s` : `${run.cells.length}/${st.maxPieces}`;
      const canSplit = run.cells.length < st.maxPieces && run.cells.some((c) => c.m >= CFG.minSplitMass * 2);
      splitBtn.classList.toggle("ready", canSplit);
      splitBtn.querySelector(".cd").style.height = apart ? `${((run.mergeAt - now) / st.mergeMs) * 100}%` : "0%";
    }
    if (now - lastShopUpdate > 150) { updateShop(); lastShopUpdate = now; }
  }

  function updateCamera(dt) {
    const cells = run.cells;
    let cx = 0, cy = 0, tm = 0;
    for (const c of cells) { cx += c.x * c.m; cy += c.y * c.m; tm += c.m; }
    cx /= tm; cy /= tm;
    let spread = 0;
    for (const c of cells) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + radius(c.m));
    const screen = Math.min(1, Math.max(W, H) / 1100 + 0.25);
    const base = clamp(Math.pow(18 / radius(tm), 0.4), 0.3, 1.1) * screen;
    const fit = (Math.min(W, H) * 0.42) / Math.max(spread, 1);
    const target = run.state === "menu" ? 0.6 * screen : Math.min(base, fit);
    const k = Math.min(1, dt * 8);
    cam.x += (cx - cam.x) * k;
    cam.y += (cy - cam.y) * k;
    cam.zoom += (target - cam.zoom) * Math.min(1, dt * 3);
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

    // grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const step = 50;
    for (let x = Math.max(0, Math.floor(vx0 / step) * step); x <= Math.min(world, vx1); x += step) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(world, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / step) * step); y <= Math.min(world, vy1); y += step) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(world, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 4 / z;
    ctx.strokeRect(0, 0, world, world);

    // blobs
    for (const b of run.blobs) {
      if (!b.alive) continue;
      if (b.x < vx0 - 20 || b.x > vx1 + 20 || b.y < vy0 - 20 || b.y > vy1 + 20) continue;
      ctx.fillStyle = b.gold ? COLORS.gold : `hsl(${b.hue} 70% 60%)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      if (b.gold) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
      }
    }

    // eat pops
    for (const p of run.pops) {
      p.t += dt;
      const a = 1 - p.t / 0.35;
      if (a <= 0) continue;
      ctx.strokeStyle = p.gold ? `rgba(245,197,66,${a})` : `rgba(255,255,255,${a * 0.6})`;
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + p.t * 60, 0, Math.PI * 2);
      ctx.stroke();
    }
    run.pops = run.pops.filter((p) => p.t < 0.35);

    // magnet range
    const st = stats();
    if (st.magnetRange && run.state !== "menu") {
      ctx.strokeStyle = "rgba(88,196,168,0.18)";
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 6 / z]);
      for (const c of run.cells) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius(c.m) + st.magnetRange, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // player
    if (run.state !== "menu") {
      for (const c of run.cells) {
        const r = radius(c.m);
        ctx.fillStyle = COLORS.accent;
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = Math.max(3, r * 0.08);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // radar arrows (screen space)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (run.perm.radar && isPlaying()) drawRadar(vx0, vx1, vy0, vy1);
  }

  function drawRadar(vx0, vx1, vy0, vy1) {
    const near = [];
    for (const b of run.blobs) {
      if (!b.alive) continue;
      if (b.x > vx0 && b.x < vx1 && b.y > vy0 && b.y < vy1) continue;
      const d = (b.x - cam.x) ** 2 + (b.y - cam.y) ** 2;
      near.push([d, b]);
    }
    near.sort((a, b) => a[0] - b[0]);
    ctx.fillStyle = COLORS.gold;
    for (const [, b] of near.slice(0, 3)) {
      const ang = Math.atan2(b.y - cam.y, b.x - cam.x);
      const margin = 34;
      const hx = W / 2 - margin, hy = H / 2 - margin;
      const t = Math.min(hx / Math.abs(Math.cos(ang) || 1e-6), hy / Math.abs(Math.sin(ang) || 1e-6));
      const x = W / 2 + Math.cos(ang) * t, y = H / 2 + Math.sin(ang) * t;
      ctx.save();
      ctx.translate(x, y);
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
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now);
    updateCamera(dt);
    draw(now, dt);
    updateHud(now);
    requestAnimationFrame(frame);
  }

  // debug hooks for testing
  if (DEBUG) window.__blob = { get run() { return run; }, get save() { return save; }, stats: () => stats(), finish: () => { for (const b of run.blobs) b.alive = false; run.left = 0; } };

  openMenu(false);
  requestAnimationFrame(frame);
})();
