
# Business Requirement: Project Ingestion (Remote Repos + Server Directory Support)

## Objective
Enable Savant to ingest projects from multiple sources while preserving the existing workflow:

Add Project → AST option → Index option

Supported sources:
- GitHub repository (URL)
- GitLab repository (URL)
- Server directory (local mounted path)

All sources must result in the same outcome:
A local project ready for AST generation and indexing.

---

## Implementation Status (2026-04-22)

Status legend:
- ✅ Implemented
- ⚠️ Implemented with caveats / needs stronger validation
- ❌ Not implemented

### Summary
- Backend ingestion architecture is implemented end-to-end (source discovery, repo/directory ingestion, branch handling, path safety).
- Add Project modal UI has been refactored to source-based flow (GitHub/GitLab/Directory + fallback state).
- Core gap is mainly validation depth and end-to-end UI automation coverage, not missing backend capability.

### Requirement-by-requirement status

1) Add Project multi-source input
- Status: ✅
- Evidence:
  - `GET /api/context/repos/sources` in `server/context/routes.py`
  - `POST /api/context/repos` with `source` payload in `server/context/routes.py`
  - Source-specific ingestion in `server/context/ingestion.py`

2) Source availability rules (env-gated)
- Status: ✅
- Evidence:
  - `get_source_availability()` in `server/context/ingestion.py`
  - UI pulls and renders enabled sources via `_ctxLoadAddSources()` in `client/renderer/static/js/context-core.js`

3) No available sources fallback
- Status: ✅
- Evidence:
  - `_ctxApplyNoSourceFallback()` in `client/renderer/static/js/context-core.js`
  - Submit disabled and required configuration message rendered

4) GitHub/GitLab URL ingestion and auth
- Status: ✅
- Evidence:
  - `ingest_repo()` + provider detection + token selection in `server/context/ingestion.py`
  - Clone-if-missing / pull-if-existing behavior implemented in `_clone_checkout()` / `_update_checkout()`

5) Directory ingestion flow
- Status: ✅
- Evidence:
  - `ingest_directory()` in `server/context/ingestion.py`
  - Enforces relative path + existence + read/execute access + base path containment

6) Directory mounting requirement
- Status: ✅
- Evidence:
  - `BASE_CODE_DIR` is authoritative base path in ingestion logic
  - Works with mounted Docker/K8s volumes when `BASE_CODE_DIR` points to mount root

7) Branch handling
- Status: ✅
- Evidence:
  - Optional branch handling in `ingest_repo()`
  - Explicit branch existence checks (`_ensure_branch_exists`)
  - Default branch detection (`_default_remote_branch`)

8) Post-ingestion state (ready for AST/index)
- Status: ✅
- Evidence:
  - `POST /api/context/repos` only registers project path
  - Existing AST/index endpoints remain unchanged and immediately usable for newly added project

9) UI behavior / conditional rendering
- Status: ✅
- Evidence:
  - Source selector + conditional field visibility in `client/renderer/index.html`
  - `ctxUpdateAddSourceUI()` and source loading in `client/renderer/static/js/context-core.js`
  - Loading state text `Preparing project...` set before submission

10) Error handling clarity
- Status: ⚠️
- Notes:
  - User-facing errors exist for invalid URL, missing branch, path traversal, missing directory.
  - Some errors still come from raw git stderr (sanitized), which may be technical for non-engineering users.

11) Security requirements
- Status: ⚠️
- Notes:
  - Token redaction is present in `_sanitize_git_error()`.
  - Directory traversal protections are implemented (`_assert_under_base`).
  - Remaining risk: authenticated git URL is still used at clone/fetch command runtime; avoid logging command args and add explicit security test coverage.

12) Storage behavior
- Status: ✅
- Evidence:
  - Repos are cloned/updated under `BASE_CODE_DIR/<repo>`
  - Directories are used in place without copy

### Test coverage status
- ✅ Backend ingestion tests added in `server/tests/test_context_repo_ingestion.py`.
- ⚠️ No dedicated client E2E test yet for modal source switching/fallback UX.

---

## Current Behavior (Baseline)

- User selects a local folder
- System immediately enables:
  - AST generation
  - Indexing

---

## New Required Behavior

User can choose one of the following sources when adding a project:

1. GitHub (URL-based)
2. GitLab (URL-based)
3. Directory (server-based path)

After ingestion:
- Project is prepared locally
- AST and Index options are enabled (same as today)

---

## Functional Requirements

### 1. Add Project (Multi-Source Input)

#### Input Modes (Conditional)

Available options must be dynamically shown based on server configuration:

