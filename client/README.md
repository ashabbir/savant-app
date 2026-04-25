# Savant Client

Electron desktop client for Savant.

## Responsibilities

- local desktop UX
- local agent runtime + terminal
- local SQLite preferences
- offline mutation queue and replay
- communicates with `savant-server` over HTTP/SSE

## Run

```bash
cd client
npm install
SAVANT_SERVER_URL=http://127.0.0.1:8090 npm run dev
```

## Test

```bash
cd client
npm test
npm run test:coverage
```
