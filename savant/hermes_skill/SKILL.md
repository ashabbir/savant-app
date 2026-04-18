---
name: platform
description: >-
  Comprehensive guide to using the Savant platform via MCP — abilities (personas, rules, repos),
  workspaces (tasks, Jira, MRs, sessions), knowledge graph (nodes, edges, search),
  and context (semantic code search, memory bank). Load this skill whenever interacting
  with Savant MCP tools.
version: 1.0.0
author: Savant
license: MIT
metadata:
  hermes:
    tags: [Savant, MCP, Workspaces, Knowledge-Graph, Abilities, Context, Code-Search]
    related_skills: [savant-gitlab-mr-review]
---

# Savant MCP Platform

Savant provides four MCP servers that give AI agents deep integration with project management,
knowledge graphs, code intelligence, and configurable AI personas. This skill covers all four.

## When to Use

- Any task involving Savant workspaces, tasks, Jira tickets, or merge request tracking
- When you need to search code semantically or query the memory bank
- When storing or retrieving knowledge graph nodes (insights, decisions, architecture)
- When resolving abilities (persona + rules + repo context) for a session
- When reviewing code, managing sessions, or doing project work at your organization

---

## Architecture Overview

Savant runs 4 MCP SSE servers (default ports):

| Server | Port | Purpose |
|--------|------|---------|
| savant-workspace | 8091 | Workspaces, tasks, Jira, MRs, sessions |
| savant-abilities | 8092 | Personas, rules, policies, repos, resolve |
| savant-context | 8093 | Semantic code search, memory bank |
| savant-knowledge | 8094 | Knowledge graph CRUD, search, traverse |

All servers connect via SSE transport at `http://127.0.0.1:<port>/sse`.

---

## 1. Abilities (savant-abilities)

The abilities system builds deterministic system prompts from composable assets:
personas, rules, policies, and repo overlays.

### Core Concepts

- **Persona**: Defines who the AI is (e.g., engineer, reviewer, product, architect, mentor, support)
- **Rules**: Tagged behavior rules loaded by persona tags (e.g., backend.base, code-review.base)
- **Policies**: Style/process guidelines (e.g., planning, testing, mermaid, savant-workspace)
- **Repos**: Repository-specific context overlays (e.g., repo-b, repo-a, repo-e, repo-d)

### Key Tools

**resolve_abilities(persona, repo_id?, tags?)** — The main entry point. Resolves a persona
plus all matching tagged rules into a single prompt. Add repo_id for repo-specific context.

```
mcp_savant_abilities_resolve_abilities(persona="reviewer", repo_id="repo-a")
mcp_savant_abilities_resolve_abilities(persona="product")
mcp_savant_abilities_resolve_abilities(persona="engineer", repo_id="repo-e", tags=["backend", "testing"])
```

**list_personas / list_rules / list_repos / list_policies** — Discovery tools to see
what's available.

**read_asset(asset_id)** — Read the full content of any asset. Asset IDs follow the
pattern `<type>.<category>.<name>` (e.g., `rules.backend.base`, `persona.reviewer`).

**create_asset / update_asset** — Create or modify abilities assets.

**learn(asset_id, content)** — Append knowledge to an asset's `## Learned` section.
Use this to evolve rules based on session discoveries.

### Available Personas
- persona.architect — System design and architecture
- persona.engineer — Implementation and coding
- persona.mentor — Teaching and guidance
- persona.product — Product management and analysis
- persona.reviewer — Code review
- persona.support — Customer/technical support

### Available Repos
Use `list_repos` to discover currently available repositories in your environment.

---

## 2. Workspaces (savant-workspace)

Workspaces are the central project tracking hub — they group tasks, Jira tickets,
merge requests, and AI sessions together.

### Workspace Lifecycle

```
# Create workspace
mcp_savant_workspace_create_workspace(name="Feature X", priority="high")

# Assign current AI session to it
mcp_savant_workspace_assign_session_to_workspace(workspace_id="<id>")

# Auto-detect current workspace (uses process tree / session metadata)
mcp_savant_workspace_get_current_workspace()

# List all open workspaces
mcp_savant_workspace_list_workspaces(status="open")

# Close when done
mcp_savant_workspace_close_workspace(workspace_id="<id>")
```

### Tasks

Tasks are scoped to a workspace with priority ordering.

