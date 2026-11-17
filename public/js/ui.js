// Menu screens: play/results, Essence perks + permanent unlocks, Ascension + star shop, gem shop,
// leaderboard. Reads and writes the save through meta.js.
import { PERKS, UNLOCKS, STAR_SHOP, COSMETICS, ESSENCE_PACKS, ASCEND } from "./config.js";
import { perkLvl, perkCost, buyPerk, buyUnlock, starLvl, buyStar, canAscend, ascend, starsFor, buyCosmetic, equip, buyPack, equippedCosmetic } from "./meta.js";
import { fmtNum, fmtTime } from "./render.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createMenu({ cfg, save, persist, wallet, sfx, onStart }) {
  let lbBoard = "all", lbData = { all: [], fresh: [] }, lastRun = null, ascendArmed = false;

  function showPane(name) {
    for (const t of document.querySelectorAll(".mtab")) t.classList.toggle("on", t.dataset.pane === name);
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.dataset.pane !== name;
    ascendArmed = false;
    render();
  }
  for (const t of document.querySelectorAll(".mtab")) t.addEventListener("click", () => showPane(t.dataset.pane));

  // generic shop card
  function card(kind, { icon, swatch, name, desc, level, cost, done, disabled, equipped, onClick }) {
    const b = el("button", `item ${kind}${equipped ? " equipped" : ""}`);
    b.innerHTML = `<div class="top"></div><div class="bottom"><span class="lv num"></span><span class="cost num"></span></div>`;
    const top = b.querySelector(".top");
    if (swatch) { const s = el("span", "swatch"); s.style.background = swatch; top.appendChild(s); }
    else { const i = el("span", "ico"); i.textContent = icon; top.appendChild(i); }
    const txt = el("div");
    const n = el("div", "nm"); n.textContent = name;
    const d = el("div", "ds"); d.textContent = desc;
    txt.append(n, d);
    top.appendChild(txt);
    b.querySelector(".lv").textContent = level || "";
    const c = b.querySelector(".cost");
    c.textContent = cost;
    if (done) c.classList.add("done");
    b.disabled = !!disabled;
    if (onClick) b.addEventListener("click", () => { if (onClick()) { persist(); sfx.unlock(); sfx.buy(); render(); } });
    return b;
  }

  function render() {
    $("hdEss").textContent = fmtNum(save.essence);
    $("hdStars").textContent = save.stars;
    $("hdGems").textContent = fmtNum(save.gems);
    $("name").value = save.name;
    $("stBestN").textContent = fmtTime(save.bestNormal);
    $("stBestF").textContent = fmtTime(save.bestFresh);
    $("stRuns").textContent = save.runs;
    drawPreview();

    // perks
    $("essNow").textContent = fmtNum(save.essence);
    let perkAff = false;
    $("perkCards").replaceChildren(...PERKS.map((p) => {
      const l = perkLvl(save, p.id), maxed = l >= p.max, c = perkCost(p, l);
      if (!maxed && save.essence >= c) perkAff = true;
      return card("ess", { icon: p.icon, name: p.name, desc: maxed ? p.info(l) : `Next: ${p.info(l + 1)}`, level: p.max > 1 ? `Level ${l} / ${p.max}` : maxed ? "Unlocked" : "Not unlocked", cost: maxed ? "✓ Maxed" : `${c} Essence`, done: maxed, disabled: maxed || save.essence < c, onClick: () => buyPerk(save, p.id) });
    }));
    $("unlockCards").replaceChildren(...UNLOCKS.map((u) => {
      const owned = !!save.unlocks[u.id];
      if (!owned && save.essence >= u.cost) perkAff = true;
      return card("ess", { icon: u.icon, name: u.name, desc: u.info, level: owned ? "Unlocked" : "Permanent", cost: owned ? "✓ Owned" : `${u.cost} Essence`, done: owned, disabled: owned || save.essence < u.cost, onClick: () => buyUnlock(save, u.id) });
    }));
    $("perkDot").hidden = !perkAff;

    // ascend
    const gain = starsFor(save.essenceSinceAscend);
    $("ascStars").textContent = gain;
    $("starsNow").textContent = save.stars;
    const can = canAscend(save);
    $("ascNote").textContent = can
      ? `From ${fmtNum(save.essenceSinceAscend)} Essence earned since your last Ascension.`
      : save.essenceLifetime < ASCEND.minLifetimeEssence
        ? `Unlocks after earning ${ASCEND.minLifetimeEssence} Essence in total (${fmtNum(save.essenceLifetime)} so far).`
        : "Earn more Essence to reach your first Star.";
    $("ascendBtn").disabled = !can;
    $("ascendBtn").textContent = ascendArmed ? `Confirm: reset perks for ${gain} ★` : "Ascend";
    $("ascendBtn").className = ascendArmed ? "btn danger" : "btn star";
    let starAff = false;
    $("starCards").replaceChildren(...STAR_SHOP.map((it) => {
      const l = starLvl(save, it.id), maxed = l >= it.max, c = it.costs[l];
      if (!maxed && save.stars >= c) starAff = true;
      return card("star", { icon: it.icon, name: it.name, desc: maxed ? it.info(l) : `Next: ${it.info(l + 1)}`, level: it.max > 1 ? `Level ${l} / ${it.max}` : maxed ? "Unlocked" : "Not unlocked", cost: maxed ? "✓ Maxed" : `${c} ★`, done: maxed, disabled: maxed || save.stars < c, onClick: () => buyStar(save, it.id) });
    }));
    $("ascendDot").hidden = !(can || starAff);

    // gems
    $("gemsNow").textContent = fmtNum(save.gems);
    const cosCard = (c) => {
      const owned = save.owned.includes(c.id), eq = save.equipped[c.slot] === c.id;
      const slotName = { skin: "Skin", eyes: "Eyes", trail: "Dash trail", eat: "Bite effect" }[c.slot];
      return card("gem", {
        icon: { eyes: "◉", trail: "≋", eat: "◌" }[c.slot], swatch: c.slot === "skin" ? `radial-gradient(circle at 35% 35%, ${c.hi}, ${c.body} 60%)` : null,
        name: c.name, desc: slotName, equipped: eq, level: eq ? "Equipped" : owned ? "Owned" : "",
        cost: eq ? "✓ On" : owned ? "Equip" : c.price ? `${c.price} gems` : "Free", done: eq,
        disabled: eq || (!owned && save.gems < c.price),
        onClick: () => (owned ? equip(save, c.id) : buyCosmetic(save, wallet, c.id)),
      });
    };
    $("cosSkin").replaceChildren(...COSMETICS.filter((c) => c.slot === "skin").map(cosCard));
    $("cosOther").replaceChildren(...COSMETICS.filter((c) => c.slot !== "skin").map(cosCard));
    $("packCards").replaceChildren(...ESSENCE_PACKS.map((p) => card("gem", { icon: "◈", name: p.name, desc: `+${p.essence} Essence`, cost: `${p.price} gems`, disabled: save.gems < p.price, onClick: () => buyPack(save, wallet, p.id) })));
    renderLeaderboard();
  }

  $("ascendBtn").addEventListener("click", () => {
    if (!canAscend(save)) return;
    if (!ascendArmed) { ascendArmed = true; render(); return; }
    const g = ascend(save);
    ascendArmed = false;
    persist();
    sfx.unlock(); sfx.finish();
    $("ascNote").textContent = `Ascended for ${g} ★.`;
    render();
  });

  // character preview
  function drawPreview() {
    const cv = $("preview");
    const c = cv.getContext("2d");
    const S = cv.width;
    const skin = equippedCosmetic(save, "skin"), eyes = equippedCosmetic(save, "eyes").eyes;
    c.clearRect(0, 0, S, S);
    c.fillStyle = "#16465f"; c.fillRect(0, 0, S, S);
    c.fillStyle = "#f08fb0"; for (const [x, y] of [[40, 50], [235, 70], [60, 230], [220, 225]]) { c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); }
    const r = S * 0.3, cx = S / 2, cy = S / 2 + 6;
    c.save(); c.translate(cx, cy);
    c.fillStyle = skin.body; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    if (skin.pattern) {
      c.save(); c.clip(); c.fillStyle = skin.hi; c.globalAlpha = 0.35;
      if (skin.pattern === "stripes") for (let k = -3; k <= 3; k++) c.fillRect(-r, k * r * 0.32 - r * 0.08, r * 2, r * 0.16);
      else for (const [a, b, d] of [[-0.4, 0.35, 0.16], [0.45, 0.4, 0.12], [0.1, -0.5, 0.1], [-0.55, -0.15, 0.09], [0.5, -0.1, 0.13]]) { c.beginPath(); c.arc(a * r, b * r, d * r, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    c.globalAlpha = 0.5; c.fillStyle = skin.hi; c.beginPath(); c.ellipse(-r * 0.32, -r * 0.38, r * 0.34, r * 0.2, -0.5, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    for (const side of [-1, 1]) {
      const ex = side * r * 0.26 + r * 0.06, ey = -r * 0.08, w = r * 0.15, h = r * 0.19;
      if (eyes === "happy") { c.strokeStyle = "#0b2a2a"; c.lineWidth = r * 0.06; c.lineCap = "round"; c.beginPath(); c.arc(ex, ey + w * 0.3, w * 0.9, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); continue; }
      c.fillStyle = "#fff"; c.beginPath(); c.ellipse(ex, ey, w, h, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#0b2a2a"; c.beginPath(); c.arc(ex + w * 0.35, ey, w * 0.55, 0, Math.PI * 2); c.fill();
      if (eyes === "sleepy") { c.fillStyle = skin.body; c.beginPath(); c.ellipse(ex, ey - h * 0.45, w * 1.15, h * 0.65, 0, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  // results
  function showResults(run, summary) {
    lastRun = { run, summary, submitted: false };
    $("results").hidden = false;
    $("resMode").textContent = run.fresh ? "Fresh run complete" : "Run complete";
    $("resTime").textContent = fmtTime(summary.timeMs);
    $("resPb").replaceChildren();
    if (summary.isPb) { const s = el("span", "pb"); s.textContent = summary.prev == null ? "First clear!" : `New personal best (was ${fmtTime(summary.prev)})`; $("resPb").appendChild(s); }
    else $("resPb").textContent = `Personal best ${fmtTime(summary.prev)} · +${((summary.timeMs - summary.prev) / 1000).toFixed(1)}s`;
    $("resCombo").textContent = fmtNum(run.maxCombo);
    $("resGoo").textContent = fmtNum(run.gooEarned);
    $("resGems").textContent = `+${summary.gems}`;
    const e = summary.essence;
    const why = [`${e.base} base`];
    if (e.par) why.push(`${e.par} under par`);
    if (e.pb) why.push(`${e.pb} personal best`);
    $("resWhy").textContent = `Essence: (${why.join(" + ")}) × ${e.mult.toFixed(2)}${summary.notes.length ? ` · Gem bonus: ${summary.notes.join(", ")}` : ""}`;
    $("submitBtn").disabled = cfg.debug;
    $("submitMsg").textContent = cfg.debug ? "Debug runs can't be submitted." : "";
    // count the Essence up for a little payoff
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      $("resEss").textContent = `+${Math.round(e.total * (1 - (1 - k) ** 3))}`;
      if (k >= 1) { clearInterval(id); sfx.buy(); }
    }, 30);
  }

  $("submitBtn").addEventListener("click", async () => {
    if (!lastRun || lastRun.submitted) return;
    saveName();
    $("submitBtn").disabled = true;
    $("submitMsg").textContent = "Submitting…";
    try {
      const { run, summary } = lastRun;
      const res = await fetch("/api/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: save.name || "Anonymous", timeMs: Math.round(summary.timeMs), prestige: run.fresh ? 0 : save.ascensions, fresh: run.fresh }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      lastRun.submitted = true;
      const onFresh = run.fresh || save.ascensions === 0;
      const rank = onFresh ? data.freshRank : data.rank;
      $("submitMsg").textContent = rank ? `Submitted — you're #${rank}${onFresh ? " on Fresh" : ""}.` : "Submitted (not in the top 100).";
      lbBoard = onFresh ? "fresh" : "all";
      fetchLeaderboard();
    } catch (err) {
      $("submitBtn").disabled = false;
      $("submitMsg").textContent = `Couldn't submit (${err.message}).`;
    }
  });

  async function fetchLeaderboard() {
    try { lbData = await (await fetch("/api/leaderboard")).json(); } catch {}
    renderLeaderboard();
  }
  function renderLeaderboard() {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.board === lbBoard);
    const list = lbData[lbBoard] || [];
    $("lbEmpty").hidden = list.length > 0;
    $("lbList").hidden = list.length === 0;
    $("lbList").replaceChildren(...list.map((e, i) => {
      const li = el("li", save.name && e.name === save.name ? "me" : "");
      for (const [cls, text] of [["rank", `${i + 1}`], ["who", e.name], ["pl", e.fresh ? "fresh" : `A${e.prestige}`], ["num", fmtTime(e.timeMs)]]) { const s = el("span", cls); s.textContent = text; li.appendChild(s); }
      return li;
    }));
  }
  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => { lbBoard = t.dataset.board; renderLeaderboard(); });

  function saveName() { save.name = $("name").value.replace(/[<>]/g, "").trim().slice(0, 16); persist(); }
  $("name").addEventListener("change", saveName);
  $("startNormal").addEventListener("click", () => { saveName(); onStart(false); });
  $("startFresh").addEventListener("click", () => { saveName(); onStart(true); });

  function open(results) {
    $("overlay").hidden = false;
    if (!results) $("results").hidden = true;
    showPane("play");
    fetchLeaderboard();
  }
  return { open, render, showResults, saveName };
}
