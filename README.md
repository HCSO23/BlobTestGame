# Blob Devour

An incremental speedrun game: eat every one of the 1,000,000 blobs in the ocean as fast as you can.

- **Biomes:** the Shallows sit in the middle, with the Reef, Trench and Abyss ringed around them. You can swim anywhere, but you can only eat a biome's blobs once you're big enough. Later biomes have bigger, richer food.
- **Goo and upgrades:** eating gives mass and Goo. Spend Goo mid-run on three abilities (open the panel with **U**):
  - Speed
  - Gobble
  - Dash (**Space**)

  Each upgrade tier is tagged with the biome it's meant for.
- **Prestige, layer 1 (Essence):** every clear earns Essence for perks. The progress tracker, mini-map and radar are permanent unlocks.
- **Prestige, layer 2 (Ascension):** reset your Essence perks to turn Essence into Stars. Stars buy permanent upgrades, including Pearls and Gilded gold.
- **Gems:** earned by playing. They buy cosmetics (skins, eyes, Dash trails, bite effects) and Essence packs, and never affect leaderboards. `wallet` in `public/js/meta.js` is the place to plug in real-money purchases later.
- **Fresh runs:** ignore perks and Stars and go on the Fresh leaderboard.

## Code

| File | What it does |
|---|---|
| `public/js/config.js` | Every balance number (biomes, blob types, upgrade tiers, perks, Stars, gems) |
| `public/js/map.js` | Seeded map generation and the spatial grid |
| `public/js/sim.js` | Movement, Dash, eating and biome gates (no DOM) |
| `public/js/meta.js` | Save format, Essence, Ascension, gems and the wallet |
| `public/js/render.js` | Canvas drawing |
| `public/js/ui.js` | Menus |
| `public/js/main.js` | Loop, input, HUD and wiring |
| `server.js` | Serves the game and the leaderboard API |

## Balance

```bash
node tools/balance.mjs
```

This runs bots on the real map with the real sim and config at four meta stages: fresh, about run 15, after the first Ascension, and late game. It prints run times, when each biome opens, the order upgrades are bought, and how many runs it takes to unlock everything. Overrides such as `--late=4 --gates=400,1100,1900 --sizeSpeedExp=0.5` let you try changes before editing the config.

## Run locally

```bash
npm start
```

Open http://localhost:3000. Add `?debug=1` for a tiny map containing all four biomes; it uses a separate save, and its runs can't be submitted.

Pushing to `main` redeploys on Render. The leaderboard (`scores.json`) resets whenever the service restarts.
