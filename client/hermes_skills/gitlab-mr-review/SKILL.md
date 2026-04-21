---
name: gitlab-mr-review
description: Review GitLab MRs with full Savant workspace integration — Jira tracking, MR registration, session notes, knowledge graph updates, and structured review output. Use when reviewing GitLab merge requests in a Savant-managed workspace.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [GitLab, Code-Review, Merge-Requests, Savant, Jira, ZIO, Scala]
    related_skills: [github-code-review, requesting-code-review]
---

# Savant-Integrated GitLab MR Review

End-to-end workflow for reviewing GitLab merge requests with full Savant workspace tracking. Ensures every review is traceable: Jira ticket registered, MR tracked, session notes saved, and knowledge graph updated.

## When to Use

- User asks to review a GitLab MR (e.g., "review MR !3228" or "review PROJ-1234")
- Working in a Savant-managed workspace (persona.reviewer or similar)
- Reviewing code on GitLab (not GitHub — use github-code-review for that)

## Prerequisites

- Inside a git repository with GitLab remote
- Savant MCP tools available (savant-workspace, savant-knowledge)
- Reviewer persona resolved (optional but recommended)

---

## Step 1: Detect Session & Workspace

Session auto-detection often fails. Use the filesystem fallback:

```bash
# Find current session ID from .savant-meta (most recently modified)
ls -lt ~/.hermes/.savant-meta/ | head -5

# Read session metadata to get workspace ID
cat ~/.hermes/.savant-meta/<session_id>.json
# Returns: {"workspace": "<workspace_id>", "starred": false, "archived": false}
```

Alternative: check ~/.hermes/sessions/ for full session files sorted by modification time.

**Save these for use throughout the review:**
- SESSION_ID: e.g., `20260415_144135_5e24ce`
- WORKSPACE_ID: e.g., `1773062826261`

If no workspace exists, create one:
```
mcp_savant_workspace_create_workspace(name="<Repo> Reviews")
mcp_savant_workspace_assign_session_to_workspace(workspace_id=<id>, session_id=<id>)
```

---

## Step 2: Register Jira Ticket & MR to Session (DO THIS FIRST)

**Critical: Always register both before starting analysis.** This was a user-requested requirement.

### Register Jira ticket:
```
mcp_savant_workspace_create_jira_ticket(
    ticket_key="PROJ-1234",
    title="<MR title>",
    status="in-review",
    workspace_id="<workspace_id>"
)
```

### Register GitLab MR:
```
mcp_savant_workspace_create_merge_request(
    url="https://gitlab.com/<namespace>/<project>/-/merge_requests/<iid>",
    title="<MR title>",
    status="review",
    jira="PROJ-1234",
    workspace_id="<workspace_id>"
)
```

### Assign both to session:
```
mcp_savant_workspace_assign_jira_to_session(ticket_id=<id>, session_id=<session_id>, role="reviewer")
mcp_savant_workspace_assign_mr_to_session(mr_id=<id>, session_id=<session_id>, role="reviewer")
```

### Common GitLab URL patterns (from policy.savant-workspace):
| Repo | GitLab Path |
|------|------------|
| repo-a | <gitlab-group>/services/repo-a |
| repo-b | <gitlab-group>/repo-b-development/repo-b |
| repo-c | <gitlab-group>/services/repo-c |
| repo-d | <gitlab-group>/services/repo-d |

---

## Step 3: Fetch the MR Branch

GitLab uses a different refspec than GitHub:

```bash
# GitLab MR fetch (NOT the same as GitHub PR fetch)
git fetch origin merge-requests/<iid>/head:mr-<iid>

# Find the merge base for accurate diff
MERGE_BASE=$(git merge-base master mr-<iid>)

# Get the diff
git diff $MERGE_BASE mr-<iid> --stat
git diff $MERGE_BASE mr-<iid>
```

**Pitfall:** Use `master` or `main` depending on the repo's default branch. Check with `git symbolic-ref refs/remotes/origin/HEAD`.

---

## Step 4: Understand Existing Codebase Patterns

Before reviewing new code, check what patterns already exist. This catches duplication and style deviations.

```bash
# Find existing models/types that might be duplicated
find . -name "*.scala" -path "*/main/*" | head -30

# Check if new dependencies are already available
cat <new-module>/pom.xml | grep -A2 "<dependency>"

# Look at existing implementations for the same pattern
# e.g., if reviewing a new HTTP client, find existing clients:
find . -name "*Client.scala" -path "*/main/*"
```

**Key insight:** Compare ZLayer construction, error handling, and domain model patterns against existing code. New developers often copy-paste models instead of reusing existing ones.

### 4a. Domain Model Duplication Audit

When an MR introduces new domain model files (case classes, enums, sealed traits), run a systematic duplication check. This is critical for monorepos where types already exist in shared libraries.

**Approach:** For each new model file, grep the entire repo for existing definitions of the same type name:

```bash
# For each model name (e.g., "Page", "NetworkView"):
grep -rl "\(class\|trait\|object\|type\) ModelName[^A-Za-z0-9]" --include="*.scala" . \
  | grep -v "/target/" \
  | grep -v "<new-module-path>/"
```

**Use `execute_code` for batch processing** — loop over all new model names, collect matches, filter out target dirs and the MR's own files. This is much faster than running individual terminal commands.

**Ranking canonical sources** — When multiple matches exist, pick the most authoritative:
1. Shared libraries (e.g., `lib-repo-a-common`, `om-repo-a`) — true canonical source
2. Common utility libs (e.g., `lib-users-common`) — shared types
3. Service-specific files (e.g., `lib-users-resteasy/NetworksMessage.scala`) — inner types in message files
4. Migrations/tests — secondary references, not canonical

