"""KnowledgeGraphDB — SQLite backend for the brain-like knowledge graph."""

import json
import threading
from datetime import datetime, timezone
from db.base import _now, _row_to_dict as _base_row
from sqlite_client import get_connection


_counter = 0
_counter_lock = threading.Lock()


def _gen_id(prefix="kgn"):
    global _counter
    with _counter_lock:
        _counter += 1
        ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        return f"{prefix}_{ts}_{_counter}"


def _row_to_dict(row):
    return _base_row(row, json_fields={"metadata": {}})


VALID_NODE_TYPES = {"insight", "project", "session", "concept", "repo",
                   "client", "domain", "service", "library", "technology", "issue"}
VALID_EDGE_TYPES = {"relates_to", "learned_from", "applies_to", "uses",
                   "evolved_from", "contributed_to", "part_of",
                   "integrates_with", "depends_on", "built_with"}


class KnowledgeGraphDB:
    """Graph-based knowledge store with nodes and typed edges."""

    # -----------------------------------------------------------------------
    # Nodes
    # -----------------------------------------------------------------------

    @staticmethod
    def create_node(node: dict) -> dict:
        conn = get_connection()
        now = _now()
        node_id = node.get("node_id") or _gen_id("kgn")
        node_type = node.get("node_type", "insight")
        title = node.get("title", "").strip()
        if not title:
            raise ValueError("title is required")
        if node_type not in VALID_NODE_TYPES:
            raise ValueError(f"Invalid node_type: {node_type}. Must be one of {VALID_NODE_TYPES}")
        content = node.get("content", "")
        metadata = node.get("metadata", {})
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        status = node.get("status", "staged")

        conn.execute(
            "INSERT INTO kg_nodes (node_id, node_type, title, content, metadata, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (node_id, node_type, title, content, json.dumps(metadata), status, now, now)
        )
        conn.commit()
        return KnowledgeGraphDB.get_node(node_id)

    @staticmethod
    def get_node(node_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM kg_nodes WHERE node_id = ?", (node_id,)).fetchone()
        if not row:
            return None
        node = _row_to_dict(row)
        # Attach edges
        edges = conn.execute(
            "SELECT * FROM kg_edges WHERE source_id = ? OR target_id = ?",
            (node_id, node_id)
        ).fetchall()
        node["edges"] = [_row_to_dict(e) for e in edges]
        return node

    @staticmethod
    def update_node(node_id: str, updates: dict) -> dict | None:
        conn = get_connection()
        existing = conn.execute("SELECT * FROM kg_nodes WHERE node_id = ?", (node_id,)).fetchone()
        if not existing:
            return None
        now = _now()
        fields = []
        values = []
        for key in ("title", "content", "node_type"):
            if key in updates and updates[key]:
                fields.append(f"{key} = ?")
                values.append(updates[key])
        if "metadata" in updates:
            meta = updates["metadata"]
            if isinstance(meta, str):
                meta = json.loads(meta)
            # Deep-merge: preserve existing metadata keys not present in update
            # (especially `workspaces` which is managed separately via link/unlink)
            existing_raw = existing["metadata"] if existing["metadata"] else "{}"
            try:
                existing_meta = json.loads(existing_raw) if isinstance(existing_raw, str) else (existing_raw or {})
            except (json.JSONDecodeError, TypeError):
                existing_meta = {}
            merged = dict(existing_meta)
            merged.update(meta)
            # Never let a metadata update silently drop workspaces
            if "workspaces" not in meta and "workspaces" in existing_meta:
                merged["workspaces"] = existing_meta["workspaces"]
            fields.append("metadata = ?")
            values.append(json.dumps(merged))
        if not fields:
            return KnowledgeGraphDB.get_node(node_id)
        fields.append("updated_at = ?")
        values.append(now)
        values.append(node_id)
        conn.execute(f"UPDATE kg_nodes SET {', '.join(fields)} WHERE node_id = ?", values)
        conn.commit()
        return KnowledgeGraphDB.get_node(node_id)

    @staticmethod
    def delete_node(node_id: str) -> bool:
        conn = get_connection()
        # Cascade: delete edges referencing this node
        conn.execute("DELETE FROM kg_edges WHERE source_id = ? OR target_id = ?", (node_id, node_id))
        cur = conn.execute("DELETE FROM kg_nodes WHERE node_id = ?", (node_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def prune_graph(remove_orphan_nodes: bool = False) -> dict:
        """Remove dangling edges and optionally orphaned nodes.

        Dangling edges: edges whose source_id or target_id no longer exists in kg_nodes.
        Orphan nodes: nodes with zero edges after pruning (only removed when remove_orphan_nodes=True).
        Returns: {"edges_removed": int, "nodes_removed": int}
        """
        conn = get_connection()
        # Remove edges referencing non-existent nodes
        cur = conn.execute(
            "DELETE FROM kg_edges WHERE source_id NOT IN (SELECT node_id FROM kg_nodes) "
            "OR target_id NOT IN (SELECT node_id FROM kg_nodes)"
        )
        edges_removed = cur.rowcount

        nodes_removed = 0
        if remove_orphan_nodes:
            cur = conn.execute(
                "DELETE FROM kg_nodes WHERE node_id NOT IN "
                "(SELECT source_id FROM kg_edges UNION SELECT target_id FROM kg_edges)"
            )
            nodes_removed = cur.rowcount

        conn.commit()
        return {"edges_removed": edges_removed, "nodes_removed": nodes_removed}

    @staticmethod
    def commit_nodes(node_ids: list[str]) -> int:
        """Set status='committed' for given node IDs. Returns count of updated rows."""
        if not node_ids:
            return 0
        conn = get_connection()
        now = _now()
        placeholders = ",".join("?" * len(node_ids))
        cur = conn.execute(
            f"UPDATE kg_nodes SET status = 'committed', updated_at = ? WHERE node_id IN ({placeholders})",
            [now] + list(node_ids)
        )
        conn.commit()
        return cur.rowcount

    @staticmethod
    def uncommit_nodes(node_ids: list[str]) -> int:
        """Set status='staged' for given node IDs. Returns count of updated rows."""
        if not node_ids:
            return 0
        conn = get_connection()
        now = _now()
        placeholders = ",".join("?" * len(node_ids))
        cur = conn.execute(
            f"UPDATE kg_nodes SET status = 'staged', updated_at = ? WHERE node_id IN ({placeholders})",
            [now] + list(node_ids)
        )
        conn.commit()
        return cur.rowcount

    @staticmethod
    def list_nodes(node_type: str = "", limit: int = 200, status: str = "", include_staged: bool = False) -> list[dict]:
        conn = get_connection()
        conditions = []
        params: list = []
        if node_type:
            conditions.append("node_type = ?")
            params.append(node_type)
        if status:
            conditions.append("status = ?")
            params.append(status)
        elif not include_staged:
            conditions.append("status = 'committed'")
        where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
        params.append(limit)
        rows = conn.execute(
            f"SELECT * FROM kg_nodes{where} ORDER BY created_at DESC LIMIT ?", params
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def search_nodes(query: str, node_type: str = "", limit: int = 20, include_staged: bool = False) -> list[dict]:
        conn = get_connection()
        like = f"%{query}%"
        conditions = ["(title LIKE ? OR content LIKE ?)"]
        params: list = [like, like]
        if node_type:
            conditions.append("node_type = ?")
            params.append(node_type)
        if not include_staged:
            conditions.append("status = 'committed'")
        where = " WHERE " + " AND ".join(conditions)
        params.append(limit)
        rows = conn.execute(
            f"SELECT * FROM kg_nodes{where} ORDER BY created_at DESC LIMIT ?", params
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def count_nodes(node_type: str = "") -> int:
        conn = get_connection()
        if node_type:
            return conn.execute("SELECT COUNT(*) FROM kg_nodes WHERE node_type = ?", (node_type,)).fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM kg_nodes").fetchone()[0]

    # -----------------------------------------------------------------------
    # Edges
    # -----------------------------------------------------------------------

    @staticmethod
    def create_edge(edge: dict) -> dict:
        conn = get_connection()
        now = _now()
        edge_id = edge.get("edge_id") or _gen_id("kge")
        source_id = edge.get("source_id", "")
        target_id = edge.get("target_id", "")
        edge_type = edge.get("edge_type", "relates_to")

        if not source_id or not target_id:
            raise ValueError("source_id and target_id are required")
        if edge_type not in VALID_EDGE_TYPES:
            raise ValueError(f"Invalid edge_type: {edge_type}. Must be one of {VALID_EDGE_TYPES}")
        # Verify both nodes exist
        src = conn.execute("SELECT node_id FROM kg_nodes WHERE node_id = ?", (source_id,)).fetchone()
        tgt = conn.execute("SELECT node_id FROM kg_nodes WHERE node_id = ?", (target_id,)).fetchone()
        if not src:
            raise ValueError(f"Source node not found: {source_id}")
        if not tgt:
            raise ValueError(f"Target node not found: {target_id}")

        weight = edge.get("weight", 1.0)
        label = edge.get("label", "")

        # Check for existing duplicate
        existing = conn.execute(
            "SELECT edge_id FROM kg_edges WHERE source_id=? AND target_id=? AND edge_type=?",
            (source_id, target_id, edge_type)
        ).fetchone()
        if existing:
            return _row_to_dict(conn.execute("SELECT * FROM kg_edges WHERE edge_id = ?", (existing["edge_id"],)).fetchone())

        conn.execute(
            "INSERT INTO kg_edges (edge_id, source_id, target_id, edge_type, weight, label, created_at) VALUES (?,?,?,?,?,?,?)",
            (edge_id, source_id, target_id, edge_type, weight, label, now)
        )
        conn.commit()
        return _row_to_dict(conn.execute("SELECT * FROM kg_edges WHERE edge_id = ?", (edge_id,)).fetchone())

    @staticmethod
    def delete_edge(edge_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute("DELETE FROM kg_edges WHERE edge_id = ?", (edge_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def delete_edge_by_nodes(source_id: str, target_id: str, edge_type: str = "") -> bool:
        conn = get_connection()
        if edge_type:
            cur = conn.execute(
                "DELETE FROM kg_edges WHERE source_id = ? AND target_id = ? AND edge_type = ?",
                (source_id, target_id, edge_type)
            )
        else:
            cur = conn.execute(
                "DELETE FROM kg_edges WHERE source_id = ? AND target_id = ?",
                (source_id, target_id)
            )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def list_edges(node_id: str = "", edge_type: str = "") -> list[dict]:
        conn = get_connection()
        if node_id and edge_type:
            rows = conn.execute(
                "SELECT * FROM kg_edges WHERE (source_id = ? OR target_id = ?) AND edge_type = ?",
                (node_id, node_id, edge_type)
            ).fetchall()
        elif node_id:
            rows = conn.execute(
                "SELECT * FROM kg_edges WHERE source_id = ? OR target_id = ?",
                (node_id, node_id)
            ).fetchall()
        elif edge_type:
            rows = conn.execute(
                "SELECT * FROM kg_edges WHERE edge_type = ?", (edge_type,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM kg_edges").fetchall()
        return [_row_to_dict(r) for r in rows]

    # -----------------------------------------------------------------------
    # Graph queries
    # -----------------------------------------------------------------------

    @staticmethod
    def get_full_graph(node_type: str = "", limit: int = 500, include_staged: bool = False) -> dict:
        """Get full graph (nodes + edges) for visualization."""
        conn = get_connection()
        status_filter = "" if include_staged else " AND status = 'committed'"
        if node_type:
            nodes = conn.execute(
                f"SELECT * FROM kg_nodes WHERE node_type = ?{status_filter} ORDER BY created_at DESC LIMIT ?",
                (node_type, limit)
            ).fetchall()
            node_ids = {dict(n)["node_id"] for n in nodes}
            # Also include nodes connected to filtered nodes
            if node_ids:
                placeholders = ",".join("?" * len(node_ids))
                extra_edges = conn.execute(
                    f"SELECT * FROM kg_edges WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})",
                    list(node_ids) + list(node_ids)
                ).fetchall()
                extra_ids = set()
                for e in extra_edges:
                    ed = dict(e)
                    extra_ids.add(ed["source_id"])
                    extra_ids.add(ed["target_id"])
                missing = extra_ids - node_ids
                if missing:
                    mp = ",".join("?" * len(missing))
                    status_clause = "" if include_staged else " AND status = 'committed'"
                    extra_nodes = conn.execute(
                        f"SELECT * FROM kg_nodes WHERE node_id IN ({mp}){status_clause}", list(missing)
                    ).fetchall()
                    nodes = list(nodes) + list(extra_nodes)
                    node_ids.update(dict(n)["node_id"] for n in extra_nodes)
                # Filter edges to only connect visible nodes
                edges = [e for e in extra_edges if dict(e)["source_id"] in node_ids and dict(e)["target_id"] in node_ids]
            else:
                edges = []
        else:
            status_where = " WHERE status = 'committed'" if not include_staged else ""
            nodes = conn.execute(
                f"SELECT * FROM kg_nodes{status_where} ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            node_ids = {dict(n)["node_id"] for n in nodes}
            if node_ids:
                placeholders = ",".join("?" * len(node_ids))
                edges = conn.execute(
                    f"SELECT * FROM kg_edges WHERE source_id IN ({placeholders}) AND target_id IN ({placeholders})",
                    list(node_ids) + list(node_ids)
                ).fetchall()
            else:
                edges = []

        return {
            "nodes": [_row_to_dict(n) for n in nodes],
            "edges": [_row_to_dict(e) for e in edges]
        }

    @staticmethod
    def get_neighbors(node_id: str, depth: int = 1, edge_type: str = "", include_staged: bool = False) -> dict:
        """Get connected nodes up to n hops away."""
        conn = get_connection()
        visited_nodes = set()
        visited_edges = []
        frontier = {node_id}

        # Pre-fetch committed node IDs for filtering (unless including staged)
        if not include_staged:
            committed_ids: set | None = {
                r[0] for r in conn.execute("SELECT node_id FROM kg_nodes WHERE status = 'committed'").fetchall()
            }
        else:
            committed_ids = None

        for _ in range(depth):
            if not frontier:
                break
            new_frontier = set()
            for nid in frontier:
                if edge_type:
                    edges = conn.execute(
                        "SELECT * FROM kg_edges WHERE (source_id = ? OR target_id = ?) AND edge_type = ?",
                        (nid, nid, edge_type)
                    ).fetchall()
                else:
                    edges = conn.execute(
                        "SELECT * FROM kg_edges WHERE source_id = ? OR target_id = ?",
                        (nid, nid)
                    ).fetchall()
                for e in edges:
                    ed = _row_to_dict(e)
                    other = ed["target_id"] if ed["source_id"] == nid else ed["source_id"]
                    # Skip neighbors that aren't committed when filtering
                    if committed_ids is not None and other not in committed_ids:
                        continue
                    if ed["edge_id"] not in {ve["edge_id"] for ve in visited_edges}:
                        visited_edges.append(ed)
                    if other not in visited_nodes:
                        new_frontier.add(other)
                visited_nodes.add(nid)
            frontier = new_frontier - visited_nodes

        visited_nodes.update(frontier)
        all_ids = visited_nodes
        nodes = []
        if all_ids:
            placeholders = ",".join("?" * len(all_ids))
            status_clause = "" if include_staged else " AND status = 'committed'"
            nodes = conn.execute(
                f"SELECT * FROM kg_nodes WHERE node_id IN ({placeholders}){status_clause}", list(all_ids)
            ).fetchall()

        return {
            "nodes": [_row_to_dict(n) for n in nodes],
            "edges": visited_edges
        }

    @staticmethod
    def merge_nodes(survivor_id: str, absorbed_ids: list[str], node_type: str = "") -> dict | None:
        """Merge multiple nodes into one survivor node.

        - Re-points all edges from absorbed nodes to the survivor.
        - Appends content from absorbed nodes to the survivor.
        - Merges metadata (files lists, etc.).
        - Removes duplicate edges (same source+target+edge_type).
        - Deletes absorbed nodes.
        - Returns the updated survivor node.
        """
        conn = get_connection()
        survivor = conn.execute("SELECT * FROM kg_nodes WHERE node_id = ?", (survivor_id,)).fetchone()
        if not survivor:
            return None
        survivor = _row_to_dict(survivor)

        absorbed_nodes = []
        for nid in absorbed_ids:
            row = conn.execute("SELECT * FROM kg_nodes WHERE node_id = ?", (nid,)).fetchone()
            if row:
                absorbed_nodes.append(_row_to_dict(row))

        if not absorbed_nodes:
            return survivor

        # Merge content: append non-empty content from absorbed nodes
        merged_content = survivor.get("content", "") or ""
        for an in absorbed_nodes:
            ac = (an.get("content") or "").strip()
            if ac and ac != merged_content:
                merged_content = merged_content.rstrip() + "\n\n---\n\n" + ac if merged_content.strip() else ac

        # Merge metadata
        merged_meta = dict(survivor.get("metadata") or {})
        for an in absorbed_nodes:
            am = an.get("metadata") or {}
            # Merge files lists
            if am.get("files"):
                existing = set(merged_meta.get("files") or [])
                for f in am["files"]:
                    existing.add(f)
                merged_meta["files"] = sorted(existing)
            # Keep first non-empty repo
            if am.get("repo") and not merged_meta.get("repo"):
                merged_meta["repo"] = am["repo"]
            # Keep first non-empty source
            if am.get("source") and not merged_meta.get("source"):
                merged_meta["source"] = am["source"]
            # Merge workspace_id
            if am.get("workspace_id") and not merged_meta.get("workspace_id"):
                merged_meta["workspace_id"] = am["workspace_id"]

        # Re-point edges from absorbed nodes to survivor.
        # Must handle the UNIQUE constraint on (source_id, target_id, edge_type)
        # by deleting would-be-duplicates BEFORE updating.
        all_absorbed = [n["node_id"] for n in absorbed_nodes]
        absorbed_set = set(all_absorbed)

        for nid in all_absorbed:
            # Get all edges where this absorbed node is the source
            src_edges = conn.execute(
                "SELECT edge_id, source_id, target_id, edge_type, weight FROM kg_edges WHERE source_id = ?",
                (nid,)
            ).fetchall()
            for e in src_edges:
                new_src = survivor_id
                new_tgt = e["target_id"]
                # If target is also absorbed, it will become survivor too → self-ref, delete
                if new_tgt in absorbed_set or new_tgt == survivor_id:
                    conn.execute("DELETE FROM kg_edges WHERE edge_id = ?", (e["edge_id"],))
                    continue
                # Check if survivor already has this edge
                existing = conn.execute(
                    "SELECT edge_id, weight FROM kg_edges WHERE source_id = ? AND target_id = ? AND edge_type = ?",
                    (new_src, new_tgt, e["edge_type"])
                ).fetchone()
                if existing:
                    # Keep the one with higher weight, delete the other
                    if e["weight"] > existing["weight"]:
                        conn.execute("UPDATE kg_edges SET weight = ? WHERE edge_id = ?", (e["weight"], existing["edge_id"]))
                    conn.execute("DELETE FROM kg_edges WHERE edge_id = ?", (e["edge_id"],))
                else:
                    conn.execute("UPDATE kg_edges SET source_id = ? WHERE edge_id = ?", (new_src, e["edge_id"]))

            # Get all edges where this absorbed node is the target
            tgt_edges = conn.execute(
                "SELECT edge_id, source_id, target_id, edge_type, weight FROM kg_edges WHERE target_id = ?",
                (nid,)
            ).fetchall()
            for e in tgt_edges:
                new_src = e["source_id"]
                new_tgt = survivor_id
                # If source is also absorbed or survivor → self-ref, delete
                if new_src in absorbed_set or new_src == survivor_id:
                    conn.execute("DELETE FROM kg_edges WHERE edge_id = ?", (e["edge_id"],))
                    continue
                existing = conn.execute(
                    "SELECT edge_id, weight FROM kg_edges WHERE source_id = ? AND target_id = ? AND edge_type = ?",
                    (new_src, new_tgt, e["edge_type"])
                ).fetchone()
                if existing:
                    if e["weight"] > existing["weight"]:
                        conn.execute("UPDATE kg_edges SET weight = ? WHERE edge_id = ?", (e["weight"], existing["edge_id"]))
                    conn.execute("DELETE FROM kg_edges WHERE edge_id = ?", (e["edge_id"],))
                else:
                    conn.execute("UPDATE kg_edges SET target_id = ? WHERE edge_id = ?", (new_tgt, e["edge_id"]))

        # Update survivor
        import json as _json
        final_type = node_type if node_type else survivor.get("node_type", "insight")
        conn.execute(
            "UPDATE kg_nodes SET content = ?, metadata = ?, node_type = ?, updated_at = ? WHERE node_id = ?",
            (merged_content, _json.dumps(merged_meta), final_type, _now(), survivor_id)
        )

        # Delete absorbed nodes
        for nid in all_absorbed:
            conn.execute("DELETE FROM kg_nodes WHERE node_id = ?", (nid,))

        conn.commit()
        return KnowledgeGraphDB.get_node(survivor_id)

    @staticmethod
    def get_project_context(project_node_id: str, include_staged: bool = False) -> dict:
        """Get aggregated context for a project node via graph traversal."""
        conn = get_connection()
        node = KnowledgeGraphDB.get_node(project_node_id)
        if not node:
            return {"error": f"Node not found: {project_node_id}"}

        # Get all connected nodes (2-hop neighborhood)
        neighborhood = KnowledgeGraphDB.get_neighbors(project_node_id, depth=2, include_staged=include_staged)

        # Categorize by type
        insights = [n for n in neighborhood["nodes"] if n["node_type"] == "insight"]
        concepts = [n for n in neighborhood["nodes"] if n["node_type"] == "concept"]
        sessions = [n for n in neighborhood["nodes"] if n["node_type"] == "session"]
        repos = [n for n in neighborhood["nodes"] if n["node_type"] == "repo"]

        # Also pull tasks and notes for the workspace if metadata has workspace_id
        ws_id = node.get("metadata", {}).get("workspace_id", "")
        tasks = []
        notes = []
        if ws_id:
            tasks = conn.execute(
                "SELECT task_id, title, status, priority FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50",
                (ws_id,)
            ).fetchall()
            notes = conn.execute(
                "SELECT text, created_at FROM notes WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20",
                (ws_id,)
            ).fetchall()

        return {
            "project": {"node_id": node["node_id"], "title": node["title"], "content": node["content"]},
            "insights": [{"title": i["title"], "content": i["content"][:500]} for i in insights],
            "concepts": [n["title"] for n in concepts],
            "sessions": [{"title": s["title"], "node_id": s["node_id"]} for s in sessions],
            "repos": [r["title"] for r in repos],
            "tasks": [dict(t) for t in tasks],
            "notes": [dict(n) for n in notes],
            "stats": {
                "insights": len(insights),
                "concepts": len(concepts),
                "sessions": len(sessions),
                "repos": len(repos),
                "edges": len(neighborhood["edges"])
            }
        }
