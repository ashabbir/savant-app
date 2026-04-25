# GEMINI.md

Gemini-specific guidance for this repository.

## Canonical Guidance
- Use [AGENTIC.md](./AGENTIC.md) as the source of truth for:
  - architecture and ownership boundaries
  - install/run/test/build/deploy instructions
  - coding methodology and quality gates

## Gemini Notes
- Keep changes aligned with split deployment goals (`savant-app` client + `savant-server` backend).
- Maintain API contract stability when touching server endpoints used by client renderer modules.
