"""NoteDB — SQLite backend."""

from db.base import _now, _row_to_dict
from sqlite_client import get_connection


class NoteDB:

    @staticmethod
    def create(note: dict) -> dict:
        conn = get_connection()
        now = _now()
        conn.execute(
            """INSERT INTO notes
               (note_id, session_id, workspace_id, text, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                note["note_id"], note["session_id"],
                note.get("workspace_id"), note.get("text", ""),
                note.get("created_at", now), note.get("updated_at", now),
            ),
        )
        conn.commit()
        return NoteDB.get_by_id(note["note_id"])

    @staticmethod
    def get_by_id(note_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM notes WHERE note_id = ?", (note_id,)
        ).fetchone()
        return _row_to_dict(row)

    @staticmethod
    def list_by_session(session_id: str, limit: int = 100) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notes WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def list_by_workspace(workspace_id: str, limit: int = 100) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notes WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
            (workspace_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def update(note_id: str, text: str) -> dict | None:
        conn = get_connection()
        conn.execute(
            "UPDATE notes SET text = ?, updated_at = ? WHERE note_id = ?",
            (text, _now(), note_id),
        )
        conn.commit()
        return NoteDB.get_by_id(note_id)

    @staticmethod
    def delete(note_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute("DELETE FROM notes WHERE note_id = ?", (note_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def search(text: str, limit: int = 50) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notes WHERE text LIKE ? ORDER BY created_at DESC LIMIT ?",
            (f"%{text}%", limit),
        ).fetchall()
        return [dict(r) for r in rows]
