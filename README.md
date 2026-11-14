# Blob Arena

A tiny multiplayer .io game. Move your blob with the mouse (or your finger), eat pellets to grow, and eat smaller players.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in two tabs to see multiplayer.

## Deploy (Render, free)

1. Push this repo to GitHub.
2. On https://dashboard.render.com choose **New → Blueprint**, then pick the repo. Render reads `render.yaml`.
3. Share the `https://<name>.onrender.com` link. Anyone who opens it is in the game.

The free tier sleeps after about 15 minutes idle, so the first visit after that takes about 30 seconds to wake.

## How it works

- `server.js`: a Node HTTP server that serves `public/` and runs a 30 Hz game loop with WebSockets at `/ws`. The server decides all movement, eating and respawns.
- `public/game.js`: canvas client. It sends only the steering direction and draws the 15 Hz snapshots it receives, smoothed between updates.
