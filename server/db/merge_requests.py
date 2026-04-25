"""MergeRequestDB — SQLite backend."""

from db.base import _now, _row_to_dict
from sqlite_client import get_connection


class MergeRequestDB:

    @staticmethod
    def _enrich_with_notes(mr: dict) -> dict:
        """Attach notes list from mr_notes table."""
        conn = get_connection()
        rows = conn.execute(
            "SELECT text, session_id, created_at FROM mr_notes WHERE mr_id = ? ORDER BY created_at",
            (mr["mr_id"],),
        ).fetchall()
        mr["notes"] = [dict(r) for r in rows]
        return mr

    @staticmethod
    def _enrich_list(mrs: list[dict]) -> list[dict]:
        """Batch-enrich a list of MRs with their notes."""
        if not mrs:
            return mrs
        conn = get_connection()
        mr_ids = [m["mr_id"] for m in mrs]
        placeholders = ",".join("?" * len(mr_ids))
        rows = conn.execute(
            f"SELECT mr_id, text, session_id, created_at FROM mr_notes WHERE mr_id IN ({placeholders}) ORDER BY created_at",
            mr_ids,
        ).fetchall()
        notes_map: dict[str, list] = {}
        for r in rows:
            notes_map.setdefault(r["mr_id"], []).append(
                {"text": r["text"], "session_id": r["session_id"], "created_at": r["created_at"]}
            )
        for m in mrs:
            m["notes"] = notes_map.get(m["mr_id"], [])
        return mrs

    @staticmethod
    def create(mr: dict) -> dict:
        conn = get_connection()
        now = _now()
        conn.execute(
            """INSERT INTO merge_requests
               (mr_id, workspace_id, url, project_id, mr_iid, title, status,
                priority, author, jira, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                mr["mr_id"], mr["workspace_id"], mr["url"],
                mr.get("project_id", ""), mr.get("mr_iid", 0),
                mr.get("title", ""), mr.get("status", "open"),
                mr.get("priority", "medium"), mr.get("author", ""),
                mr.get("jira", ""), mr.get("created_at", now), mr.get("updated_at", now),
            ),
        )
        # Insert embedded notes
        for note in mr.get("notes", []):
            conn.execute(
                "INSERT INTO mr_notes (mr_id, text, session_id, created_at) VALUES (?, ?, ?, ?)",
                (mr["mr_id"], note.get("text", ""), note.get("session_id", ""), note.get("created_at", now)),
            )
        conn.commit()
        return MergeRequestDB.get_by_id(mr["mr_id"])

    @staticmethod
    def get_by_id(mr_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM merge_requests WHERE mr_id = ?", (mr_id,)).fetchone()
        if row is None:
            return None
        return MergeRequestDB._enrich_with_notes(_row_to_dict(row))

    @staticmethod
    def get_by_url(url: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM merge_requests WHERE url = ?", (url,)).fetchone()
        if row is None:
            return None
        return MergeRequestDB._enrich_with_notes(_row_to_dict(row))

    @staticmethod
    def list_by_workspace(workspace_id: str, status: str | None = None, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        if status:
            rows = conn.execute(
                "SELECT * FROM merge_requests WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM merge_requests WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, limit),
            ).fetchall()
        return MergeRequestDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_status(status: str, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM merge_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
        return MergeRequestDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_all(limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM merge_requests ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return MergeRequestDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def update(mr_id: str, updates: dict) -> dict | None:
        conn = get_connection()
        updates["updated_at"] = _now()
        valid_cols = {
            "workspace_id", "title", "status", "priority",
            "author", "jira", "updated_at", "project_id", "mr_iid",
        }
        filtered = {k: v for k, v in updates.items() if k in valid_cols}
        if not filtered:
            return MergeRequestDB.get_by_id(mr_id)

        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        values = list(filtered.values()) + [mr_id]
        conn.execute(f"UPDATE merge_requests SET {set_clause} WHERE mr_id = ?", values)
        conn.commit()
        return MergeRequestDB.get_by_id(mr_id)

    @staticmethod
    def delete(mr_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute("DELETE FROM merge_requests WHERE mr_id = ?", (mr_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def add_note(mr_id: str, text: str, session_id: str = "") -> dict | None:
        conn = get_connection()
        conn.execute(
            "INSERT INTO mr_notes (mr_id, text, session_id, created_at) VALUES (?, ?, ?, ?)",
            (mr_id, text, session_id, _now()),
        )
        conn.commit()
        return MergeRequestDB.get_by_id(mr_id)

    @staticmethod
    def update_status(mr_id: str, status: str) -> dict | None:
        return MergeRequestDB.update(mr_id, {"status": status})
