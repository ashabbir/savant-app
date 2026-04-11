"""NotificationDB — SQLite backend."""

import json
from datetime import datetime, timezone, timedelta
from db.base import _now, _row_to_dict as _base_row
from sqlite_client import get_connection


def _row_to_dict(row):
    d = _base_row(row, json_fields={"detail": {}})
    if d and "read" in d:
        d["read"] = bool(d["read"])
    return d


class NotificationDB:

    @staticmethod
    def create(notification: dict) -> dict:
        conn = get_connection()
        now = _now()
        detail = notification.get("detail", {})
        if not isinstance(detail, str):
            detail = json.dumps(detail)
        conn.execute(
            """INSERT INTO notifications
               (notification_id, event_type, message, detail,
                workspace_id, session_id, read, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                notification["notification_id"],
                notification.get("event_type", ""),
                notification.get("message", ""),
                detail,
                notification.get("workspace_id"),
                notification.get("session_id"),
                1 if notification.get("read") else 0,
                notification.get("created_at", now),
            ),
        )
        conn.commit()
        return NotificationDB.get_by_id(notification["notification_id"])

    @staticmethod
    def get_by_id(notification_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM notifications WHERE notification_id = ?",
            (notification_id,),
        ).fetchone()
        return _row_to_dict(row)

    @staticmethod
    def list_recent(limit: int = 50, since_id: str | None = None) -> list[dict]:
        conn = get_connection()
        if since_id:
            ref = conn.execute(
                "SELECT created_at FROM notifications WHERE notification_id = ?",
                (since_id,),
            ).fetchone()
            if ref:
                rows = conn.execute(
                    "SELECT * FROM notifications WHERE created_at > ? ORDER BY created_at DESC LIMIT ?",
                    (ref["created_at"], limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_unread(limit: int = 50) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_by_workspace(workspace_id: str, limit: int = 50) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
            (workspace_id, limit),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def list_by_session(session_id: str, limit: int = 50) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM notifications WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    @staticmethod
    def mark_as_read(notification_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            "UPDATE notifications SET read = 1 WHERE notification_id = ?",
            (notification_id,),
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def mark_all_as_read() -> int:
        conn = get_connection()
        cur = conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        conn.commit()
        return cur.rowcount

    @staticmethod
    def delete(notification_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            "DELETE FROM notifications WHERE notification_id = ?",
            (notification_id,),
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def delete_old(days: int = 30) -> int:
        conn = get_connection()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        cur = conn.execute(
            "DELETE FROM notifications WHERE created_at < ?",
            (cutoff,),
        )
        conn.commit()
        return cur.rowcount

    @staticmethod
    def count_unread() -> int:
        conn = get_connection()
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM notifications WHERE read = 0"
        ).fetchone()
        return row["cnt"] if row else 0