```
# Create task
mcp_savant_workspace_create_task(
    title="Implement auth flow",
    description="Add OAuth2 PKCE flow",
    priority="high",        # critical, high, medium, low
    status="todo"           # todo, in-progress, done, blocked
)

# Get next actionable task (highest priority todo/in-progress)
mcp_savant_workspace_get_next_task()

# List tasks (default: current workspace, all statuses)
mcp_savant_workspace_list_tasks(status="todo", date="2025-01-15")

# Update task
mcp_savant_workspace_update_task(task_id="<id>", status="in-progress")

# Complete task
mcp_savant_workspace_complete_task(task_id="<id>")

# Task dependencies
mcp_savant_workspace_add_task_dependency(task_id="<id>", depends_on="<other_id>")
```

### Jira Integration

Register and track Jira tickets within workspaces.

```
# Register a Jira ticket
mcp_savant_workspace_create_jira_ticket(
    ticket_key="PROJ-1234",
    title="Fix login timeout",
    status="in-progress",       # todo, in-progress, in-review, done, blocked
    workspace_id="<id>"
)

# Assign ticket to current session
mcp_savant_workspace_assign_jira_to_session(ticket_id="<id>", role="assignee")

# Add notes to tickets
mcp_savant_workspace_add_jira_note(ticket_id="<id>", text="Root cause identified: ...")

# List and filter
mcp_savant_workspace_list_jira_tickets(status="in-progress")
```

### Merge Request Tracking

Register GitLab MRs with full metadata.

```
# Register MR
mcp_savant_workspace_create_merge_request(
    url="https://gitlab.com/<gitlab-group>/services/repo-a/-/merge_requests/3228",
    title="Add network validation",
    status="review",            # draft, open, review, reviewing, approved, merged, closed, on-hold
    jira="PROJ-1234"
)

# Assign to session
mcp_savant_workspace_assign_mr_to_session(mr_id="<id>", role="reviewer")

# Add notes
mcp_savant_workspace_add_mr_note(mr_id="<id>", text="Reviewed — changes requested")
```

### Common GitLab URL Patterns

| Repo | GitLab Path |
|------|------------|
| repo-a | <gitlab-group>/services/repo-a |
| repo-b | <gitlab-group>/repo-b-development/repo-b |
| repo-c | <gitlab-group>/services/repo-c |
| repo-d | <gitlab-group>/services/repo-d |
| repo-e | <gitlab-group>/services/repo-e |

### Session Notes

```
# Create a session note (persisted in Savant dashboard)
mcp_savant_workspace_create_session_note(text="Started investigating PROJ-1234")

# List notes for current session
mcp_savant_workspace_list_session_notes()

# Delete a note by index
mcp_savant_workspace_delete_session_note(index=0)
```

### Session Detection Fallback

Auto-detection sometimes fails. Use filesystem fallback:

```bash
# Find current session ID from .savant-meta (most recently modified)
ls -lt ~/.hermes/.savant-meta/ | head -5
cat ~/.hermes/.savant-meta/<session_id>.json
# Returns: {"workspace": "<workspace_id>", "starred": false, "archived": false}
```

---

## 3. Knowledge Graph (savant-knowledge)

A persistent graph database for storing architectural decisions, insights,
patterns, and technical knowledge. Nodes are connected by typed edges.

### Node Types
insight, client, domain, service, library, technology, project, concept,
repo, session, issue

### Edge Types
relates_to, learned_from, applies_to, uses, evolved_from, contributed_to,
part_of, integrates_with, depends_on, built_with

### Storing Knowledge

Nodes are created as **staged** and must be committed to be visible.

```
# Store a node (staged)
mcp_savant_knowledge_store(
    workspace_id="<id>",
    title="Auth service uses Redis for session caching",
    content="The auth service stores JWT refresh tokens in Redis with 24h TTL...",
    node_type="insight",        # See node types above
    graph_type="technical",     # business, technical, operational, onboarding, or custom
    source="session",           # session, task, note
    repo="repo-a",
    files="app/services/auth.rb,config/redis.yml",
    connections='[{"node_id":"kgn_abc","edge_type":"applies_to"}]'
)

# Commit staged nodes (makes them visible)
mcp_savant_knowledge_commit_workspace(workspace_id="<id>")

# Or commit specific nodes
mcp_savant_knowledge_commit_nodes(node_ids='["kgn_123", "kgn_456"]')
```

### Searching and Traversing

```
# Semantic search
mcp_savant_knowledge_search(query="authentication flow", node_type="insight")

# List all technology nodes
mcp_savant_knowledge_list_concepts()

# Get recent nodes
mcp_savant_knowledge_recent(node_type="insight", limit=10)

# Traverse from a node (1-5 hops)
mcp_savant_knowledge_neighbors(node_id="kgn_123", depth=2)

# Get full workspace context (depth-2 traversal from workspace project node)
mcp_savant_knowledge_project_context(workspace_id="<id>")
```

