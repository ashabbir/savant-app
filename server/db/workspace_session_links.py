"""Workspace-session link persistence (server-owned mapping)."""

from db.base import _now, _row_to_dict, _rows_to_dicts
from sqlite_client import get_connection

_ALLOWED_PROVIDERS = {"copilot", "claude", "codex", "gemini", "hermes"}


class WorkspaceSessionLinkDB:
    @staticmethod
    def _normalize_provider(provider: str) -> str:
        value = str(provider or "").strip().lower()
        if value not in _ALLOWED_PROVIDERS:
            raise ValueError("Invalid provider")
        return value

    @staticmethod
    def list_by_workspace(workspace_id: str) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            """SELECT workspace_id, provider, session_id, attached_at
               FROM workspace_session_links
               WHERE workspace_id = ?
               ORDER BY attached_at DESC""",
            (workspace_id,),
        ).fetchall()
        return _rows_to_dicts(rows)

    @staticmethod
    def resolve(provider: str, session_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute(
            """SELECT workspace_id, provider, session_id, attached_at
               FROM workspace_session_links
               WHERE provider = ? AND session_id = ?""",
            (WorkspaceSessionLinkDB._normalize_provider(provider), str(session_id or "")),
        ).fetchone()
        return _row_to_dict(row)

    @staticmethod
    def upsert(workspace_id: str, provider: str, session_id: str) -> dict:
        conn = get_connection()
        now = _now()
        provider = WorkspaceSessionLinkDB._normalize_provider(provider)
        sid = str(session_id or "").strip()
        if not sid:
            raise ValueError("session_id required")
        conn.execute(
            """INSERT INTO workspace_session_links (workspace_id, provider, session_id, attached_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(provider, session_id)
               DO UPDATE SET workspace_id = excluded.workspace_id, attached_at = excluded.attached_at""",
            (workspace_id, provider, sid, now),
        )
        conn.commit()
        return {
            "workspace_id": workspace_id,
            "provider": provider,
            "session_id": sid,
            "attached_at": now,
        }

    @staticmethod
    def delete_from_workspace(workspace_id: str, provider: str, session_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute(
            """DELETE FROM workspace_session_links
               WHERE workspace_id = ? AND provider = ? AND session_id = ?""",
            (workspace_id, WorkspaceSessionLinkDB._normalize_provider(provider), str(session_id or "")),
        )
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def delete_by_workspace(workspace_id: str) -> int:
        conn = get_connection()
        cur = conn.execute(
            "DELETE FROM workspace_session_links WHERE workspace_id = ?",
            (workspace_id,),
        )
        conn.commit()
        return int(cur.rowcount or 0)
