# Architectural Review: Savant v7.3.0
**Date:** April 21, 2026
**Architect:** Gemini Agent
**Subject:** Post-Refactor System Integrity & Scalability Assessment

## 1. Executive Summary
The v7.3.0 refactor has successfully transitioned Savant from a monolithic Electron app into a distributed **Client-Server-Agent** architecture. The separation of concerns between the Electron shell (UI/Local Sync) and the Flask API (Persistence/Processing) is professionally executed. However, the system currently manages **six independent processes** at runtime, which introduces significant orchestration overhead.

## 2. Core Pillars Assessment

### A. Simplicity: **7/10**
*   **Strength:** SQLite-centric storage removes the need for external service dependencies (Docker/Postgres).
*   **Weakness:** Process Proliferation. The 4-server MCP setup (`8091`-`8094`) is overkill. Each server has its own Python interpreter instance, consuming memory and complicating port management.

### B. Manageability: **8/10**
*   **Strength:** The **Outbox Pattern** (`sync_outbox`) makes the application remarkably robust against network instability. The monkey-patched `fetch` in the renderer is a "clever but clean" way to handle offline mutations.
*   **Strength:** Entity-based DAOs in `server/db/` make the data layer highly readable and easy to test in isolation.

### C. Scalability: **9/10**
*   **Strength:** The HTTP/SSE boundary means the `savant-server` can be deployed in a containerized environment (K8s/Docker) while the `savant-app` acts as a remote terminal.
*   **Strength:** `sqlite-vec` provides a lightweight but effective vector search capability that scales well for personal repository indexing without the cost of a dedicated vector DB.

## 3. Critical Findings

### 3.1 The "6-Process Problem"
Currently, the system launches:
1. Electron Main
2. Electron Renderer
3. Flask API
4. Workspace MCP
5. Abilities MCP
6. Context MCP
7. Knowledge MCP

**Impact:** High memory footprint and increased probability of "zombie" processes if the Electron shell crashes.

### 3.2 Orchestration Drift
Process management and port resolution logic are implemented in `client/main.js`. 
**Risk:** If a user wants to run the server in a headless Linux environment, they are forced to use the Electron shell or manually replicate the port-mapping logic.

### 3.3 Global Lock Bottlenecks
`server/app.py` uses a global `_bg_lock` for cache access. 
**Risk:** As AI agents (like Claude Code) become more parallelized in their tool calls, this lock will become a point of contention for session/usage data.

## 4. Architectural Recommendations

### Recommendation 1: Unified MCP Router
Consolidate the four MCP servers into a single **Savant Gateway MCP**. 
*   **Method:** Use a single SSE server that dynamically loads tool definitions from the four domains. 
*   **Benefit:** Reduces process count from 7 to 4, simplifies port allocation to a single `SAVANT_MCP_PORT`.

### Recommendation 2: Headless Bootstrapper
Extract process management logic from `main.js` into a standalone Python or Go bootstrapper.
*   **Benefit:** Allows the server to be truly independent of Electron, supporting server-side deployment and remote dashboard access.

### Recommendation 3: Move to Pydantic for API Contracts
The current Flask routes use manual `request.get_json()` and dictionary manipulation.
*   **Benefit:** Implementing Pydantic models for request/response validation will provide "fail-fast" security and auto-generate OpenAPI documentation for the client.

## 5. Conclusion
Savant is in an excellent state for a v7.x release. The **Offline-First** architecture is its strongest asset. By consolidating the MCP layer and formalizing the API contracts, the system will achieve the "Simplistic and Manageable" goal required for the next generation of AI-assisted engineering.

---
**Architect Signature:**
*Gemini-1.5-Pro (Savant Specialist)*