- **GitHub** → Only if `GITHUB_TOKEN` is present
- **GitLab** → Only if `GITLAB_TOKEN` is present
- **Directory** → Only if `BASE_CODE_DIR` is present

---

### 2. Source Availability Rules (CRITICAL)

#### GitHub
- Show option only if:
  - `GITHUB_TOKEN` is defined

#### GitLab
- Show option only if:
  - `GITLAB_TOKEN` is defined

#### Directory
- Show option only if:
  - `BASE_CODE_DIR` is defined

---

### 3. No Available Sources (Fallback Behavior)

If NONE of the following are configured:

- `GITHUB_TOKEN`
- `GITLAB_TOKEN`
- `BASE_CODE_DIR`

Then:

- Do NOT show any source selection options
- Display a message inside the modal:


No project sources are configured.

Please configure at least one of the following:

* GITHUB_TOKEN
* GITLAB_TOKEN
* BASE_CODE_DIR


- Disable submission

---

### 4. GitHub / GitLab Flow (Remote Repositories)

#### Input
- Repository URL (required)
- Branch (optional)

#### Authentication
- Use environment-level tokens:
  - `GITHUB_TOKEN`
  - `GITLAB_TOKEN`

#### Behavior
- Detect provider from URL
- Use correct token automatically
- Clone repository
- If already exists → pull latest changes

---

### 5. Directory Flow (Server-Based)

#### Input
- Directory path (relative to allowed base directory)

#### Configuration
- Base directory must be defined:
  - `BASE_CODE_DIR=/mounted/repos`

#### Behavior
- Resolve path:
  - `BASE_CODE_DIR + user_input_path`
- Validate:
  - Directory exists
  - Path stays within base directory

---

### 6. Directory Mounting (Deployment Requirement)

- Local codebase may be mounted into Docker container
- Mounted directory must match `BASE_CODE_DIR`
- System must treat mounted directories as valid project sources

---

### 7. Branch Handling (Repo Only)

#### Behavior
- If branch is provided:
  - Checkout that branch
  - Fail if not found

- If branch is not provided:
  - Detect default branch automatically

---

### 8. Post-Ingestion State

After project is ready (repo or directory):

- Treat project exactly like a local project
- Enable:
  - AST generation
  - Indexing

No changes to AST or indexing logic

---

### 9. UI Behavior

#### Add Project Modal

Show only the source options that are enabled via environment variables.

---

#### Conditional Rendering Summary

| Feature   | Env Required     | Show in UI |
|----------|------------------|-----------|
| GitHub   | GITHUB_TOKEN     | Yes/No    |
| GitLab   | GITLAB_TOKEN     | Yes/No    |
| Directory| BASE_CODE_DIR    | Yes/No    |

---

#### If GitHub / GitLab selected:
- Show:
  - Repo URL
  - Optional Branch

---

#### If Directory selected:
- Show:
  - Directory path input (relative to base)

---

#### After submission

- Show loading state:
  - "Preparing project..."

- On success:
  - Enable AST and Index options

- On failure:
  - Show clear error message

---

### 10. Error Handling

System must handle:

#### Repo Errors
- Invalid URL
- Authentication failure
- Repo not found
- Branch not found
- Clone failure

#### Directory Errors
- Path outside allowed base directory
- Directory does not exist
- Permission issues

All errors must be:
- Clear
- User-readable
- Non-technical where possible

---

### 11. Security Requirements

- Tokens must:
  - Be stored in environment variables only
  - Never be logged
  - Never be exposed in API responses

- Directory access must:
  - Be restricted to `BASE_CODE_DIR`
  - Prevent path traversal (e.g., `../` attacks)

---

### 12. Storage Behavior

#### Repositories
- Stored locally on server
- Reused if already cloned

#### Directories
- Used in-place (no copying required)

---

## Non-Functional Requirements

### Simplicity
- No OAuth
- No user login
- Minimal configuration

### Portability
- Must work in:
  - Local environments
  - Docker (with mounted volumes)
  - Cloud deployments

### Compatibility
- Must not change AST or indexing workflows

---

## Success Criteria

- UI only shows valid ingestion options
- User can add project from any available source
- Repo or directory is prepared correctly
- AST and Index options appear immediately
- AST and Index execute successfully

---

## Out of Scope

- OAuth / Git provider login
- Repo browsing or listing
- Nightly processing
- Multi-user authentication

---

## Final Note

This is a unified ingestion system:

- Remote repos → cloned locally
- Directories → accessed via mounted path

System must strictly respect environment configuration when exposing capabilities.

The system’s responsibility ends at:
"Provide a valid project path ready for AST and indexing"


