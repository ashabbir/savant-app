"""WorkspaceDB — SQLite backend."""

from db.base import _now, _row_to_dict
from sqlite_client import get_connection


class WorkspaceDB:

    @staticmethod
    def create(workspace: dict) -> dict:
        conn = get_connection()
        now = _now()
        conn.execute(
            """INSERT INTO workspaces
               (workspace_id, name, description, priority, status,
                created_at, updated_at, created_session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                workspace["workspace_id"],
                workspace.get("name", ""),
                workspace.get("description", ""),
                workspace.get("priority", "medium"),
                workspace.get("status", "open"),
                workspace.get("created_at", now),
                workspace.get("updated_at", now),
                workspace.get("created_session_id"),
            ),
        )
        conn.commit()
        return WorkspaceDB.get_by_id(workspace["workspace_id"])

    @staticmethod
    def get_by_id(workspace_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM workspaces WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchone()
        return _row_to_dict(row)

    @staticmethod
    def list_all(status: str | None = None, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        if status:
            rows = conn.execute(
                "SELECT * FROM workspaces WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM workspaces ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def update(workspace_id: str, updates: dict) -> dict | None:
        conn = get_connection()
        updates["updated_at"] = _now()
        # Remove None values and non-column keys
        valid_cols = {
            "name", "description", "priority", "status",
            "updated_at", "created_session_id",
        }
        filtered = {k: v for k, v in updates.items() if k in valid_cols and v is not None}
        if not filtered:
            return WorkspaceDB.get_by_id(workspace_id)

        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        values = list(filtered.values()) + [workspace_id]
        conn.execute(
            f"UPDATE workspaces SET {set_clause} WHERE workspace_id = ?",
            values,
        )
        conn.commit()
        return WorkspaceDB.get_by_id(workspace_id)

    @staticmethod
    def delete(workspace_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            "DELETE FROM workspaces WHERE workspace_id = ?",
            (workspace_id,),
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def update_task_stats(workspace_id: str, stats: dict) -> None:
        """No-op: task_stats are computed dynamically in SQLite."""
        pass

    @staticmethod
    def get_task_stats(workspace_id: str) -> dict:
        """Compute task stats dynamically from tasks table."""
        conn = get_connection()
        rows = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM tasks WHERE workspace_id = ? GROUP BY status",
            (workspace_id,),
        ).fetchall()
        result = {"todo": 0, "in_progress": 0, "in-progress": 0, "done": 0, "blocked": 0, "total": 0}
        for r in rows:
            result[r["status"]] = r["cnt"]
            result["total"] += r["cnt"]
        # Normalize: support both "in_progress" and "in-progress"
        result["in_progress"] = result.get("in-progress", 0) + result.get("in_progress", 0)
        return result

    @staticmethod
    def close(workspace_id: str) -> dict | None:
        return WorkspaceDB.update(workspace_id, {"status": "closed"})

    @staticmethod
    def reopen(workspace_id: str) -> dict | None:
        return WorkspaceDB.update(workspace_id, {"status": "open"})
