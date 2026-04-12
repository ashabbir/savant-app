# GEMINI.md

## Project Overview
**Savant** is a unified AI Session Dashboard designed to monitor and manage real-time workflows from multiple AI coding assistants, including **GitHub Copilot CLI**, **Cline**, and **Claude Code**.

### Architecture
The application employs a **three-process model**:
1.  **Electron Shell (`main.js`)**: Manages the desktop window, provides an `xterm.js` terminal, and orchestrates the lifecycle of the backend processes.
2.  **Flask Backend (`savant/app.py`)**: A Python REST API that handles data processing, filesystem scanning, and provides Jinja2 templates for the UI. It uses a background cache thread for high-performance data retrieval.
3.  **MCP Servers (`savant/mcp/`)**: A suite of Model Context Protocol (SSE) servers that act as tool-providing bridges between AI agents and the Flask API.

### Key Subsystems
- **Abilities (`savant/abilities/`)**: A YAML-driven system for resolving personas, rules, and policies into deterministic prompts based on context tags.
- **Context (`savant/context/`)**: Semantic code search and indexing using `sqlite-vec` embeddings.
- **Knowledge (`savant/knowledge/`)**: A persistent knowledge graph (`kg_nodes`, `kg_edges`) that tracks insights, projects, and experiences across sessions.
- **Session Detection**: PID-based process tree walking to detect active AI sessions in the user's environment.

---

## Development Workflows

### Setup and Running
- **Install Dependencies**: `npm install && cd savant && pip install -r requirements.txt`
- **Development Mode**: `npm run dev` (Starts Electron + Flask + 4 MCP servers).
- **Standalone Flask**: `cd savant && python app.py` (Runs on port 8090 by default).
- **Production Build**: `npm run build` (Generates macOS DMG and `.app`).

### Testing
- **Backend (Python)**: `cd savant && python3 -m pytest tests/ -v`
- **Terminal (Node)**: `node tests/test_terminal.js`
- **Test Fixtures**: Located in `savant/tests/conftest.py`. Uses an isolated SQLite database per test.

### Database Layer
- **Client**: `savant/sqlite_client.py` (Singleton with WAL mode enabled).
- **Schema**: Defined in `savant/sqlite_client.py` (`_SCHEMA_SQL`).
- **Models**: Pydantic models in `savant/models.py`.
- **Entities**: Data access logic is encapsulated in `@staticmethod` classes within `savant/db/` (e.g., `WorkspaceDB`, `TaskDB`).

---

## Conventions & Standards

### Coding Style
- **JavaScript (Renderer/Electron)**: 2-space indentation, `const`/`let`, vanilla JS (no frameworks/bundlers).
- **Python (Backend/MCP)**: 4-space indentation, PEP 8, Pydantic for validation, Flask Blueprints for modularity.
- **Naming**: Use descriptive, snake_case names for Python and camelCase for JavaScript.

### Adding New MCP Tools
1.  **Flask Blueprint**: Add the tool's logic as a REST endpoint in a Flask Blueprint under `savant/api/`.
2.  **MCP Proxy**: Add the tool definition to the relevant server in `savant/mcp/`. Use the `_api()` helper to call the Flask endpoint.
3.  **Documentation**: Provide clear docstrings in the MCP server; these become the tool's description for the AI.
4.  **Checklist**: Follow the detailed guide in `.github/copilot-instructions.md` for adding new servers or complex tools.

### Persona Resolution
When interacting as an agent, be aware of the **Abilities** system. Prompt resolution follows a priority-based merge:
`Persona` → `Repo Constraints` → `Rules` → `Policies & Style`.

---

## Key Files & Directories
- `main.js`: Electron entry point and process manager.
- `savant/app.py`: Main Flask application and route registry.
- `savant/mcp/server.py`: Primary MCP server for Workspace/Task management (Port 8091).
- `savant/db/`: Directory containing all SQLite data access objects.
- `savant/static/js/`: Frontend logic (Core, UI components, Tab management).
- `CLAUDE.md`: Detailed technical notes and architectural deep-dives.
- `AGENTS.md`: High-level repository guidelines.