**Output format** — Present as a markdown table in the review file:

| #  | Model | New Path | Existing Path | Source Module |
|----|-------|----------|---------------|---------------|

Plus summary tables: "duplication by source module" and "new/unique files" (expected for the actual client/service code).

**Include the table in the review.md** directly under the duplication finding (Critical #1) as evidence. Update the finding's file count from approximate ("30+") to exact ("36 of 39").

---

## Step 5: Perform the Review

### Review checklist (from persona.reviewer):
1. **Correctness & safety** — null/edge cases, concurrency, error handling
2. **Security** — input validation, secrets, authz/authn
3. **Readability & maintainability** — naming, structure, duplication
4. **Performance** — N+1, hot paths, allocations
5. **Tests** — coverage of critical paths, negative cases
6. **Convention alignment** — matches repo's existing patterns

### Severity levels:
- **CRITICAL** — Must fix before merge (security, data loss, broken functionality, massive duplication)
- **WARNING** — Should fix (inconsistency, missing error handling, deviation from patterns)
- **SUGGESTION** — Nice to have (style, documentation, optimization)

### For new developers:
- Extra scrutiny on pattern adherence
- Compare against existing implementations explicitly
- Check for unnecessary model/type duplication
- Verify ZLayer/DI patterns match codebase conventions

---

## Step 6: Save Review Artifacts

### 6a. Save review file to repo:

**Convention:** `{repo-root}/code-reviews/{JIRA-TICKET}/review.md`

```bash
mkdir -p code-reviews/<JIRA-ID>/
# Write review.md — use write_file for initial creation, patch for updates
```

**Iterative enrichment process:** Create the review file with all findings first (even if some lack exact line numbers), then do targeted grep/analysis to fill in precise file paths, line numbers, and code snippets. Use `patch` to update each finding individually. This is faster than trying to collect all details upfront.

**Links section at bottom of review.md:**
```markdown
---
**Links:**
- Jira: https://<your-jira-domain>/browse/<JIRA-ID>
- GitLab MR: https://gitlab.com/<namespace>/<project>/-/merge_requests/<iid>
- Savant Workspace: http://<savant-host>:<port>/workspaces/<workspace_id>
```

### 6b. Create session note with review summary:
```
mcp_savant_workspace_create_session_note(
    session_id="<session_id>",
    text="## Code Review: MR !<iid> — <JIRA-ID>\n\n**Verdict: CHANGES REQUESTED / APPROVED**\n\n### CRITICAL (N)\n...\n### WARNINGS (N)\n...\n### SUGGESTIONS (N)\n...\n### POSITIVES\n..."
)
```

### 6c. Create/complete review task:
```
mcp_savant_workspace_create_task(
    title="Review MR !<iid> — <JIRA-ID>",
    status="in-progress",
    workspace_id="<workspace_id>"
)
# After review is complete:
mcp_savant_workspace_complete_task(task_id=<id>)
```

### 6d. Store in knowledge graph:
```
mcp_savant_knowledge_store(
    workspace_id="<workspace_id>",
    title="Review: MR !<iid> — <JIRA-ID>",
    content="<review summary with key findings>",
    node_type="session",
    source="session"
)
```

---

## Step 7: Review Output Format

**Every finding (critical, warning, suggestion) MUST include:**
- **File:** exact path relative to repo root
- **Lines:** specific line numbers (e.g., L34, L111-115)
- **Code snippet** for criticals — inline the problematic code with line references
- **Reference file** when comparing against existing patterns — show both side-by-side

```markdown
## Code Review: MR !<iid> — <JIRA-ID> — <Title>

**Verdict: CHANGES REQUESTED | APPROVED | COMMENT**
**Reviewer:** AI Code Review (Hermes)
**Date:** <YYYY-MM-DD>
**Branch:** mr-<iid>
**Merge Base:** <sha>
**Files Changed:** N (+M lines)

<One-line summary of what the MR does and review context>

---

### CRITICAL (N)

#### 1. Issue title
**Severity:** Critical — <category>
**File:** `path/to/file.scala`
**Lines:** L34 (import), L144-147 (companion object)

```scala
// L144-147 — problematic code
<code snippet>
```

Description of the issue and why it matters.

**Recommendation:** What to do instead.

### WARNINGS (N)

1. **Issue title** (context: N lines vs M lines original)
   - MR: `path/to/new/file.scala` (N lines)
   - Existing: `path/to/existing/file.scala` (M lines)

### SUGGESTIONS (N)

1. **Suggestion title** — Description.
   - Affects: `path/to/file.scala` L14-21
   - Reference: `path/to/reference.scala` L35-39

### POSITIVES

- What's done well (always include this — especially for new developers)
```

**Key: The user expects findings to be directly navigable. "Missing tests" must say WHERE the test directory should be. "Wrong pattern" must show BOTH the wrong code and the reference implementation with exact lines."**

---

## Pitfalls

1. **Session auto-detection fails** — Always have the filesystem fallback ready (`~/.hermes/.savant-meta/`)
2. **assign_jira_to_session / assign_mr_to_session may 404** — The registration (create_jira_ticket / create_merge_request) still works. Assignment is best-effort.
3. **GitLab MR refspec is different from GitHub** — `merge-requests/<iid>/head` not `pull/<number>/head`
4. **Use merge-base for diffs** — `git diff master mr-<iid>` shows too much; `git diff $(git merge-base master mr-<iid>) mr-<iid>` shows only MR changes
5. **Don't forget to register Jira + MR before analysis** — User expectation, now also a learned rule on persona.reviewer
6. **add_mr_note may 404** — Known issue; use session notes as the reliable alternative for persisting review text
