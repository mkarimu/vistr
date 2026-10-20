# Vistr game server

The Vistr word game server and web app, set up for Render (render.com).

- `server/` the game server (Node.js, no dependencies)
- `client/` the game itself, plus About, How to play, Privacy, Terms, Contact and Reviews pages
- `render.yaml` tells Render how to run it

Deploy: Render -> New -> Blueprint -> pick this repository -> Apply.
Check: open `https://<your-service>.onrender.com/api/health`.
Admin (messages, reviews): `https://<your-service>.onrender.com/admin.html`, key = ADMIN_KEY in Render -> Environment.

Mkarimu Media

## Bots (the Memoryq SuperAgent)

Nobody waits alone: a player who is online, available and not playing gets a bot partner
after about 20 seconds. The bot sends a normal play request (shown as "Player 12 🤖 Bot"),
plays at a human pace with the odd mistake, and never goes on the score boards. Each lone
player gets their own bot. When the player quits, their bot waits 2 hours in case they come
back, then it is removed. A "no" is not asked again for 10 minutes.

- Settings (environment): `VISTR_BOTS=off`, `BOT_WAIT_SECONDS` (20), `BOT_LINGER_HOURS` (2),
  `BOT_MAX` (50), `BOT_MISTAKES` (0.12).
- Status for the Memoryq SuperAgent: `GET /api/agent/status` (counts only).
- Test: `npm run test:bots`.

