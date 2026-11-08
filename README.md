# GameVerse

**One Universe. Endless Games.**

GameVerse is a browser-based multiplayer game portal: players choose a game, create or join rooms, and play together.

## Current prototype

- Lightweight responsive arcade-style interface.
- Nickname entry without account registration.
- Public room list and private room codes.
- Lobby and room chat using WebSocket.
- Multiplayer Caro (2 players).
- Multiplayer Nối Từ (up to 6 players).

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Current architecture

- `index.html`: browser UI and game clients.
- `server.js`: Node.js HTTP server, WebSocket lobby, rooms, chat, and game validation.
- `package.json`: Node.js dependencies and start command.

## Roadmap

1. Improve game discovery, room creation, and mobile usability.
2. Add persistent player accounts, profiles, friends, and moderation.
3. Add more multiplayer games and shared game services.
4. Add persistent storage for player data, rankings, and chat policies.
5. Add automated tests, deployment checks, and operational monitoring.

This is an early prototype. Nicknames and room state are currently in-memory/local browser storage; they are not persistent accounts. Chat is not yet moderated or stored. Do not use this prototype for sensitive information.
