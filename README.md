# ⚡ Arena Rush

A real-time multiplayer .io-style battle game — grow your snake by eating orbs, boost past rivals, and crash into others to burst them into orbs. Built with Node.js, Express, and Socket.io.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a browser. Open a second tab (or share your local IP on your network) to test multiplayer — 6 bots auto-fill the arena so it's fun solo too.

## Controls

- **Mouse** — steer
- **Hold Space** — boost (costs length)

## How it works

- `server.js` — authoritative game loop (30 ticks/sec), spatial-grid collision detection, bot AI, orb spawning
- `public/client.js` — Canvas rendering, camera follow, minimap, leaderboard, input handling
- All physics/collisions run server-side so the game can't be cheated from the client

## Ideas to extend

- Add a kill-cam / "eliminated by X" message
- Skins or trail patterns unlocked by score
- Room/lobby system for private matches
- Mobile touch controls (joystick)
- Persist high scores with a small DB
