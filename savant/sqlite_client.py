"""
SQLite client and connection management for Savant.

Drop-in replacement for mongo_client.py.
Database file: ~/.savant/savant.db (configurable via SAVANT_DB env var).
"""

import json
import logging
import os
import sqlite3
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema version — bump when tables change
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 5

# ---------------------------------------------------------------------------
# SQL: Table creation
# ---------------------------------------------------------------------------
_SCHEMA_SQL = """
-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id        TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT DEFAULT '',
    priority            TEXT DEFAULT 'medium',
    status              TEXT DEFAULT 'open',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    created_session_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ws_status ON workspaces(status);
CREATE INDEX IF NOT EXISTS idx_ws_created ON workspaces(created_at);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    task_id             TEXT PRIMARY KEY,
    seq                 INTEGER UNIQUE,
    workspace_id        TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT DEFAULT '',
    status              TEXT DEFAULT 'todo',
    priority            TEXT DEFAULT 'medium',
    date                TEXT,
    "order"             INTEGER DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    created_session_id  TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_date_order ON tasks(date, "order");
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_deps (
    task_id     TEXT NOT NULL,
    depends_on  TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on),
    FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on) REFERENCES tasks(task_id) ON DELETE CASCADE
);

-- Auto-increment counter for task seq
CREATE TABLE IF NOT EXISTS counters (
    name    TEXT PRIMARY KEY,
    value   INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('task_seq', 0);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
    note_id         TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    workspace_id    TEXT,
    text            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id);

-- Merge Requests
CREATE TABLE IF NOT EXISTS merge_requests (
    mr_id           TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    project_id      TEXT DEFAULT '',
    mr_iid          INTEGER DEFAULT 0,
    title           TEXT DEFAULT '',
    status          TEXT DEFAULT 'open',
    priority        TEXT DEFAULT 'medium',
    author          TEXT DEFAULT '',
    jira            TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_mr_workspace ON merge_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mr_status ON merge_requests(status);
CREATE INDEX IF NOT EXISTS idx_mr_created ON merge_requests(created_at);

-- MR notes
CREATE TABLE IF NOT EXISTS mr_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id       TEXT NOT NULL,
    session_id  TEXT DEFAULT '',
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(mr_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mr_notes_mr ON mr_notes(mr_id, created_at);

-- MR ↔ Session assignments
CREATE TABLE IF NOT EXISTS mr_sessions (
    mr_id       TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    role        TEXT DEFAULT 'author',
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (mr_id, session_id),
    FOREIGN KEY (mr_id) REFERENCES merge_requests(mr_id) ON DELETE CASCADE
);

-- Jira Tickets
CREATE TABLE IF NOT EXISTS jira_tickets (
    ticket_id       TEXT PRIMARY KEY,
    workspace_id    TEXT DEFAULT '',
    ticket_key      TEXT NOT NULL UNIQUE,
    title           TEXT DEFAULT '',
    status          TEXT DEFAULT 'todo',
    priority        TEXT DEFAULT 'medium',
    assignee        TEXT DEFAULT '',
    reporter        TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jira_workspace ON jira_tickets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_jira_status ON jira_tickets(status);
CREATE INDEX IF NOT EXISTS idx_jira_key ON jira_tickets(ticket_key);
CREATE INDEX IF NOT EXISTS idx_jira_created ON jira_tickets(created_at);

-- Jira notes
CREATE TABLE IF NOT EXISTS jira_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT NOT NULL,
    session_id  TEXT DEFAULT '',
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES jira_tickets(ticket_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jira_notes_ticket ON jira_notes(ticket_id, created_at);

-- Jira ↔ Session assignments
CREATE TABLE IF NOT EXISTS jira_sessions (
    ticket_id   TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    role        TEXT DEFAULT 'assignee',
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, session_id),
    FOREIGN KEY (ticket_id) REFERENCES jira_tickets(ticket_id) ON DELETE CASCADE
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    notification_id TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    message         TEXT NOT NULL,
    detail          TEXT DEFAULT '{}',
    workspace_id    TEXT,
    session_id      TEXT,
    read            INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notif_workspace ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notif_session ON notifications(session_id);

-- Preferences (replaces preferences.json)
CREATE TABLE IF NOT EXISTS preferences (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Meta key-value store (replaces ended_days.json, task-history.json, etc.)
CREATE TABLE IF NOT EXISTS meta (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Experiences (legacy — kept for backward compat, migrated to kg_nodes in v4)
CREATE TABLE IF NOT EXISTS experiences (
    experience_id   TEXT PRIMARY KEY,
    content         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'note',
    workspace_id    TEXT DEFAULT '',
    repo            TEXT DEFAULT '',
    files           TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_workspace ON experiences(workspace_id);
CREATE INDEX IF NOT EXISTS idx_exp_source ON experiences(source);
CREATE INDEX IF NOT EXISTS idx_exp_created ON experiences(created_at DESC);

-- Knowledge Graph: Nodes
CREATE TABLE IF NOT EXISTS kg_nodes (
    node_id     TEXT PRIMARY KEY,
    node_type   TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT DEFAULT '',
    metadata    TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    status      TEXT DEFAULT 'staged' NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kgn_type ON kg_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kgn_created ON kg_nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kgn_title ON kg_nodes(title);

-- Knowledge Graph: Edges
CREATE TABLE IF NOT EXISTS kg_edges (
    edge_id     TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
    edge_type   TEXT NOT NULL,
    weight      REAL DEFAULT 1.0,
    label       TEXT DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kge_source ON kg_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_kge_target ON kg_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_kge_type ON kg_edges(edge_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kge_unique ON kg_edges(source_id, target_id, edge_type);
"""

