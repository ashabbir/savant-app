# Savant Server

`savant-server` is the centralized backend service for enterprise deployments.

## Phase 1 Status

Phase 1 introduces a true client/server runtime split:

- `savant-app` (Electron) runs on user machines.
- `savant-server` runs in customer infrastructure.
- App connects to one configured server URL (`SAVANT_SERVER_URL` or local client preference).
- When server is unavailable, app stays usable for local agent workflows and queues API mutations locally.

This directory is now the standalone backend service.

## Run Server (Current Backend)

```bash
cd server
pip install -r requirements.txt
python app.py
```

By default it serves at `http://127.0.0.1:8090`.

## Persistent Data (Docker / K8s)

Set one mount-backed directory for server data:

- `SAVANT_SERVER_DATA_DIR`

The server stores both in that path:
- SQLite DB: `savant.db`
- Abilities store: `abilities/...`

On first startup, if abilities are missing, server auto-seeds them from repo seed assets.

## Client Connection

Set server URL before launching Electron:

```bash
SAVANT_SERVER_URL=http://your-server:8090 npm run dev
```

The client persists the configured server URL locally and reuses it on restart.

## Next Step (Post-Phase 1)

Migrate this folder into a standalone scalable backend implementation (FastAPI + Postgres + Redis workers), while preserving API compatibility for `savant-app`.
