// All game and balance numbers live here. Pure data (no DOM), shared by the game and tools/balance.mjs.

// ---------- blob types ----------
// gate: biome index whose size gate must be reached to eat it. color: [body, highlight].
export const BLOB_TYPES = [
  { id: "drop",       biome: 0, mass: 1,  goo: 1,  r: 5,  color: ["#7fd6c8", "#c9f2ea"] },
  { id: "dropGold",   biome: 0, mass: 3,  goo: 6,  r: 7,  color: ["#f2c45a", "#fbe7b0"], gold: true },
  { id: "polyp",      biome: 1, mass: 2,  goo: 2,  r: 7,  color: ["#f08fb0", "#fbd3e1"] },
  { id: "polypGold",  biome: 1, mass: 5,  goo: 6,  r: 9,  color: ["#f2c45a", "#fbe7b0"], gold: true },
  { id: "krill",      biome: 2, mass: 4,  goo: 4,  r: 10, color: ["#9fb4f4", "#d8e1fb"] },
  { id: "krillGold",  biome: 2, mass: 10, goo: 15, r: 13, color: ["#f2c45a", "#fbe7b0"], gold: true },
  { id: "lantern",    biome: 3, mass: 8,  goo: 8,  r: 15, color: ["#b9a2ff", "#e3dafe"] },
  { id: "lanternGold",biome: 3, mass: 20, goo: 40, r: 20, color: ["#f2c45a", "#fbe7b0"], gold: true },
  { id: "pearl",      biome: 2, mass: 5,  goo: 300, r: 11, color: ["#f4f1ea", "#ffffff"], gold: true, pearl: true },
];
export const TYPE_INDEX = Object.fromEntries(BLOB_TYPES.map((t, i) => [t.id, i]));

// ---------- biomes: rings from the center ----------
// outer: ring outer edge as a fraction of the half-width (last one covers the corners).
// gate: player radius needed to eat this biome's blobs.
export const BIOMES = [
  { id: "shallows", name: "Shallows", outer: 0.15, gate: 0,    bg: "#1d5a6b", count: 150000, clusters: 120, clusterShare: 0.55, types: [["drop", 0.96], ["dropGold", 0.04]], clearGoo: 2000 },
  { id: "reef",     name: "Reef",     outer: 0.40, gate: 400,  bg: "#16465f", count: 250000, clusters: 220, clusterShare: 0.6,  types: [["polyp", 0.85], ["polypGold", 0.15]], clearGoo: 25000 },
  { id: "trench",   name: "Trench",   outer: 0.70, gate: 1100,  bg: "#103252", count: 300000, clusters: 260, clusterShare: 0.65, types: [["krill", 0.94], ["krillGold", 0.06]], clearGoo: 150000 },
  { id: "abyss",    name: "Abyss",    outer: 9,    gate: 1900, bg: "#0b1d38", count: 300000, clusters: 240, clusterShare: 0.6,  types: [["lantern", 0.95], ["lanternGold", 0.05]], clearGoo: 600000 },
];
export const PEARL_COUNT = 400;

// ---------- world and pacing ----------
export function makeConfig(debug = false) {
  return {
    debug,
    world: debug ? 6000 : 102500,
    counts: debug ? [10, 8, 6, 6] : BIOMES.map((b) => b.count),
    pearls: debug ? 2 : PEARL_COUNT,
    seed: 1337,
    gridSize: debug ? 250 : 500,
    startMass: 20,
    radiusK: 5, radiusExp: 0.4, // player radius = radiusK · mass^radiusExp
    baseSpeed: 90,
    sizeSpeedExp: 0.5, // speed × (radius / startRadius)^this
    accel: 9,
    zoomExp: 0.7,
    dashBase: 200, dashDur: 0.28, dashSizeExp: 0.5, dashCd: 2.5,
    comboBase: 1.1, comboStep: 0.04, comboCap: 40,
    splitCount: 8,
    parMs: debug ? 30000 : 45 * 60 * 1000,
    finalStretch: debug ? 4 : 20,
    costScale: debug ? 0.02 : 1,
    // player radius needed per biome (the debug map is tiny, so its gates are tiny too)
    gates: debug ? [0, 17.5, 19, 20.5] : BIOMES.map((b) => b.gate),
  };
}

