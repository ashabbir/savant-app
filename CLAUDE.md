# CLAUDE.md

Claude-specific guidance for this repository.

## Canonical Guidance
- Use [AGENTIC.md](./AGENTIC.md) as the source of truth for:
  - architecture and ownership boundaries
  - install/run/test/build/deploy instructions
  - coding methodology and quality gates

## Claude Notes
- Prefer minimal-diff edits that follow existing module style.
- Keep server changes API/MCP/data focused; do not introduce server-side UI ownership.
