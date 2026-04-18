"""Context DB layer using SQLite + sqlite-vec.

All context tables use the ctx_ prefix to avoid collisions with
existing workspace/task tables in savant.db.

Vector storage uses sqlite-vec's vec0 virtual table for KNN search.
"""

import logging
import sqlite3
import struct
from typing import Any, Dict, List, Optional, Union

import sqlite_vec

try:
    from ..sqlite_client import get_connection
except ImportError:
    from sqlite_client import get_connection

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
_CONTEXT_SCHEMA = """
CREATE TABLE IF NOT EXISTS ctx_repos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    path        TEXT NOT NULL,
    status      TEXT DEFAULT 'added',
    indexed_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ctx_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id         INTEGER NOT NULL REFERENCES ctx_repos(id) ON DELETE CASCADE,
    rel_path        TEXT NOT NULL,
    language        TEXT,
    is_memory_bank  INTEGER DEFAULT 0,
    mtime_ns        INTEGER,
    indexed_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_ctx_files_repo ON ctx_files(repo_id);
CREATE INDEX IF NOT EXISTS idx_ctx_files_lang ON ctx_files(language);
CREATE INDEX IF NOT EXISTS idx_ctx_files_mb   ON ctx_files(is_memory_bank, repo_id);

CREATE TABLE IF NOT EXISTS ctx_chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     INTEGER NOT NULL REFERENCES ctx_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ctx_chunks_file ON ctx_chunks(file_id);

CREATE TABLE IF NOT EXISTS ctx_ast_nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     INTEGER NOT NULL REFERENCES ctx_files(id) ON DELETE CASCADE,
    node_type   TEXT NOT NULL,
    name        TEXT NOT NULL,
    start_line  INTEGER NOT NULL,
    end_line    INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ctx_ast_file ON ctx_ast_nodes(file_id);
"""


def serialize_f32(vec: List[float]) -> bytes:
    """Serialize a list of floats to sqlite-vec binary format."""
    return struct.pack(f"{len(vec)}f", *vec)


def _load_vec_extension(conn: sqlite3.Connection) -> bool:
    """Load sqlite-vec extension into connection. Returns True on success."""
    try:
        # Already loaded on this connection — no-op
        conn.execute("select vec_version()").fetchone()
        return True
    except Exception:
        pass
    try:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return True
    except Exception as e:
        logger.error(f"Failed to load sqlite-vec: {e}")
        return False


def init_context_schema() -> bool:
    """Create context tables and vec0 virtual table. Returns True on success."""
    conn = get_connection()

    # Load sqlite-vec
    if not _load_vec_extension(conn):
        logger.error("sqlite-vec not available — context search disabled")
        return False

    try:
        conn.executescript(_CONTEXT_SCHEMA)
        # Create vec0 virtual table (can't be in executescript)
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS ctx_vec_chunks "
            "USING vec0(embedding float[768])"
        )
        conn.commit()
        logger.info("Context schema initialized")
        return True
    except Exception as e:
        logger.error(f"Failed to init context schema: {e}")
        return False


def vec_loaded() -> bool:
    """Check if sqlite-vec is loaded in the current connection."""
    try:
        conn = get_connection()
        _load_vec_extension(conn)
        row = conn.execute("SELECT vec_version()").fetchone()
        return row is not None
    except Exception:
        return False


def vec_version() -> Optional[str]:
    try:
        conn = get_connection()
        _load_vec_extension(conn)
        row = conn.execute("SELECT vec_version()").fetchone()
        return row[0] if row else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Repo CRUD
# ---------------------------------------------------------------------------

