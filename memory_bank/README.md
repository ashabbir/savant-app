# Savant Memory Bank

This directory is the RAG-oriented architecture reference for the `savant-app` repository.

Contents:

- `architecture-overview.md`: System boundaries, major subsystems, storage model, and startup behavior.
- `runtime-and-data-flow.md`: End-to-end runtime flows for Electron, Flask, MCP, terminal, sessions, context indexing, and knowledge graph usage.
- `environment-reference.md`: Indexed environment-variable reference for all runtime knobs found in the codebase.
- `file-index.md`: Indexed file-by-file repository inventory with short descriptions for each relevant tracked file.

RAG usage notes:

- Start with `architecture-overview.md` for system shape.
- Use `runtime-and-data-flow.md` for request and process behavior.
- Use `environment-reference.md` when an agent needs deployment or session-detection context.
- Use `file-index.md` as the primary lookup table for where behavior lives.
