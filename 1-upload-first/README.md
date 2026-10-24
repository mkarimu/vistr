# Vistr game server

The Vistr word game server and web app, set up for Render (render.com).

- `server/` the game server (Node.js, no dependencies)
- `client/` the game itself, plus About, How to play, Privacy, Terms, Contact and Reviews pages
- `render.yaml` tells Render how to run it

Deploy: Render -> New -> Blueprint -> pick this repository -> Apply.
Check: open `https://<your-service>.onrender.com/api/health`.
Admin (messages, reviews): `https://<your-service>.onrender.com/admin.html`, key = ADMIN_KEY in Render -> Environment.

Mkarimu Media
