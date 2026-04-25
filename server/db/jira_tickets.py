"""JiraTicketDB — SQLite backend."""

from db.base import _now, _row_to_dict
from sqlite_client import get_connection


class JiraTicketDB:

    @staticmethod
    def _enrich_with_notes(ticket: dict) -> dict:
        conn = get_connection()
        rows = conn.execute(
            "SELECT text, session_id, created_at FROM jira_notes WHERE ticket_id = ? ORDER BY created_at",
            (ticket["ticket_id"],),
        ).fetchall()
        ticket["notes"] = [dict(r) for r in rows]
        return ticket

    @staticmethod
    def _enrich_list(tickets: list[dict]) -> list[dict]:
        if not tickets:
            return tickets
        conn = get_connection()
        ids = [t["ticket_id"] for t in tickets]
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"SELECT ticket_id, text, session_id, created_at FROM jira_notes WHERE ticket_id IN ({placeholders}) ORDER BY created_at",
            ids,
        ).fetchall()
        notes_map: dict[str, list] = {}
        for r in rows:
            notes_map.setdefault(r["ticket_id"], []).append(
                {"text": r["text"], "session_id": r["session_id"], "created_at": r["created_at"]}
            )
        for t in tickets:
            t["notes"] = notes_map.get(t["ticket_id"], [])
        return tickets

    @staticmethod
    def create(ticket: dict) -> dict:
        conn = get_connection()
        now = _now()
        conn.execute(
            """INSERT INTO jira_tickets
               (ticket_id, workspace_id, ticket_key, title, status, priority,
                assignee, reporter, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticket["ticket_id"], ticket["workspace_id"], ticket["ticket_key"],
                ticket.get("title", ""), ticket.get("status", "todo"),
                ticket.get("priority", "medium"), ticket.get("assignee", ""),
                ticket.get("reporter", ""), ticket.get("created_at", now),
                ticket.get("updated_at", now),
            ),
        )
        for note in ticket.get("notes", []):
            conn.execute(
                "INSERT INTO jira_notes (ticket_id, text, session_id, created_at) VALUES (?, ?, ?, ?)",
                (ticket["ticket_id"], note.get("text", ""), note.get("session_id", ""), note.get("created_at", now)),
            )
        conn.commit()
        return JiraTicketDB.get_by_id(ticket["ticket_id"])

    @staticmethod
    def get_by_id(ticket_id: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM jira_tickets WHERE ticket_id = ?", (ticket_id,)).fetchone()
        if row is None:
            return None
        return JiraTicketDB._enrich_with_notes(_row_to_dict(row))

    @staticmethod
    def get_by_key(ticket_key: str) -> dict | None:
        conn = get_connection()
        row = conn.execute("SELECT * FROM jira_tickets WHERE ticket_key = ?", (ticket_key,)).fetchone()
        if row is None:
            return None
        return JiraTicketDB._enrich_with_notes(_row_to_dict(row))

    @staticmethod
    def list_by_workspace(workspace_id: str, status: str | None = None, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        if status:
            rows = conn.execute(
                "SELECT * FROM jira_tickets WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM jira_tickets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, limit),
            ).fetchall()
        return JiraTicketDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_status(status: str, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM jira_tickets WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
        return JiraTicketDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_by_assignee(assignee: str, limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM jira_tickets WHERE assignee = ? ORDER BY created_at DESC LIMIT ?",
            (assignee, limit),
        ).fetchall()
        return JiraTicketDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def list_all(limit: int = 1000) -> list[dict]:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM jira_tickets ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return JiraTicketDB._enrich_list([dict(r) for r in rows])

    @staticmethod
    def update(ticket_id: str, updates: dict) -> dict | None:
        conn = get_connection()
        updates["updated_at"] = _now()
        valid_cols = {
            "workspace_id", "title", "status", "priority",
            "assignee", "reporter", "updated_at", "ticket_key",
        }
        filtered = {k: v for k, v in updates.items() if k in valid_cols}
        if not filtered:
            return JiraTicketDB.get_by_id(ticket_id)

        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        values = list(filtered.values()) + [ticket_id]
        conn.execute(f"UPDATE jira_tickets SET {set_clause} WHERE ticket_id = ?", values)
        conn.commit()
        return JiraTicketDB.get_by_id(ticket_id)

    @staticmethod
    def delete(ticket_id: str) -> bool:
        conn = get_connection()
        cur = conn.execute("DELETE FROM jira_tickets WHERE ticket_id = ?", (ticket_id,))
        conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def add_note(ticket_id: str, text: str, session_id: str = "") -> dict | None:
        conn = get_connection()
        conn.execute(
            "INSERT INTO jira_notes (ticket_id, text, session_id, created_at) VALUES (?, ?, ?, ?)",
            (ticket_id, text, session_id, _now()),
        )
        conn.commit()
        return JiraTicketDB.get_by_id(ticket_id)

    @staticmethod
    def update_status(ticket_id: str, status: str) -> dict | None:
        return JiraTicketDB.update(ticket_id, {"status": status})

    @staticmethod
    def update_assignee(ticket_id: str, assignee: str) -> dict | None:
        return JiraTicketDB.update(ticket_id, {"assignee": assignee})