class ContextDB:
    """Static-method DB operations for context tables."""

    @staticmethod
    def add_repo(name: str, path: str) -> Dict[str, Any]:
        conn = get_connection()
        conn.execute(
            "INSERT OR IGNORE INTO ctx_repos (name, path) VALUES (?, ?)",
            (name, path)
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ctx_repos WHERE name = ?", (name,)
        ).fetchone()
        return dict(row) if row else {}

    @staticmethod
    def get_repo(name: str) -> Optional[Dict[str, Any]]:
        conn = get_connection()
        row = conn.execute(
            "SELECT * FROM ctx_repos WHERE name = ?", (name,)
        ).fetchone()
        return dict(row) if row else None

    @staticmethod
    def list_repos() -> List[Dict[str, Any]]:
        conn = get_connection()
        rows = conn.execute(
            """SELECT r.*,
                      (SELECT COUNT(*) FROM ctx_files WHERE repo_id = r.id) AS file_count,
                      (SELECT COUNT(*) FROM ctx_files WHERE repo_id = r.id AND is_memory_bank = 1) AS memory_bank_count,
                      (SELECT COUNT(*) FROM ctx_chunks c
                       JOIN ctx_files f ON c.file_id = f.id
                       WHERE f.repo_id = r.id) AS chunk_count,
                      (SELECT COUNT(*) FROM ctx_ast_nodes a
                       JOIN ctx_files f ON a.file_id = f.id
                       WHERE f.repo_id = r.id) AS ast_node_count
               FROM ctx_repos r ORDER BY r.name"""
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # Attach language breakdown
            langs = conn.execute(
                """SELECT language, COUNT(*) AS count FROM ctx_files
                   WHERE repo_id = ? AND is_memory_bank = 0
                   GROUP BY language ORDER BY count DESC""",
                (d["id"],)
            ).fetchall()
            d["languages"] = {row["language"]: row["count"] for row in langs}
            result.append(d)
        return result

    @staticmethod
    def delete_repo(name: str) -> bool:
        conn = get_connection()
        repo = conn.execute(
            "SELECT id FROM ctx_repos WHERE name = ?", (name,)
        ).fetchone()
        if not repo:
            return False
        repo_id = repo["id"]
        # Delete vec chunks that belong to this repo's files
        conn.execute(
            """DELETE FROM ctx_vec_chunks WHERE rowid IN (
                 SELECT c.id FROM ctx_chunks c
                 JOIN ctx_files f ON c.file_id = f.id
                 WHERE f.repo_id = ?
               )""", (repo_id,)
        )
        conn.execute("DELETE FROM ctx_repos WHERE id = ?", (repo_id,))
        conn.commit()
        return True

    @staticmethod
    def update_repo_status(name: str, status: str, indexed_at: str = None):
        conn = get_connection()
        if indexed_at:
            conn.execute(
                "UPDATE ctx_repos SET status = ?, indexed_at = ? WHERE name = ?",
                (status, indexed_at, name)
            )
        else:
            conn.execute(
                "UPDATE ctx_repos SET status = ? WHERE name = ?",
                (status, name)
            )
        conn.commit()

    @staticmethod
    def clear_repo_data(repo_id: int):
        """Delete all files and chunks for a repo (for reindex)."""
        conn = get_connection()
        conn.execute(
            """DELETE FROM ctx_vec_chunks WHERE rowid IN (
                 SELECT c.id FROM ctx_chunks c
                 JOIN ctx_files f ON c.file_id = f.id
                 WHERE f.repo_id = ?
               )""", (repo_id,)
        )
        conn.execute("DELETE FROM ctx_files WHERE repo_id = ?", (repo_id,))
        conn.commit()

    # ------------------------------------------------------------------
    # File & chunk operations
    # ------------------------------------------------------------------

    @staticmethod
    def insert_file(repo_id: int, rel_path: str, language: str,
                    is_memory_bank: bool, mtime_ns: int, indexed_at: str) -> int:
        conn = get_connection()
        cur = conn.execute(
            """INSERT INTO ctx_files (repo_id, rel_path, language, is_memory_bank, mtime_ns, indexed_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (repo_id, rel_path, language, int(is_memory_bank), mtime_ns, indexed_at)
        )
        conn.commit()
        return cur.lastrowid

    @staticmethod
    def insert_chunk(file_id: int, chunk_index: int, content: str,
                     embedding: List[float]) -> int:
        conn = get_connection()
        cur = conn.execute(
            "INSERT INTO ctx_chunks (file_id, chunk_index, content) VALUES (?, ?, ?)",
            (file_id, chunk_index, content)
        )
        chunk_id = cur.lastrowid
        # Insert matching vector
        conn.execute(
            "INSERT INTO ctx_vec_chunks (rowid, embedding) VALUES (?, ?)",
            (chunk_id, serialize_f32(embedding))
        )
        conn.commit()
        return chunk_id

    @staticmethod
    def insert_ast_node(file_id: int, node_type: str, name: str, start_line: int, end_line: int) -> int:
        conn = get_connection()
        cur = conn.execute(
            """INSERT INTO ctx_ast_nodes (file_id, node_type, name, start_line, end_line)
               VALUES (?, ?, ?, ?, ?)""",
            (file_id, node_type, name, start_line, end_line)
        )
        conn.commit()
        return cur.lastrowid

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    @staticmethod
    def vector_search(query_vec: List[float], limit: int = 10,
                      repo_filter: Optional[Union[str, List[str]]] = None,
                      memory_bank_only: bool = False,
                      exclude_memory_bank: bool = False) -> List[Dict[str, Any]]:
        """KNN vector search. Returns ranked results."""
        conn = get_connection()
        _load_vec_extension(conn)

        # Step 1: get KNN candidates from vec0
        knn_rows = conn.execute(
            "SELECT rowid, distance FROM ctx_vec_chunks "
            "WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
            (serialize_f32(query_vec), limit * 3)  # over-fetch then filter
        ).fetchall()

        if not knn_rows:
            return []

        chunk_ids = [r["rowid"] for r in knn_rows]
        dist_map = {r["rowid"]: r["distance"] for r in knn_rows}

        # Step 2: join with metadata
        placeholders = ",".join("?" * len(chunk_ids))
        sql = f"""
            SELECT c.id AS chunk_id, c.chunk_index, c.content,
                   f.rel_path, f.language, f.is_memory_bank,
                   r.name AS repo
            FROM ctx_chunks c
            JOIN ctx_files f ON c.file_id = f.id
            JOIN ctx_repos r ON f.repo_id = r.id
            WHERE c.id IN ({placeholders})
        """
        params: list = list(chunk_ids)

        if repo_filter:
            repo_list = repo_filter if isinstance(repo_filter, list) else [repo_filter]
            rp = ",".join("?" * len(repo_list))
            sql += f" AND r.name IN ({rp})"
            params.extend(repo_list)

        if memory_bank_only:
            sql += " AND f.is_memory_bank = 1"
        elif exclude_memory_bank:
            sql += " AND f.is_memory_bank = 0"

        rows = conn.execute(sql, params).fetchall()

        results = []
        for row in rows:
            d = dict(row)
            d["distance"] = dist_map.get(d["chunk_id"], 999.0)
            d["rank"] = max(0.0, 1.0 - d["distance"] / 2.0)  # normalize
            results.append(d)

        results.sort(key=lambda x: x["distance"])
        return results[:limit]

    @staticmethod
    def search_ast_nodes(query: str, repo_filter: Optional[Union[str, List[str]]] = None) -> List[Dict[str, Any]]:
        conn = get_connection()
        sql = """
            SELECT a.id, a.node_type, a.name, a.start_line, a.end_line,
                   f.rel_path, r.name AS repo
            FROM ctx_ast_nodes a
            JOIN ctx_files f ON a.file_id = f.id
            JOIN ctx_repos r ON f.repo_id = r.id
            WHERE a.name LIKE ?
        """
        params: list = [f"%{query}%"]

        if repo_filter:
            repo_list = repo_filter if isinstance(repo_filter, list) else [repo_filter]
            rp = ",".join("?" * len(repo_list))
            sql += f" AND r.name IN ({rp})"
            params.extend(repo_list)

        sql += " LIMIT 50"

        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Memory bank
    # ------------------------------------------------------------------

    @staticmethod
    def list_ast_nodes(repo_filter=None) -> List[Dict[str, Any]]:
        conn = get_connection()
        sql = """
            SELECT r.name AS repo, f.rel_path AS path, a.node_type, a.name, a.start_line, a.end_line
            FROM ctx_ast_nodes a
            JOIN ctx_files f ON a.file_id = f.id
            JOIN ctx_repos r ON f.repo_id = r.id
        """
        params: list = []
        if repo_filter:
            repo_list = repo_filter if isinstance(repo_filter, list) else [repo_filter]
            rp = ",".join("?" * len(repo_list))
            sql += f" WHERE r.name IN ({rp})"
            params.extend(repo_list)

        sql += " ORDER BY r.name, f.rel_path, a.start_line"
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def list_memory_resources(repo_filter=None) -> List[Dict[str, Any]]:
        conn = get_connection()
        sql = """
            SELECT r.name AS repo, f.rel_path AS path, f.language,
                   f.is_memory_bank, f.indexed_at, f.created_at,
                   (SELECT COUNT(*) FROM ctx_chunks c WHERE c.file_id = f.id) AS chunk_count
            FROM ctx_files f
            JOIN ctx_repos r ON f.repo_id = r.id
            WHERE f.is_memory_bank = 1
        """
        params = []
        if repo_filter:
            repo_list = repo_filter if isinstance(repo_filter, list) else [repo_filter]
            rp = ",".join("?" * len(repo_list))
            sql += f" AND r.name IN ({rp})"
            params.extend(repo_list)

        sql += " ORDER BY r.name, f.rel_path"
        rows = conn.execute(sql, params).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["uri"] = f"{d['repo']}:{d['path']}"
            results.append(d)
        return results

    @staticmethod
    def list_code_files(repo_filter=None) -> List[Dict[str, Any]]:
        """List non-memory-bank code files, grouped by repo."""
        conn = get_connection()
        sql = """
            SELECT r.name AS repo, f.rel_path AS path, f.language,
                   f.is_memory_bank, f.indexed_at, f.created_at,
                   (SELECT COUNT(*) FROM ctx_chunks c WHERE c.file_id = f.id) AS chunk_count
            FROM ctx_files f
            JOIN ctx_repos r ON f.repo_id = r.id
            WHERE f.is_memory_bank = 0
        """
        params = []
        if repo_filter:
            repo_list = repo_filter if isinstance(repo_filter, list) else [repo_filter]
            rp = ",".join("?" * len(repo_list))
            sql += f" AND r.name IN ({rp})"
            params.extend(repo_list)

        sql += " ORDER BY r.name, f.rel_path"
        rows = conn.execute(sql, params).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["uri"] = f"{d['repo']}:{d['path']}"
            results.append(d)
        return results

    @staticmethod
    def read_code_file(uri: str) -> Optional[Dict[str, Any]]:
        """Read a code file's content by uri (repo:path)."""
        conn = get_connection()
        if ":" in uri:
            repo_name, rel_path = uri.split(":", 1)
        else:
            rel_path = uri
            repo_name = None

        if repo_name:
            file_row = conn.execute(
                """SELECT f.id, f.rel_path, f.language, f.is_memory_bank, f.created_at, r.name AS repo
                   FROM ctx_files f JOIN ctx_repos r ON f.repo_id = r.id
                   WHERE f.rel_path = ? AND r.name = ? AND f.is_memory_bank = 0""",
                (rel_path, repo_name)
            ).fetchone()
        else:
            file_row = conn.execute(
                """SELECT f.id, f.rel_path, f.language, f.is_memory_bank, f.created_at,
                          (SELECT name FROM ctx_repos WHERE id = f.repo_id) AS repo
                   FROM ctx_files f WHERE f.rel_path = ? AND f.is_memory_bank = 0""",
                (rel_path,)
            ).fetchone()

        if not file_row:
            return None

        chunks = conn.execute(
            "SELECT content FROM ctx_chunks WHERE file_id = ? ORDER BY chunk_index",
            (file_row["id"],)
        ).fetchall()

        return {
            "uri": uri,
            "repo": file_row["repo"],
            "path": file_row["rel_path"],
            "language": file_row["language"],
            "is_memory_bank": False,
            "content": "\n".join(c["content"] for c in chunks),
            "chunk_count": len(chunks),
            "created_at": file_row["created_at"],
        }

    @staticmethod
    def read_memory_resource(uri: str) -> Optional[Dict[str, Any]]:
        conn = get_connection()

        if ":" in uri:
            repo_name, rel_path = uri.split(":", 1)
        else:
            rel_path = uri
            repo_name = None

        if repo_name:
            file_row = conn.execute(
                """SELECT f.id, f.rel_path, f.language, f.is_memory_bank, f.created_at, r.name AS repo
                   FROM ctx_files f JOIN ctx_repos r ON f.repo_id = r.id
                   WHERE f.rel_path = ? AND r.name = ? AND f.is_memory_bank = 1""",
                (rel_path, repo_name)
            ).fetchone()
        else:
            file_row = conn.execute(
                """SELECT f.id, f.rel_path, f.language, f.is_memory_bank, f.created_at,
                          (SELECT name FROM ctx_repos WHERE id = f.repo_id) AS repo
                   FROM ctx_files f WHERE f.rel_path = ? AND f.is_memory_bank = 1""",
                (rel_path,)
            ).fetchone()

        if not file_row:
            return None

        chunks = conn.execute(
            "SELECT content FROM ctx_chunks WHERE file_id = ? ORDER BY chunk_index",
            (file_row["id"],)
        ).fetchall()

        return {
            "uri": uri,
            "repo": file_row["repo"],
            "path": file_row["rel_path"],
            "language": file_row["language"],
            "is_memory_bank": bool(file_row["is_memory_bank"]),
            "content": "\n".join(c["content"] for c in chunks),
            "chunk_count": len(chunks),
            "created_at": file_row["created_at"],
        }

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    @staticmethod
    def get_stats() -> Dict[str, Any]:
        conn = get_connection()
        if not _load_vec_extension(conn):
            return {"repos": 0, "files": 0, "chunks": 0}
        try:
            repos = conn.execute("SELECT COUNT(*) AS n FROM ctx_repos").fetchone()
            files = conn.execute("SELECT COUNT(*) AS n FROM ctx_files").fetchone()
            chunks = conn.execute("SELECT COUNT(*) AS n FROM ctx_chunks").fetchone()
            return {
                "repos": repos["n"] if repos else 0,
                "files": files["n"] if files else 0,
                "chunks": chunks["n"] if chunks else 0,
            }
        except Exception:
            return {"repos": 0, "files": 0, "chunks": 0}

    @staticmethod
    def get_repo_stats() -> List[Dict[str, Any]]:
        conn = get_connection()
        rows = conn.execute("""
            SELECT r.id, r.name, r.path, r.status, r.indexed_at, r.created_at,
                   (SELECT COUNT(*) FROM ctx_files WHERE repo_id = r.id) AS file_count,
                   (SELECT COUNT(*) FROM ctx_chunks WHERE file_id IN (SELECT id FROM ctx_files WHERE repo_id = r.id)) AS chunk_count,
                   (SELECT COUNT(*) FROM ctx_ast_nodes WHERE file_id IN (SELECT id FROM ctx_files WHERE repo_id = r.id)) AS ast_node_count
            FROM ctx_repos r
            ORDER BY r.name
        """).fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def get_repo_languages(repo_id: int) -> List[Dict[str, Any]]:
        conn = get_connection()
        rows = conn.execute(
            """SELECT language, COUNT(*) AS count FROM ctx_files
               WHERE repo_id = ? GROUP BY language ORDER BY count DESC""",
            (repo_id,)
        ).fetchall()
        return [dict(r) for r in rows]
