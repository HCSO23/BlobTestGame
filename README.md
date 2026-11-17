# Blob Devour

An incremental speedrun game: eat every blob on the map as fast as you can.

- **Goal:** the map has 600 small blobs that don't move. Eat them all to stop the clock. The map is the same every run, so you can learn a route.
- **Goo:** eating gives mass and Goo. Spend Goo mid-run on abilities and their sub-upgrades:
  - Speed
  - Magnet
  - Gobble
  - Dash (Space)
  - Split (E)

  These reset every run.
- **Prestige:** finishing a run earns Essence, which you spend on permanent perks like a Goo multiplier, head-start abilities or the blob radar.
- **Fresh runs:** ignore all prestige perks and count for the Fresh leaderboard.
- **Controls:** R restarts instantly. Esc goes back to the menu.

## Run locally

```bash
npm start
```

Open http://localhost:3000. Add `?debug=1` for a 20-blob test map, which uses a separate save and can't be submitted.

## Deploy

Pushing to `main` redeploys on Render through `render.yaml`.

## How it works

- `public/game.js`: the whole game runs in the browser. Progress is saved in localStorage.
- `server.js`: serves the page and the leaderboard API:
  - `GET /api/leaderboard`
  - `POST /api/score`

  Scores are kept in `scores.json`. On Render's free plan that file is wiped whenever the service restarts or redeploys.
- Run times are reported by the browser, so the leaderboard can be cheated. That's fine for a test game.