// ---------- in-run upgrades ----------
// tiers: [cost, biome it's meant for]. Prices scale ~4x per biome to follow income (tuned with
// tools/balance.mjs). `per` is the effect per tier (cooldown multiplies).
const pctFmt = (per, what) => (l) => `+${Math.round(l * per * 100)}% ${what}`;
export const ABILITIES = [
  { id: "speed", icon: "»", name: "Speed", kind: "Passive", desc: "Higher top speed. You also get faster as you grow.", unlock: 0,
    subs: [
      { id: "lvl", name: "Top speed", per: 0.25, fmt: pctFmt(0.25, "speed"),
        tiers: [[30, 0], [120, 0], [2400, 1], [10000, 1], [190000, 2], [720000, 2], [12000000, 3], [38000000, 3]] },
    ] },
  { id: "gobble", icon: "✦", name: "Gobble", kind: "Passive", desc: "More Goo and mass from every bite, and longer combos.", unlock: 0,
    subs: [
      { id: "goo", name: "Goo per bite", per: 0.25, fmt: pctFmt(0.25, "Goo"),
        tiers: [[25, 0], [100, 0], [2000, 1], [8800, 1], [160000, 2], [640000, 2], [10000000, 3], [35000000, 3]] },
      { id: "combo", name: "Combo window", per: 0.3, fmt: (l, base) => `${(base + l * 0.3).toFixed(1)}s to keep a combo`,
        tiers: [[300, 0], [12000, 1], [480000, 2], [16000000, 3]] },
      { id: "mass", name: "Mass per bite", per: 0.2, fmt: pctFmt(0.2, "mass"),
        tiers: [[200, 0], [8000, 1], [260000, 2], [1900000, 2], [32000000, 3]] },
    ] },
  { id: "dash", icon: "➤", name: "Dash", kind: "Active · Space", desc: "A quick burst in your aim direction that grows with your size. Wider pickup mid-dash; a gold blob mid-dash refunds the charge.", unlock: 80,
    subs: [
      { id: "cooldown", name: "Cooldown", per: 0.8, fmt: (l, base) => `${(base * 0.8 ** l).toFixed(2)}s recharge`,
        tiers: [[150, 0], [4000, 1], [24000, 1], [560000, 2], [9000000, 3], [32000000, 3]] },
      { id: "distance", name: "Distance", per: 0.2, fmt: pctFmt(0.2, "dash distance"),
        tiers: [[150, 0], [4000, 1], [24000, 1], [560000, 2], [9000000, 3], [32000000, 3]] },
      { id: "charges", name: "Charges", per: 1, fmt: (l) => `${1 + l} charge${l ? "s" : ""}`,
        tiers: [[20000, 1], [800000, 2], [22000000, 3]] },
    ] },
];
for (const a of ABILITIES) for (const s of a.subs) s.max = s.tiers.length;

// ---------- prestige layer 1: Essence perks (reset on Ascension) ----------
export const START_GOO = [0, 150, 500, 1500, 5000, 15000];
export const PERKS = [
  { id: "gooMult", icon: "✦", name: "Goo multiplier", max: 8, base: 3, grow: 1.4, info: (l) => `+${l * 25}% Goo` },
  { id: "speed", icon: "»", name: "Quick feet", max: 6, base: 3, grow: 1.45, info: (l) => `+${l * 6}% speed` },
  { id: "startGoo", icon: "◆", name: "Starting Goo", max: 5, base: 3, grow: 1.55, info: (l) => `Start with ${START_GOO[l].toLocaleString("en-US")} Goo` },
  { id: "startMass", icon: "●", name: "Head start size", max: 4, base: 4, grow: 1.6, info: (l) => `Start ${l * 60}% heavier` },
  { id: "combo", icon: "⟳", name: "Steady appetite", max: 3, base: 3, grow: 1.7, info: (l) => `+${(l * 0.2).toFixed(1)}s combo window` },
  { id: "essence", icon: "◈", name: "Essence gain", max: 5, base: 4, grow: 1.5, info: (l) => `+${l * 10}% Essence per clear` },
  { id: "headDash", icon: "➤", name: "Head start: Dash", max: 1, base: 5, grow: 1, info: () => "Start runs with Dash unlocked" },
];
// permanent quality-of-life unlocks (bought with Essence, never reset)
export const UNLOCKS = [
  { id: "tracker", icon: "%", name: "Progress tracker", cost: 8, info: "Shows blobs eaten, blobs left and % cleared" },
  { id: "minimap", icon: "▦", name: "Mini-map", cost: 15, info: "A live map of remaining blobs and where you are" },
  { id: "radar", icon: "↗", name: "Blob radar", cost: 12, info: "Arrows point to the nearest edible blobs off-screen" },
];
export const ESSENCE = { base: 10, perMinUnderPar: 1, pbBonus: 3 };

