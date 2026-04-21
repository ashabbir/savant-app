# AGENTS.md

Repository-wide agent guidance is centralized in [AGENTIC.md](./AGENTIC.md).

## Required
- Treat `AGENTIC.md` as the canonical source for architecture, boundaries, coding methodology, install/run/test/build/deploy instructions, and documentation rules.
- Keep client/server separation strict: client owns UI/runtime surfaces; server owns API/MCP/data.

## This File
- Keep `AGENTS.md` minimal and stable.
- Put shared guidance changes in `AGENTIC.md`, then reference from agent-specific files.
