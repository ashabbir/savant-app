"""TaskDB — SQLite backend."""

from db.base import _now, _row_to_dict
from sqlite_client import get_connection


class TaskDB:

    @staticmethod
    def ensure_indexes():
        """No-op: indexes created in schema."""
        pass

    @staticmethod
    def _next_seq() -> int:
        conn = get_connection()
        conn.execute("UPDATE counters SET value = value + 1 WHERE name = 'task_seq'")
        row = conn.execute("SELECT value FROM counters WHERE name = 'task_seq'").fetchone()
        return row["value"]

    @staticmethod
    def _enrich_with_deps(task: dict) -> dict:
        """Attach depends_on list from task_deps table."""
        conn = get_connection()
        rows = conn.execute(
            "SELECT depends_on FROM task_deps WHERE task_id = ?",
            (task["task_id"],),
        ).fetchall()
        task["depends_on"] = [r["depends_on"] for r in rows]
        return task

    @staticmethod
    def _enrich_list(tasks: list[dict]) -> list[dict]:
        """Batch-enrich a list of tasks with dependencies."""
        if not tasks:
            return tasks
        conn = get_connection()
        task_ids = [t["task_id"] for t in tasks]
        placeholders = ",".join("?" * len(task_ids))
        rows = conn.execute(
            f"SELECT task_id, depends_on FROM task_deps WHERE task_id IN ({placeholders})",
            task_ids,
        ).fetchall()
        deps_map: dict[str, list[str]] = {}
        for r in rows:
            deps_map.setdefault(r["task_id"], []).append(r["depends_on"])
        for t in tasks:
            t["depends_on"] = deps_map.get(t["task_id"], [])
        return tasks

    @staticmethod
    def create(task: dict) -> dict:
        conn = get_connection()
        now = _now()
        seq = task.get("seq") or TaskDB._next_seq()
        conn.execute(
            """INSERT INTO tasks
               (task_id, seq, workspace_id, title, description, status, priority,
                date, "order", created_at, updated_at, created_session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                task["task_id"], seq, task["workspace_id"],
                task.get("title", ""), task.get("description", ""),
                task.get("status", "todo"), task.get("priority", "medium"),
                task.get("date"), task.get("order", 0),
                task.get("created_at", now), task.get("updated_at", now),
                task.get("created_session_id"),
            ),
        )
        # Insert dependencies if provided
        for dep_id in task.get("depends_on", []):
            conn.execute(
                "INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)",
                (task["task_id"], dep_id),
            )
        conn.commit()
        return TaskDB.get_by_id(task["task_id"])

    @staticmethod
    def bulk_upsert(tasks: list[dict]) -> int:
        conn = get_connection()
        now = _now()
        count = 0
        for task in tasks:
            conn.execute(
                """INSERT OR REPLACE INTO tasks
                   (task_id, seq, workspace_id, title, description, status, priority,
                    date, "order", created_at, updated_at, created_session_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    task["task_id"], task.get("seq"), task["workspace_id"],
                    task.get("title", ""), task.get("description", ""),
                    task.get("status", "todo"), task.get("priority", "medium"),
                    task.get("date"), task.get("order", 0),
                    task.get("created_at", now), task.get("updated_at", now),
                    task.get("created_session_id"),
                ),
            )
            # Upsert deps
            conn.execute("DELETE FROM task_deps WHERE task_id = ?", (task["task_id"],))
            for dep_id in task.get("depends_on", []):
                conn.execute(
                    "INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)",
                    (task["task_id"], dep_id),
                )
            count += 1
        conn.commit()
        return count

    @staticmethod
    def get_by_id(task_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        return TaskDB._enrich_with_deps(_row_to_dict(row))

    @staticmethod
    def get_by_seq(seq: int) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM tasks WHERE seq = ?", (seq,)).fetchone()
        if row is None:
            return None
        return TaskDB._enrich_with_deps(_row_to_dict(row))

    @staticmethod
    def resolve_id(ref: str) -> dict | None:
        """Resolve 'T-42' style refs or plain task_id."""
        if ref and ref.upper().startswith("T-"):
            try:
                seq = int(ref.split("-", 1)[1])
                return TaskDB.get_by_seq(seq)
            except (ValueError, IndexError):
                pass
        return TaskDB.get_by_id(ref)

    @staticmethod
    def list_all(workspace_id: str | None = None) -> list[dict]:
        conn = get_connection()
        if workspace_id:
            rows = conn.execute(
                'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY date ASC, "order" ASC, created_at ASC',
                (workspace_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM tasks ORDER BY date ASC, "order" ASC, created_at ASC'
            ).fetchall()
        return TaskDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_date(date_str: str) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            'SELECT * FROM tasks WHERE date = ? ORDER BY "order" ASC, created_at ASC',
            (date_str,),
        ).fetchall()
        return TaskDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_workspace(workspace_id: str, status: str | None = None, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        if status:
            rows = conn.execute(
                'SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY date ASC, "order" ASC LIMIT ?',
                (workspace_id, status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY date ASC, "order" ASC LIMIT ?',
                (workspace_id, limit),
            ).fetchall()
        return TaskDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_status(status: str, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
        return TaskDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_dates() -> list[str]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT DISTINCT date FROM tasks WHERE date IS NOT NULL ORDER BY date ASC"
        ).fetchall()
        return [r["date"] for r in rows]

    @staticmethod
    def update(task_id: str, updates: dict) -> dict | None:
        conn = get_connection()
        updates["updated_at"] = _now()
        valid_cols = {
            "title", "description", "status", "priority",
            "date", "order", "updated_at", "workspace_id", "created_session_id",
        }
        filtered = {k: v for k, v in updates.items() if k in valid_cols}
        if not filtered:
            return TaskDB.get_by_id(task_id)

        set_clause = ", ".join(
            f'"{k}" = ?' if k == "order" else f"{k} = ?"
            for k in filtered
        )
        values = list(filtered.values()) + [task_id]
        conn.execute(f"UPDATE tasks SET {set_clause} WHERE task_id = ?", values)
        conn.commit()
        return TaskDB.get_by_id(task_id)

    @staticmethod
    def update_status(task_id: str, status: str) -> dict | None:
        return TaskDB.update(task_id, {"status": status})

    @staticmethod
    def delete(task_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute("DELETE FROM tasks WHERE task_id = ?", (task_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def add_dependency(task_id: str, depends_on: str) -> bool:
        conn = get_connection()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)",
                (task_id, depends_on),
            )
            conn.commit()
            return True
        except Exception:
            return False

    @staticmethod
    def remove_dependency(task_id: str, depends_on: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            "DELETE FROM task_deps WHERE task_id = ? AND depends_on = ?",
            (task_id, depends_on),
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def reorder(date_str: str, ordered_ids: list[str]) -> None:
        conn = get_connection()
        for idx, task_id in enumerate(ordered_ids):
            conn.execute(
                'UPDATE tasks SET "order" = ? WHERE task_id = ?',
                (idx, task_id),
            )
        conn.commit()

    @staticmethod
    def move_incomplete_tasks(from_date: str, to_date: str) -> int:
        conn = get_connection()
        now = _now()
        cur = conn.execute(
            "UPDATE tasks SET date = ?, updated_at = ? WHERE date = ? AND status != 'done'",
            (to_date, now, from_date),
        )
        conn.commit()
        return cur.rowcount

    @staticmethod
    def count_by_date_status(date_str: str) -> dict:
        conn = get_connection()
        rows = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM tasks WHERE date = ? GROUP BY status",
            (date_str,),
        ).fetchall()
        return {r["status"]: r["cnt"] for r in rows}