# ---------------------------------------------------------------------------
# Singleton client
# ---------------------------------------------------------------------------

# Per-thread connection pool — each thread gets its own sqlite3.Connection so
# concurrent execute()/commit() calls across threads never corrupt shared state.
# This fixes SQLITE_MISUSE ("bad parameter or other API misuse") and nested-
# transaction errors that occur when the AST indexer background thread and
# Flask request threads share a single connection object.
_thread_local = threading.local()


class SQLiteClient:
    """Thread-safe SQLite client with singleton pattern.

    Each thread transparently gets its own sqlite3.Connection via
    ``_thread_local``.  The singleton only stores the db_path and the
    initial schema-init connection; ``get_connection()`` always returns the
    calling thread's private connection, creating one on first use.
    """

    _instance: Optional['SQLiteClient'] = None
    _lock = threading.Lock()
    _migration_lock = threading.Lock()   # serialise migration runs

    def __init__(self):
        self.db_path: Optional[str] = None
        self.connected = False

    @classmethod
    def get_instance(cls) -> 'SQLiteClient':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _make_connection(self) -> sqlite3.Connection:
        """Open a new sqlite3.Connection with standard pragma config."""
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=10.0,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
        # Load sqlite-vec extension so ctx_vec_chunks virtual table is
        # accessible on every thread-local connection (not just the init thread).
        try:
            import sqlite_vec
            conn.enable_load_extension(True)
            sqlite_vec.load(conn)
            conn.enable_load_extension(False)
        except Exception:
            pass  # sqlite_vec optional; context search degrades gracefully
        return conn

    def connect(self, db_path: Optional[str] = None) -> bool:
        if self.connected:
            return True

        self.db_path = db_path or os.environ.get(
            "SAVANT_DB",
            os.path.expanduser("~/.savant/savant.db")
        )

        try:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            logger.info(f"Connecting to SQLite: {self.db_path}")

            # Open the schema-init connection and store it as the calling
            # thread's local connection so the main thread reuses it.
            init_conn = self._make_connection()
            _thread_local.conn = init_conn

            self._create_schema(init_conn)
            self.connected = True
            logger.info("SQLite connected successfully")
            return True

        except Exception as e:
            logger.error(f"SQLite connection failed: {e}")
            self.connected = False
            return False

    def disconnect(self):
        conn = getattr(_thread_local, "conn", None)
        if conn:
            conn.close()
            _thread_local.conn = None
        self.connected = False
        logger.info("SQLite disconnected")

    def _create_schema(self, conn: sqlite3.Connection):
        """Create all tables and indexes, then auto-run any pending migrations."""
        conn.executescript(_SCHEMA_SQL)
        self._run_migrations(conn)
        logger.info("SQLite schema created/verified")

    def _stamp_version(self, conn: sqlite3.Connection, version: int):
        """Write schema version to meta table."""
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("schema_version", str(version))
        )
        conn.commit()

    def _run_migrations(self, conn: sqlite3.Connection):
        """Run schema migrations automatically on startup. Each migration is
        idempotent and its version is stamped immediately after it succeeds,
        so a crash mid-way only re-runs the failed step next time."""
        with self._migration_lock:
            try:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key = 'schema_version'"
                ).fetchone()
                current = int(row[0]) if row else 0
            except Exception:
                current = 0

        if current < 2:
            # v2: Drop FK constraint on jira_tickets.workspace_id, allow empty
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS _jira_tickets_new (
                        ticket_id       TEXT PRIMARY KEY,
                        workspace_id    TEXT DEFAULT '',
                        ticket_key      TEXT NOT NULL UNIQUE,
                        title           TEXT DEFAULT '',
                        status          TEXT DEFAULT 'todo',
                        priority        TEXT DEFAULT 'medium',
                        assignee        TEXT DEFAULT '',
                        reporter        TEXT DEFAULT '',
                        created_at      TEXT NOT NULL,
                        updated_at      TEXT NOT NULL
                    );
                    INSERT OR IGNORE INTO _jira_tickets_new SELECT * FROM jira_tickets;
                    DROP TABLE IF EXISTS jira_tickets;
                    ALTER TABLE _jira_tickets_new RENAME TO jira_tickets;
                    CREATE INDEX IF NOT EXISTS idx_jira_workspace ON jira_tickets(workspace_id);
                    CREATE INDEX IF NOT EXISTS idx_jira_status ON jira_tickets(status);
                    CREATE INDEX IF NOT EXISTS idx_jira_key ON jira_tickets(ticket_key);
                    CREATE INDEX IF NOT EXISTS idx_jira_created ON jira_tickets(created_at);
                """)
                self._stamp_version(conn, 2)
                logger.info("Migration v2: jira_tickets FK constraint removed")
            except Exception as e:
                logger.warning(f"Migration v2 skipped: {e}")

        if current < 3:
            # v3: Add experiences table for knowledge layer
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS experiences (
                        experience_id   TEXT PRIMARY KEY,
                        content         TEXT NOT NULL,
                        source          TEXT NOT NULL DEFAULT 'note',
                        workspace_id    TEXT DEFAULT '',
                        repo            TEXT DEFAULT '',
                        files           TEXT DEFAULT '[]',
                        created_at      TEXT NOT NULL,
                        updated_at      TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_exp_workspace ON experiences(workspace_id);
                    CREATE INDEX IF NOT EXISTS idx_exp_source ON experiences(source);
                    CREATE INDEX IF NOT EXISTS idx_exp_created ON experiences(created_at DESC);
                """)
                self._stamp_version(conn, 3)
                logger.info("Migration v3: experiences table created")
            except Exception as e:
                logger.warning(f"Migration v3 skipped: {e}")

        if current < 4:
            # v4: Knowledge graph — kg_nodes + kg_edges tables + migrate experiences
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS kg_nodes (
                        node_id     TEXT PRIMARY KEY,
                        node_type   TEXT NOT NULL,
                        title       TEXT NOT NULL,
                        content     TEXT DEFAULT '',
                        metadata    TEXT DEFAULT '{}',
                        created_at  TEXT NOT NULL,
                        updated_at  TEXT NOT NULL,
                        status      TEXT DEFAULT 'staged' NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_kgn_type ON kg_nodes(node_type);
                    CREATE INDEX IF NOT EXISTS idx_kgn_created ON kg_nodes(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_kgn_title ON kg_nodes(title);
                    CREATE INDEX IF NOT EXISTS idx_kgn_status ON kg_nodes(status);

                    CREATE TABLE IF NOT EXISTS kg_edges (
                        edge_id     TEXT PRIMARY KEY,
                        source_id   TEXT NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
                        target_id   TEXT NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
                        edge_type   TEXT NOT NULL,
                        weight      REAL DEFAULT 1.0,
                        label       TEXT DEFAULT '',
                        created_at  TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_kge_source ON kg_edges(source_id);
                    CREATE INDEX IF NOT EXISTS idx_kge_target ON kg_edges(target_id);
                    CREATE INDEX IF NOT EXISTS idx_kge_type ON kg_edges(edge_type);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_kge_unique ON kg_edges(source_id, target_id, edge_type);
                """)
                # Migrate existing experiences → kg_nodes (type=insight)
                rows = conn.execute("SELECT * FROM experiences").fetchall()
                cols = [d[0] for d in conn.execute("SELECT * FROM experiences LIMIT 0").description] if rows else []
                for row in rows:
                    r = dict(zip(cols, row))
                    meta = json.dumps({"source": r.get("source", "note"), "files": r.get("files", "[]"), "repo": r.get("repo", "")})
                    title = (r.get("content", "") or "")[:120].split("\n")[0] or "Untitled insight"
                    conn.execute(
                        "INSERT OR IGNORE INTO kg_nodes (node_id, node_type, title, content, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        (r["experience_id"], "insight", title, r.get("content", ""), meta, r.get("created_at", ""), r.get("updated_at", ""))
                    )
                    ws_id = r.get("workspace_id", "")
                    if ws_id:
                        ws_row = conn.execute("SELECT name FROM workspaces WHERE workspace_id = ?", (ws_id,)).fetchone()
                        ws_name = ws_row[0] if ws_row else f"Project {ws_id[:8]}"
                        proj_id = f"proj_{ws_id}"
                        conn.execute(
                            "INSERT OR IGNORE INTO kg_nodes (node_id, node_type, title, content, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                            (proj_id, "project", ws_name, "", json.dumps({"workspace_id": ws_id}), r.get("created_at", ""), r.get("created_at", ""))
                        )
                        edge_id = f"edge_{r['experience_id']}_{proj_id}"
                        conn.execute(
                            "INSERT OR IGNORE INTO kg_edges (edge_id, source_id, target_id, edge_type, weight, label, created_at) VALUES (?,?,?,?,?,?,?)",
                            (edge_id, r["experience_id"], proj_id, "applies_to", 1.0, "", r.get("created_at", ""))
                        )
                self._stamp_version(conn, 4)
                migrated = len(rows)
                logger.info(f"Migration v4: kg_nodes + kg_edges created, migrated {migrated} experiences")
            except Exception as e:
                logger.warning(f"Migration v4 issue: {e}")

        if current < 5:
            # v5: Add status column to kg_nodes for staged/committed workflow
            try:
                conn.execute("ALTER TABLE kg_nodes ADD COLUMN status TEXT DEFAULT 'staged' NOT NULL")
                conn.execute("UPDATE kg_nodes SET status = 'committed' WHERE status = 'staged'")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_kgn_status ON kg_nodes(status)")
                self._stamp_version(conn, 5)
                logger.info("Migration v5: added status column to kg_nodes")
            except Exception as e:
                # Column may already exist on fresh installs (table created with status already)
                try:
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_kgn_status ON kg_nodes(status)")
                    self._stamp_version(conn, 5)
                except Exception:
                    pass
                logger.info(f"Migration v5: status column already exists or skipped: {e}")

    def get_connection(self) -> sqlite3.Connection:
        """Return this thread's private connection, creating one if needed."""
        conn = getattr(_thread_local, "conn", None)
        if conn is None:
            if not self.connected:
                if not self.connect():
                    raise RuntimeError("SQLite not connected")
                # connect() already set _thread_local.conn
                return _thread_local.conn
            # Background/worker thread — open a fresh per-thread connection
            conn = self._make_connection()
            _thread_local.conn = conn
        return conn

    def health_check(self) -> bool:
        try:
            conn = self.get_connection()
            conn.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error(f"SQLite health check failed: {e}")
        return False


# ---------------------------------------------------------------------------
# Global convenience functions (same interface as mongo_client.py)
# ---------------------------------------------------------------------------

def get_sqlite() -> SQLiteClient:
    return SQLiteClient.get_instance()


def get_connection() -> sqlite3.Connection:
    return SQLiteClient.get_instance().get_connection()


def init_sqlite() -> bool:
    client = get_sqlite()
    return client.connect()


def close_sqlite():
    client = get_sqlite()
    client.disconnect()