### Connecting Nodes

```
# Create edge
mcp_savant_knowledge_connect(
    source_id="kgn_123",
    target_id="kgn_456",
    edge_type="depends_on",
    label="Auth depends on Redis"
)

# Remove edge
mcp_savant_knowledge_disconnect(source_id="kgn_123", target_id="kgn_456")
```

### Updating and Maintaining

```
# Update a node
mcp_savant_knowledge_update_node(
    node_id="kgn_123",
    title="Updated title",
    content="Updated content...",
    node_type="service"
)

# Link/unlink workspace associations
mcp_savant_knowledge_link_workspace(node_id="kgn_123", workspace_id="<id>")
mcp_savant_knowledge_unlink_workspace(node_id="kgn_123", workspace_id="<id>")

# Cleanup: remove dangling edges and orphan nodes
mcp_savant_knowledge_prune(remove_orphan_nodes=True)

# Purge all nodes in a workspace
mcp_savant_knowledge_purge_workspace(workspace_id="<id>")
```

---

## 4. Context (savant-context)

Semantic code search and memory bank across indexed repositories.

### Code Search

```
# Semantic search across all indexed repos
mcp_savant_context_code_search(query="JWT token validation", limit=10)

# Filter to specific repo(s)
mcp_savant_context_code_search(query="email notification", repo="repo-a")
mcp_savant_context_code_search(query="user permissions", repo=["repo-b", "repo-a"])

# Exclude memory bank results
mcp_savant_context_code_search(query="redis caching", exclude_memory_bank=True)
```

### Memory Bank

Memory bank stores curated markdown documents for retrieval.

```
# Search memory bank
mcp_savant_context_memory_bank_search(query="deployment process", repo="repo-a")

# List memory resources
mcp_savant_context_memory_resources_list(repo="repo-b")

# Read a specific memory resource
mcp_savant_context_memory_resources_read(uri="memory://<repo-id>/deployment.md")
```

### Repository Info

```
# List all indexed repos with README excerpts
mcp_savant_context_repos_list()

# Filter repos
mcp_savant_context_repos_list(filter="network")

# Check indexing status
mcp_savant_context_repo_status()
```

---

## Common Workflows

### Starting a New Work Session

1. Check/create workspace: `get_current_workspace()` or `create_workspace()`
2. Assign session: `assign_session_to_workspace()`
3. Resolve abilities: `resolve_abilities(persona="engineer", repo_id="repo-a")`
4. Get next task: `get_next_task()`

### Code Review Workflow

1. Register Jira + MR to workspace
2. Assign both to session
3. Resolve reviewer abilities: `resolve_abilities(persona="reviewer", repo_id="<repo>")`
4. Fetch MR, perform review
5. Save session notes + knowledge graph nodes
6. Complete review task

### Investigating a Production Issue

1. Create workspace for the investigation
2. Register Jira ticket
3. Use `code_search()` to find relevant code
4. Use `memory_bank_search()` for past context
5. Use `knowledge_search()` for related insights
6. Store findings as knowledge nodes
7. Add session notes with conclusions

### Learning from a Session

After discovering something valuable:
```
# Store as knowledge
mcp_savant_knowledge_store(
    workspace_id="<id>",
    title="Discovery: Email service retry logic",
    content="The email service retries failed sends 3 times with exponential backoff...",
    node_type="insight",
    graph_type="technical",
    source="session"
)

# Also teach the abilities system
mcp_savant_abilities_learn(
    asset_id="rules.backend.base",
    content="Email service uses 3 retries with exponential backoff for failed sends"
)
```

---

## Pitfalls

1. **Session auto-detection may fail** — Use filesystem fallback via `~/.hermes/.savant-meta/`
2. **Knowledge nodes are staged by default** — Must call `commit_workspace()` or `commit_nodes()` to make them visible
3. **SSE connections can drop silently** — If tools 404 or timeout, the MCP connection may need reconnecting
4. **assign_jira_to_session / assign_mr_to_session may 404** — Registration still works; assignment is best-effort
5. **Always register Jira + MR before analysis** — User expectation for traceability
6. **code_search is semantic, not exact** — Use specific technical terms for better results
7. **Workspace IDs are numeric strings** — e.g., "1773062826261", not UUIDs