// ---------- prestige layer 2: Ascension and Stars ----------
export const ASCEND = { minLifetimeEssence: 200, starDiv: 8 }; // stars = floor(sqrt(essenceSinceAscend / starDiv))
export const STAR_SHOP = [
  { id: "goo", icon: "✦", name: "Star Goo", max: 4, costs: [1, 2, 3, 4], info: (l) => `×${(1.5 ** l).toFixed(2)} Goo` },
  { id: "essence", icon: "◈", name: "Star Essence", max: 3, costs: [1, 2, 3], info: (l) => `+${l * 25}% Essence` },
  { id: "speed", icon: "»", name: "Star speed", max: 3, costs: [1, 2, 3], info: (l) => `+${l * 10}% speed` },
  { id: "reefStart", icon: "◎", name: "Born in the Reef", max: 1, costs: [3], info: () => "Start each run already big enough for the Reef" },
  { id: "pearls", icon: "○", name: "Pearls", max: 1, costs: [2], info: () => `${PEARL_COUNT} rare pearls appear in the Trench: big Goo and a gem each` },
  { id: "gilded", icon: "★", name: "Gilded", max: 1, costs: [3], info: () => "Gold blobs give double Goo" },
];

// ---------- gems (earned now; real-money top-ups plug into the wallet later) ----------
export const GEMS = { perClear: 3, firstBiomeClear: 5, perBiomeClear: 1, combo50: 5, combo100: 10, ascend: 20 };
export const COSMETICS = [
  { id: "skin.teal", slot: "skin", name: "Lagoon", price: 0, body: "#5dcaa5", hi: "#c4efe0" },
  { id: "skin.coral", slot: "skin", name: "Coral", price: 30, body: "#f0997b", hi: "#fbd5c7" },
  { id: "skin.lilac", slot: "skin", name: "Lilac", price: 30, body: "#afa9ec", hi: "#e1defb" },
  { id: "skin.sun", slot: "skin", name: "Sunfish", price: 40, body: "#f2c45a", hi: "#fbe7b0" },
  { id: "skin.mint", slot: "skin", name: "Mint stripes", price: 60, body: "#7fd6c8", hi: "#d4f5ef", pattern: "stripes" },
  { id: "skin.berry", slot: "skin", name: "Berry spots", price: 60, body: "#d4537e", hi: "#f4c0d1", pattern: "spots" },
  { id: "skin.night", slot: "skin", name: "Night jelly", price: 120, body: "#3c3489", hi: "#7f77dd", pattern: "spots" },
  { id: "skin.pearl", slot: "skin", name: "Pearl", price: 150, body: "#eae6dc", hi: "#ffffff" },
  { id: "eyes.round", slot: "eyes", name: "Round", price: 0, eyes: "round" },
  { id: "eyes.sleepy", slot: "eyes", name: "Sleepy", price: 25, eyes: "sleepy" },
  { id: "eyes.happy", slot: "eyes", name: "Happy", price: 40, eyes: "happy" },
  { id: "trail.echo", slot: "trail", name: "Echo", price: 0, trail: "echo" },
  { id: "trail.bubbles", slot: "trail", name: "Bubbles", price: 40, trail: "bubbles" },
  { id: "trail.ink", slot: "trail", name: "Ink", price: 60, trail: "ink" },
  { id: "eat.ripple", slot: "eat", name: "Ripple", price: 0, eat: "ripple" },
  { id: "eat.bubbles", slot: "eat", name: "Bubble pop", price: 35, eat: "bubbles" },
];
export const ESSENCE_PACKS = [
  { id: "pack.s", name: "Small Essence pack", price: 25, essence: 10 },
  { id: "pack.m", name: "Medium Essence pack", price: 60, essence: 30 },
  { id: "pack.l", name: "Large Essence pack", price: 150, essence: 90 },
];
