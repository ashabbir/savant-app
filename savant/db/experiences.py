"""ExperienceDB — SQLite backend for the knowledge/experience layer."""

import json
from db.base import _now, _row_to_dict as _base_row
from sqlite_client import get_connection


def _row_to_dict(row):
    return _base_row(row, json_fields={"files": []})


class ExperienceDB:

    @staticmethod
    def create(exp: dict) -> dict:
        conn = get_connection()
        now = _now()
        files_json = json.dumps(exp.get("files", []))
        conn.execute(
            """INSERT INTO experiences
               (experience_id, content, source, workspace_id, repo, files, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                exp["experience_id"],
                exp["content"],
                exp.get("source", "note"),
                exp.get("workspace_id", ""),
                exp.get("repo", ""),
                files_json,
                exp.get("created_at", now),
                exp.get("updated_at", now),
            ),
        )
        conn.commit()
        return ExperienceDB.get_by_id(exp["experience_id"])

    @staticmethod
    def get_by_id(experience_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM experiences WHERE experience_id = ?", (experience_id,)
        ).fetchone()
        return _row_to_dict(row)

    @staticmethod
    def search(query: str, workspace_id: str = "", limit: int = 20) -> list[dict]:
        conn = get_connection()
        if workspace_id:
            rows = conn.execute(
                """SELECT * FROM experiences
                   WHERE content LIKE ? AND workspace_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (f"%{query}%", workspace_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM experiences
                   WHERE content LIKE ?
                   ORDER BY created_at DESC LIMIT ?""",
                (f"%{query}%", limit),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_recent(workspace_id: str = "", limit: int = 20) -> list[dict]:
        conn = get_connection()
        if workspace_id:
            rows = conn.execute(
                """SELECT * FROM experiences
                   WHERE workspace_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (workspace_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM experiences ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_by_workspace(workspace_id: str, limit: int = 100) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            """SELECT * FROM experiences
               WHERE workspace_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (workspace_id, limit),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_all(limit: int = 200) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM experiences ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def delete(experience_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            "DELETE FROM experiences WHERE experience_id = ?", (experience_id,)
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def count_by_workspace(workspace_id: str) -> int:
        conn = get_connection()
        row = conn.execute(
            "SELECT COUNT(*) FROM experiences WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchone()
        return row[0] if row else 0
