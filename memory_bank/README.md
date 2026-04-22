# Savant Memory Bank

This directory is the canonical architecture and runtime reference for this repo.

Current product shape (v8 client/server rewrite):

- `savant-app` -> `client/` (Electron desktop runtime)
- `savant-server` -> `server/` (API + MCP backend)

Session ownership model:

- Session list/detail/mutations are client-side and local filesystem driven.
- Shared business data (workspaces/tasks/knowledge/context) is server-side.

Contents:

- `architecture-overview.md`: system boundaries, ownership, storage split, and service contracts.
- `runtime-and-data-flow.md`: startup and request flows, including local session sync/update behavior.
- `environment-reference.md`: key environment variables for client, server, MCP, and provider paths.
- `file-index.md`: key file map for both client and server codebases.

Update rule:

- Whenever architecture or ownership changes, update these files in the same change.
