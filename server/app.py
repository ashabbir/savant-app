import os
import json
import re
import shutil
import yaml
import glob
import time
import uuid
import logging
import hashlib
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from flask import Flask, jsonify, request, abort, send_file
from sqlite_client import get_sqlite, get_connection, init_sqlite, close_sqlite
from db.workspaces import WorkspaceDB
from db.workspace_session_links import WorkspaceSessionLinkDB
from db.tasks import TaskDB
from db.notes import NoteDB
from db.merge_requests import MergeRequestDB
from db.jira_tickets import JiraTicketDB
from db.notifications import NotificationDB
from hardening import rate_limit, validate_request, safe_limit
from abilities.routes import abilities_bp
from abilities.bootstrap import abilities_bootstrap_status
from context.routes import context_bp
from knowledge.routes import knowledge_bp
from server_paths import get_server_data_dir, get_server_db_path, get_server_abilities_base_dir

app = Flask(__name__)
_API_ONLY_MODE = os.environ.get("SAVANT_API_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize SQLite on startup
with app.app_context():
    if not init_sqlite():
        logger.error("SQLite initialization failed")

# Register abilities API blueprint
app.register_blueprint(abilities_bp)

# Register context API blueprint
app.register_blueprint(context_bp)

# Register knowledge API blueprint
app.register_blueprint(knowledge_bp)

# SQLite connection is managed by singleton — no per-request teardown needed


def _read_preferences():
    conn = get_connection()
    row = conn.execute(
        "SELECT value FROM preferences WHERE key = ?",
        ("__all__",),
    ).fetchone()
    if not row or not row[0]:
        return {}
    try:
        return json.loads(row[0])
    except Exception:
        return {}


def _write_preferences(prefs):
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
        ("__all__", json.dumps(prefs)),
    )
    conn.commit()


@app.after_request
def add_no_cache(response):
    ct = response.content_type or ''
    if 'text/html' in ct or 'javascript' in ct or 'text/css' in ct:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response


@app.before_request
def enforce_api_only_mode():
    if not _API_ONLY_MODE:
        return None
    p = request.path or "/"
    if p.startswith("/api/") or p in {"/health/live", "/health/ready"}:
        return None
    abort(404)


@app.route("/api/db/health")
def api_db_health():
    try:
        ok = bool(get_connection().execute("SELECT 1").fetchone())
        return jsonify({"status": "healthy", "connected": ok})
    except Exception as e:
        return jsonify({"status": "unhealthy", "connected": False, "error": str(e)}), 503


@app.route("/api/system/info")
def api_system_info():
    from sqlite_client import get_connection

    def _mcp_entry(name, default_port):
        url = os.environ.get(f"SAVANT_MCP_{name.upper()}_URL", "")
        port_env = os.environ.get(f"SAVANT_MCP_{name.upper()}_PORT")
        try:
            port = int(port_env) if port_env else default_port
        except Exception:
            port = default_port
        return {
            "url": url,
            "port": port,
            "status": "ok" if url else "offline",
        }

    db_path = os.environ.get("SAVANT_DB", str(get_server_db_path()))
    try:
        conn = get_connection()
        db_ok = bool(conn.execute("SELECT 1").fetchone())
    except Exception as e:
        db_ok = False
        db_error = str(e)
    else:
        db_error = ""

    build_info_path = Path(__file__).resolve().parent / "build-info.json"
    build_info = {}
    if build_info_path.exists():
        try:
            build_info = json.loads(build_info_path.read_text(encoding="utf-8"))
        except Exception:
            build_info = {}

    return jsonify({
        "version": build_info.get("version") or "unknown",
        "flask": {
            "status": "ok",
            "port": int(os.environ.get("FLASK_PORT", "8090")),
        },
        "build": {
            "version": build_info.get("version") or "unknown",
            "branch": build_info.get("branch") or "unknown",
            "commit": build_info.get("commit") or "",
            "worktree": build_info.get("worktree"),
            "built_at": build_info.get("built_at"),
        },
        "mcp_servers": {
            "workspace": _mcp_entry("workspace", int(os.environ.get("SAVANT_MCP_WORKSPACE_PORT", "8091"))),
            "abilities": _mcp_entry("abilities", int(os.environ.get("SAVANT_MCP_ABILITIES_PORT", "8092"))),
        },
        "blueprints": [
            "abilities",
            "context",
            "knowledge",
            "workspaces",
            "tasks",
        ],
        "context_sources": {
            "enabled": {
                "GITHUB_TOKEN": bool(os.environ.get("GITHUB_TOKEN")),
                "GITLAB_TOKEN": bool(os.environ.get("GITLAB_TOKEN")),
                "BASE_CODE_DIR": bool(os.environ.get("BASE_CODE_DIR")),
            },
            "any_enabled": bool(os.environ.get("GITHUB_TOKEN") or os.environ.get("GITLAB_TOKEN") or os.environ.get("BASE_CODE_DIR")),
            "missing": [k for k in ("GITHUB_TOKEN", "GITLAB_TOKEN", "BASE_CODE_DIR") if not os.environ.get(k)],
        },
        "environment": {
            "python": sys.version.split()[0],
            "platform": sys.platform,
        },
        "directories": {
            "savant_app": str(Path(__file__).resolve().parent.parent),
            "data_dir": str(get_server_data_dir()),
            "abilities_dir": str(get_server_abilities_base_dir()),
        },
        "database": {
            "status": "healthy" if db_ok else "unhealthy",
            "size_bytes": Path(db_path).stat().st_size if Path(db_path).exists() else 0,
            "path": db_path,
            "error": db_error,
        },
        "abilities": abilities_bootstrap_status(),
    })


def _read_task_ended_days() -> list[str]:
    prefs = _read_preferences()
    days = prefs.get("task_ended_days", [])
    return days if isinstance(days, list) else []


def _write_task_ended_days(days: list[str]) -> None:
    prefs = _read_preferences()
    prefs["task_ended_days"] = sorted({d for d in days if isinstance(d, str) and d})
    _write_preferences(prefs)


@app.route("/api/tasks", methods=["GET", "POST"])
def api_tasks():
    if request.method == "GET":
        workspace_id = request.args.get("workspace_id") or None
        status = request.args.get("status") or None
        date = request.args.get("date") or None

        if workspace_id:
            tasks = TaskDB.list_by_workspace(workspace_id, status=status, limit=1000)
        elif status and status != "all":
            tasks = TaskDB.list_by_status(status, limit=1000)
        elif date:
            tasks = TaskDB.list_by_date(date)
        else:
            tasks = TaskDB.list_all()
        return jsonify(tasks)

    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("title") or "").strip()
    workspace_id = (data.get("workspace_id") or "").strip()
    if not title or not workspace_id:
        return jsonify({"error": "title and workspace_id required"}), 400

    payload = {
        "task_id": data.get("task_id") or f"task_{uuid.uuid4().hex[:12]}",
        "workspace_id": workspace_id,
        "title": title,
        "description": data.get("description", ""),
        "status": data.get("status", "todo"),
        "priority": data.get("priority", "medium"),
        "date": data.get("date") or request.args.get("date"),
        "order": data.get("order", 0),
        "created_session_id": data.get("created_session_id"),
        "depends_on": data.get("depends_on", []) or [],
    }
    task = TaskDB.create(payload)
    return jsonify(task)


@app.route("/api/tasks/<task_id>", methods=["GET", "PUT", "DELETE"])
def api_task_by_id(task_id):
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404

    if request.method == "GET":
        return jsonify(task)

    if request.method == "PUT":
        data = request.get_json(force=True, silent=True) or {}
        updated = TaskDB.update(task_id, data)
        if not updated:
            return jsonify({"error": "Task not found"}), 404
        return jsonify(updated)

    deleted = TaskDB.delete(task_id)
    if not deleted:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"ok": True, "deleted": task_id})


@app.route("/api/tasks/<task_id>/deps", methods=["POST"])
def api_task_add_dependency(task_id):
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404

    data = request.get_json(force=True, silent=True) or {}
    depends_on = (data.get("depends_on") or "").strip()
    if not depends_on:
        return jsonify({"error": "depends_on required"}), 400

    dep_task = TaskDB.get_by_id(depends_on)
    if not dep_task:
        return jsonify({"error": "Dependency task not found"}), 404

    ok = TaskDB.add_dependency(task_id, depends_on)
    if not ok:
        return jsonify({"error": "Could not add dependency"}), 500
    return jsonify(TaskDB.get_by_id(task_id))


@app.route("/api/tasks/<task_id>/deps/<depends_on>", methods=["DELETE"])
def api_task_remove_dependency(task_id, depends_on):
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404

    dep_task = TaskDB.get_by_id(depends_on)
    if not dep_task:
        return jsonify({"error": "Dependency task not found"}), 404

    ok = TaskDB.remove_dependency(task_id, depends_on)
    if not ok:
        return jsonify({"error": "Dependency link not found"}), 404
    return jsonify(TaskDB.get_by_id(task_id))


@app.route("/api/tasks/ended-days", methods=["GET"])
def api_tasks_ended_days():
    return jsonify(_read_task_ended_days())


@app.route("/api/tasks/graph", methods=["GET"])
def api_tasks_graph():
    workspace_id = (request.args.get("workspace_id") or "").strip()
    if not workspace_id:
        return jsonify({"error": "workspace_id required"}), 400

    tasks = TaskDB.list_by_workspace(workspace_id, limit=1000)
    nodes = []
    edges = []
    for task in tasks:
        task_id = task.get("task_id") or task.get("id")
        if not task_id:
          continue
        nodes.append({
            "id": task_id,
            "title": task.get("title") or task_id,
            "description": task.get("description") or "",
            "status": task.get("status") or "todo",
            "priority": task.get("priority") or "medium",
            "date": task.get("date"),
            "created_at": task.get("created_at"),
            "depends_on": list(task.get("depends_on") or []),
        })
        for dep_id in task.get("depends_on") or []:
            edges.append({"from": task_id, "to": dep_id})

    return jsonify({"workspace_id": workspace_id, "nodes": nodes, "edges": edges})


@app.route("/api/tasks/jira", methods=["GET"])
def api_tasks_jira():
    workspace_id = (request.args.get("workspace_id") or "").strip()
    if not workspace_id:
        return jsonify({"error": "workspace_id required"}), 400
    tickets = JiraTicketDB.list_by_workspace(workspace_id, limit=1000)
    return jsonify(tickets)


@app.route("/api/merge-requests", methods=["GET"])
def api_merge_requests():
    workspace_id = (request.args.get("workspace_id") or "").strip()
    if not workspace_id:
        return jsonify({"error": "workspace_id required"}), 400
    merge_requests = MergeRequestDB.list_by_workspace(workspace_id, limit=1000)
    return jsonify(merge_requests)


@app.route("/api/tasks/end-day", methods=["POST"])
def api_tasks_end_day():
    data = request.get_json(force=True, silent=True) or {}
    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "date required"}), 400
    try:
        from_dt = datetime.fromisoformat(date_str + "T00:00:00")
        to_date = (from_dt + timedelta(days=1)).date().isoformat()
    except Exception:
        return jsonify({"error": "invalid date"}), 400

    moved = TaskDB.move_incomplete_tasks(date_str, to_date)
    ended_days = _read_task_ended_days()
    if date_str not in ended_days:
        ended_days.append(date_str)
    _write_task_ended_days(ended_days)
    return jsonify({"ok": True, "from": date_str, "to": to_date, "moved": moved})


@app.route("/api/tasks/unend-day", methods=["POST"])
def api_tasks_unend_day():
    data = request.get_json(force=True, silent=True) or {}
    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "date required"}), 400
    ended_days = [d for d in _read_task_ended_days() if d != date_str]
    _write_task_ended_days(ended_days)
    return jsonify({"ok": True, "date": date_str})


@app.route("/api/mcp/health/<name>")
def api_mcp_health(name):
    try:
        if name == "workspace":
            _read_workspaces()
        return jsonify({"status": "ok", "name": name})
    except Exception as e:
        return jsonify({"status": "error", "name": name, "error": str(e)}), 503


@app.route("/api/mcp")
def api_mcp():
    info = api_system_info().get_json() if hasattr(api_system_info(), "get_json") else {}
    return jsonify({
        "servers": [
            {
                "name": name,
                "type": "sse",
                "command": "savant-server",
                "args": [],
                "tools": [],
                "port": details.get("port"),
                "url": details.get("url"),
            }
            for name, details in (info.get("mcp_servers") or {}).items()
        ],
    })


@app.route("/api/check-mcp")
def api_check_mcp():
    providers = ["copilot", "claude", "gemini", "codex", "hermes"]
    prefs = _read_preferences()
    enabled = set(prefs.get("enabled_providers") or providers)
    return jsonify({
        provider: {
            "label": provider,
            "config_exists": True,
            "savant_configured": provider in enabled,
        }
        for provider in providers
    })


@app.route("/api/setup-mcp", methods=["POST"])
def api_setup_mcp():
    data = request.get_json(force=True, silent=True) or {}
    providers = data.get("providers") or [data.get("provider")]
    providers = [str(p).strip().lower() for p in providers if str(p).strip()]
    if not providers:
        return jsonify({"results": [], "summary": {"configured": 0, "skipped": 0, "errors": 0}})
    return jsonify({
        "results": [
            {
                "provider": p,
                "label": p,
                "status": "skipped",
                "reason": "Desktop config editing is only available in the Electron client",
            }
            for p in providers
        ],
        "summary": {"configured": 0, "skipped": len(providers), "errors": 0},
    }), 501


def _empty_usage_payload(provider: str):
    return {
        "provider": provider,
        "loading": False,
        "models": [],
        "tools": [],
        "daily": [],
        "totals": {
            "sessions": 0,
            "messages": 0,
            "turns": 0,
            "tool_calls": 0,
            "total_hours": 0,
            "avg_session_minutes": 0,
            "avg_tools_per_turn": 0,
            "avg_turns_per_message": 0,
            "events": 0,
        },
    }


@app.route("/api/usage")
def api_usage():
    return jsonify(_empty_usage_payload("copilot"))


@app.route("/api/claude/usage")
def api_claude_usage():
    return jsonify(_empty_usage_payload("claude"))


@app.route("/api/codex/usage")
def api_codex_usage():
    return jsonify(_empty_usage_payload("codex"))


@app.route("/api/gemini/usage")
def api_gemini_usage():
    return jsonify(_empty_usage_payload("gemini"))


@app.route("/api/hermes/usage")
def api_hermes_usage():
    with _bg_lock:
        cached = _bg_cache.get("hermes_usage")
    if cached is not None:
        return jsonify(cached)
    return jsonify({
        "loading": True,
        "models": [],
        "tools": [],
        "daily": [],
        "totals": {
            "sessions": 0,
            "messages": 0,
            "turns": 0,
            "tool_calls": 0,
            "total_hours": 0,
            "avg_session_minutes": 0,
            "avg_tools_per_turn": 0,
            "avg_turns_per_message": 0,
            "events": 0,
        },
    })


SESSION_DIR = os.environ.get(
    "SESSION_DIR", os.path.expanduser("~/.copilot/session-state")
)

# --- Detect native vs Docker mode ---
_IN_DOCKER = os.path.isfile("/.dockerenv") or bool(os.environ.get("RUNNING_IN_DOCKER"))

# --- Claude Code data directories ---
CLAUDE_DIR = os.environ.get("CLAUDE_DIR",
    "/data/claude" if _IN_DOCKER else os.path.expanduser("~/.claude"))
GEMINI_DIR = os.environ.get("GEMINI_DIR",
    os.path.expanduser("~/.gemini"))
GEMINI_CHATS_DIR = os.path.join(GEMINI_DIR, "tmp", "savant-app", "chats")
META_DIR = os.environ.get("META_DIR",
    "/data/meta" if _IN_DOCKER else os.path.expanduser("~/.savant/meta"))
CODEX_DIR = os.environ.get("CODEX_DIR",
    "/data/codex" if _IN_DOCKER else os.path.expanduser("~/.codex"))
CODEX_SESSIONS_DIR = os.path.join(CODEX_DIR, "sessions")
CODEX_META_DIR = os.path.join(CODEX_DIR, ".savant-meta")
HERMES_DIR = os.environ.get("HERMES_DIR",
    os.path.expanduser("~/.hermes"))
HERMES_SESSIONS_DIR = os.path.join(HERMES_DIR, "sessions")
HERMES_META_DIR = os.path.join(HERMES_DIR, ".savant-meta")
HERMES_STATE_DB = os.path.join(HERMES_DIR, "state.db")

# --- Host path mapping (container→host for file open/reveal) ---
_HOST_PATH_MAP = []
for _env_key in ("_VOL_MAP_0", "_VOL_MAP_1", "_VOL_MAP_2", "_VOL_MAP_3", "_VOL_MAP_4", "_VOL_MAP_5"):
    _val = os.environ.get(_env_key, "")
    if ":" in _val:
        _parts = _val.split(":", 1)
        _HOST_PATH_MAP.append((_parts[1], _parts[0]))  # (container_prefix, host_prefix)
# Sort longest container prefix first for most-specific match
_HOST_PATH_MAP.sort(key=lambda x: -len(x[0]))


def container_to_host_path(container_path):
    """Map a container absolute path back to the host filesystem path."""
    for container_prefix, host_prefix in _HOST_PATH_MAP:
        if container_path.startswith(container_prefix):
            return host_prefix + container_path[len(container_prefix):]
    return container_path

import time as _time
import random as _random
import threading
from concurrent.futures import ThreadPoolExecutor


def _unique_ts_id():
    """Generate a unique timestamp-based ID (ns + random suffix)."""
    import time
    return str(time.time_ns()) + str(_random.randint(1000, 9999))

# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND CACHE — all list/usage data served from memory
# ═══════════════════════════════════════════════════════════════════════════════
_bg_cache = {
    'copilot_sessions': None, 'claude_sessions': None, 'codex_sessions': None, 'gemini_sessions': None, 'hermes_sessions': None,
    'copilot_usage': None, 'claude_usage': None, 'codex_usage': None, 'gemini_usage': None, 'hermes_usage': None,
}
_bg_lock = threading.Lock()

# Event queue for real-time toast notifications (MCP actions, etc.)
_events = []  # list of {id, type, message, timestamp} - LEGACY, kept for backward compat
_events_lock = threading.Lock()
_event_counter = 0

def _emit_event(event_type: str, message: str, detail: dict = None):
    """Push a UI notification event to SQLite. Frontend polls /api/events to pick these up."""
    global _event_counter
    
    # Generate unique notification ID
    import uuid
    notification_id = f"notif_{uuid.uuid4().hex[:12]}"
    
    # Create notification in SQLite
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        NotificationDB.create({
            "notification_id": notification_id,
            "event_type": event_type,
            "message": message,
            "detail": detail or {},
            "workspace_id": detail.get("workspace_id") if detail else None,
            "session_id": detail.get("session_id") if detail else None,
            "read": False,
            "created_at": now_iso,
        })
    except Exception as e:
        logger.error(f"Error creating notification in SQLite: {e}")
    
    # Also keep in-memory for backward compatibility (legacy code)
    with _events_lock:
        _event_counter += 1
        evt = {
            "id": _event_counter,
            "notification_id": notification_id,
            "type": event_type,
            "message": message,
            "detail": detail or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        _events.append(evt)
        # Keep only last 50 events in memory
        if len(_events) > 50:
            _events[:] = _events[-50:]


def read_session_meta(session_path):
    meta_file = os.path.join(session_path, ".copilot-meta.json")
    try:
        with open(meta_file, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def write_session_meta(session_path, meta):
    meta_file = os.path.join(session_path, ".copilot-meta.json")
    with open(meta_file, "w") as f:
        json.dump(meta, f)


def parse_timestamp(ts):
    if not ts:
        return None
    try:
        ts = ts.replace("Z", "+00:00")
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def read_workspace(session_path):
    ws_file = os.path.join(session_path, "workspace.yaml")
    if not os.path.exists(ws_file):
        return {}
    try:
        with open(ws_file, "r") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def read_events_summary(session_path):
    events_file = os.path.join(session_path, "events.jsonl")
    if not os.path.exists(events_file):
        return {
            "event_count": 0,
            "last_event_type": None,
            "last_event_time": None,
            "first_event_time": None,
            "user_messages": [],
            "tools_used": [],
            "models": [],
            "model_call_counts": {},
            "tool_call_counts": {},
            "turn_count": 0,
            "message_count": 0,
            "last_intent": None,
            "has_abort": False,
            "active_tools": [],
            "activity_buckets": [],
            "git_commit_count": 0,
        }

    event_count = 0
    last_event_type = None
    last_event_time = None
    first_event_time = None
    user_messages = []
    tools_used = set()
    models_seen = set()
    tool_starts = {}
    tool_completes = set()
    last_intent = None
    has_abort = False
    event_timestamps = []
    model_call_counts = {}
    tool_call_counts = {}
    turn_count = 0
    message_count = 0
    git_commit_count = 0

    try:
        with open(events_file, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                event_count += 1
                etype = ev.get("type", "")
                etime = ev.get("timestamp")
                if first_event_time is None:
                    first_event_time = etime
                last_event_type = etype
                last_event_time = etime
                if etime:
                    event_timestamps.append(etime)

                if etype == "user.message":
                    message_count += 1
                    content = ev.get("data", {}).get("content", "")
                    user_messages.append(
                        {"content": content[:200], "timestamp": etime}
                    )

                elif etype == "assistant.turn_start":
                    turn_count += 1

                elif etype == "tool.execution_start":
                    tool_name = ev.get("data", {}).get("toolName", "unknown")
                    call_id = ev.get("data", {}).get("toolCallId", "")
                    tools_used.add(tool_name)
                    tool_call_counts[tool_name] = tool_call_counts.get(tool_name, 0) + 1
                    tool_starts[call_id] = {
                        "name": tool_name,
                        "timestamp": etime,
                    }
                    # Count git commits from bash commands
                    if tool_name == "bash":
                        cmd = (ev.get("data", {}).get("arguments", {}) or {}).get("command", "")
                        if "git commit" in cmd or "git cherry-pick" in cmd:
                            git_commit_count += 1
                    elif tool_name in ("gitlab-create_commit", "github-create_commit"):
                        git_commit_count += 1

                elif etype == "tool.execution_complete":
                    call_id = ev.get("data", {}).get("toolCallId", "")
                    tool_completes.add(call_id)
                    model = ev.get("data", {}).get("model", "")
                    if model:
                        models_seen.add(model)
                        model_call_counts[model] = model_call_counts.get(model, 0) + 1

                elif etype == "abort":
                    has_abort = True

                elif etype == "assistant.message":
                    reqs = ev.get("data", {}).get("toolRequests", [])
                    for req in reqs:
                        if req.get("name") == "report_intent":
                            args = req.get("arguments", {})
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except Exception:
                                    args = {}
                            intent = args.get("intent")
                            if intent:
                                last_intent = intent

        active_tools = []
        for call_id, info in tool_starts.items():
            if call_id not in tool_completes:
                active_tools.append(info)

        # Compute activity buckets (24 segments across session lifetime)
        activity_buckets = []
        if len(event_timestamps) > 1:
            parsed_ts = [parse_timestamp(t) for t in event_timestamps]
            parsed_ts = [t for t in parsed_ts if t is not None]
            if len(parsed_ts) > 1:
                parsed_ts.sort()
                start = parsed_ts[0]
                end = parsed_ts[-1]
                duration = (end - start).total_seconds()
                if duration > 0:
                    num_buckets = 24
                    bucket_size = duration / num_buckets
                    counts = [0] * num_buckets
                    for t in parsed_ts:
                        idx = min(int((t - start).total_seconds() / bucket_size), num_buckets - 1)
                        counts[idx] += 1
                    activity_buckets = counts

    except Exception:
        pass

    return {
        "event_count": event_count,
        "last_event_type": last_event_type,
        "last_event_time": last_event_time,
        "first_event_time": first_event_time,
        "user_messages": user_messages[-5:],
        "tools_used": sorted(tools_used),
        "models": sorted(models_seen),
        "model_call_counts": model_call_counts,
        "tool_call_counts": tool_call_counts,
        "turn_count": turn_count,
        "message_count": message_count,
        "last_intent": last_intent,
        "has_abort": has_abort,
        "active_tools": active_tools,
        "activity_buckets": activity_buckets,
        "git_commit_count": git_commit_count,
    }


def is_session_open(session_path):
    """Check if events.jsonl was modified in the last 2 minutes."""
    events_file = os.path.join(session_path, "events.jsonl")
    if not os.path.exists(events_file):
        return False
    try:
        mtime = os.path.getmtime(events_file)
        age = datetime.now().timestamp() - mtime
        return age < 120
    except Exception:
        return False


def list_session_tree(session_path):
    """List files/checkpoints/research in the session directory."""
    result = {"checkpoints": [], "files": [], "research": [], "rewind_snapshots": [], "plan": None}

    # Checkpoints
    cp_dir = os.path.join(session_path, "checkpoints")
    if os.path.isdir(cp_dir):
        index_file = os.path.join(cp_dir, "index.md")
        for f in sorted(os.listdir(cp_dir)):
            fp = os.path.join(cp_dir, f)
            if os.path.isfile(fp):
                result["checkpoints"].append({
                    "name": f,
                    "path": f"checkpoints/{f}",
                    "size": os.path.getsize(fp),
                    "mtime": datetime.fromtimestamp(
                        os.path.getmtime(fp), tz=timezone.utc
                    ).isoformat(),
                })

    # Files
    files_dir = os.path.join(session_path, "files")
    if os.path.isdir(files_dir):
        for root, dirs, files in os.walk(files_dir):
            for f in files:
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, session_path)
                result["files"].append({
                    "name": f,
                    "path": rel,
                    "size": os.path.getsize(fp),
                    "mtime": datetime.fromtimestamp(
                        os.path.getmtime(fp), tz=timezone.utc
                    ).isoformat(),
                })

    # Research
    research_dir = os.path.join(session_path, "research")
    if os.path.isdir(research_dir):
        for root, dirs, files in os.walk(research_dir):
            for f in files:
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, session_path)
                result["research"].append({
                    "name": f,
                    "path": rel,
                    "size": os.path.getsize(fp),
                    "mtime": datetime.fromtimestamp(
                        os.path.getmtime(fp), tz=timezone.utc
                    ).isoformat(),
                })

    # Plan
    plan_file = os.path.join(session_path, "plan.md")
    if os.path.isfile(plan_file):
        result["plan"] = {
            "name": "plan.md",
            "path": "plan.md",
            "size": os.path.getsize(plan_file),
            "mtime": datetime.fromtimestamp(
                os.path.getmtime(plan_file), tz=timezone.utc
            ).isoformat(),
        }

    # Rewind snapshots
    rewind_index = os.path.join(session_path, "rewind-snapshots", "index.json")
    if os.path.isfile(rewind_index):
        try:
            with open(rewind_index, "r") as f:
                rewind_data = json.load(f)
            for snap in rewind_data.get("snapshots", []):
                msg = snap.get("userMessage", "")
                # Trim long messages and strip pasted content tags
                msg = re.sub(r'<pasted_content[^>]*/>',  '[pasted]', msg)
                if len(msg) > 120:
                    msg = msg[:120] + "..."
                result["rewind_snapshots"].append({
                    "id": snap.get("snapshotId", ""),
                    "timestamp": snap.get("timestamp", ""),
                    "message": msg.strip(),
                    "file_count": snap.get("fileCount", 0),
                })
        except Exception:
            pass

    return result


def compute_status(ws, events):
    now = datetime.now(timezone.utc)
    updated = parse_timestamp(ws.get("updated_at"))
    last_ev = parse_timestamp(events.get("last_event_time"))
    ref_time = last_ev or updated

    if events.get("has_abort") and events.get("last_event_type") == "abort":
        return "ABORTED"

    if not ref_time:
        return "UNKNOWN"

    age_minutes = (now - ref_time).total_seconds() / 60

    if events.get("active_tools"):
        if age_minutes > 10:
            return "STUCK"
        return "RUNNING"

    if events.get("last_event_type") == "assistant.turn_end":
        if age_minutes < 5:
            return "WAITING"
        return "IDLE"

    if events.get("last_event_type") in ("assistant.turn_start", "assistant.message"):
        if age_minutes > 10:
            return "STUCK"
        return "PROCESSING"

    if age_minutes < 2:
        return "ACTIVE"
    elif age_minutes < 30:
        return "IDLE"
    else:
        return "DORMANT"


def build_convert_prompt(info, conv_stats=None, provider="copilot"):
    """Build a session handoff prompt from session info + conversation stats."""
    lines = []
    prov_label = provider.upper()
    lines.append(f"# Session Handoff — Continue from {prov_label} Session")
    lines.append("")

    # Original task
    task_text = info.get("summary", "") or info.get("first_prompt", "")
    if task_text:
        lines.append("## Original Task")
        lines.append(task_text[:3000])
        lines.append("")

    # Project context
    project = info.get("project", "")
    cwd = info.get("cwd", "") or info.get("git_root", "")
    branch = info.get("branch", "") or info.get("git_branch", "")
    if project or cwd:
        lines.append("## Project Context")
        if project:
            lines.append(f"- **Project:** {project}")
        if cwd:
            lines.append(f"- **Working Directory:** {cwd}")
        if branch:
            lines.append(f"- **Branch:** {branch}")
        models = info.get("models", [])
        if models:
            lines.append(f"- **Models Used:** {', '.join(models)}")
        lines.append("")

    # Files touched
    files_created = (conv_stats or {}).get("files_created", [])
    files_edited = (conv_stats or {}).get("files_edited", [])
    if files_created or files_edited:
        lines.append("## Files Touched")
        if files_created:
            lines.append("### Created")
            for f in files_created[:30]:
                lines.append(f"- `{f}`")
        if files_edited:
            lines.append("### Modified")
            for f in files_edited[:30]:
                lines.append(f"- `{f}`")
        lines.append("")

    # User messages (conversation history)
    user_msgs = info.get("user_messages", [])
    if user_msgs:
        lines.append("## Conversation History (User Messages)")
        for i, m in enumerate(user_msgs[:30], 1):
            content = m.get("content", m) if isinstance(m, dict) else str(m)
            lines.append(f"{i}. {str(content)[:500]}")
        lines.append("")

    # Completion / progress
    completion = info.get("completion_result")
    last_progress = info.get("last_progress", "")
    if completion:
        lines.append("## Completion Status")
        lines.append(str(completion)[:2000])
        lines.append("")
    elif last_progress:
        lines.append("## Last Progress")
        lines.append(str(last_progress)[:2000])
        lines.append("")

    # Session stats
    lines.append("## Previous Session Stats")
    lines.append(f"- **Messages:** {info.get('message_count', 0)}")
    lines.append(f"- **Turns:** {info.get('turn_count', 0)}")
    lines.append(f"- **Tool Calls:** {sum((info.get('tool_call_counts') or {}).values()) if info.get('tool_call_counts') else 0}")
    if info.get("tools_used"):
        lines.append(f"- **Tools Used:** {', '.join(info['tools_used'][:20])}")
    lines.append(f"- **Status:** {info.get('status', 'unknown')}")
    lines.append("")

    # Instructions
    lines.append("## Instructions")
    lines.append(f"This is a handoff from a {prov_label} session. Please:")
    lines.append("1. Review the files listed above to understand current state")
    lines.append("2. Continue from where the previous session left off")
    if completion:
        lines.append("3. The previous session completed — verify the work and handle any remaining items")
    else:
        lines.append("3. The previous session did NOT complete — pick up the remaining work")
    lines.append("")

    return "\n".join(lines)


def get_dir_size(path):
    """Get total size of directory in bytes."""
    total = 0
    try:
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except Exception:
        pass
    return total


def get_session_info(session_id, session_path, include_tree=False):
    ws = read_workspace(session_path)
    events = read_events_summary(session_path)
    status = compute_status(ws, events)
    tree = list_session_tree(session_path)
    is_open = is_session_open(session_path)

    plan_title = None
    if tree["plan"]:
        try:
            with open(os.path.join(session_path, "plan.md"), "r") as f:
                content = f.read(500)
                plan_title = content.strip().split("\n")[0].strip().lstrip("# ") or "Untitled Plan"
        except Exception:
            plan_title = "Plan"

    project = ws.get("cwd", "")
    if project:
        project = project.split("/")[-1]

    meta = read_session_meta(session_path)

    # Enrich session mrs: resolve mr_id references to full MR data from registry
    raw_mrs = meta.get("mrs") or ([meta.get("mr")] if meta.get("mr") else [])
    enriched_mrs = _enrich_session_mrs(raw_mrs)

    # Enrich session jira tickets
    raw_jira = meta.get("jira_tickets", [])
    enriched_jira = _enrich_session_jira_tickets(raw_jira)

    info = {
        "id": session_id,
        "summary": ws.get("summary", ""),
        "nickname": meta.get("nickname", ""),
        "starred": meta.get("starred", False),
        "archived": meta.get("archived", False),
        "mrs": enriched_mrs,
        "jira_tickets": enriched_jira,
        "notes": meta.get("notes", []),
        "workspace": meta.get("workspace"),
        "project": project,
        "cwd": ws.get("cwd", ""),
        "git_root": ws.get("git_root", ""),
        "branch": ws.get("branch", ""),
        "created_at": ws.get("created_at", ""),
        "updated_at": ws.get("updated_at", ""),
        "status": status,
        "is_open": is_open,
        "event_count": events["event_count"],
        "last_event_type": events["last_event_type"],
        "last_event_time": events["last_event_time"],
        "first_event_time": events["first_event_time"],
        "models": events["models"],
        "model_call_counts": events["model_call_counts"],
        "tool_call_counts": events["tool_call_counts"],
        "turn_count": events["turn_count"],
        "message_count": events["message_count"],
        "last_intent": events["last_intent"],
        "user_messages": events["user_messages"],
        "tools_used": events["tools_used"],
        "active_tools": events["active_tools"],
        "activity_buckets": events["activity_buckets"],
        "has_abort": events["has_abort"],
        "plan": plan_title,
        "checkpoint_count": len(tree["checkpoints"]),
        "file_count": len(tree["files"]),
        "research_count": len(tree["research"]),
        "has_plan_file": tree["plan"] is not None,
        "disk_size": get_dir_size(session_path),
        "git_commit_count": events["git_commit_count"],
        "resume_command": f"cd {ws.get('cwd', '~')} && copilot --allow-all-tools --resume {session_id}",
        "session_path": container_to_host_path(session_path),
    }

    if include_tree:
        info["tree"] = tree

    return info


@app.route("/")
def index():
    return jsonify({
        "name": "savant-server",
        "mode": "api-only",
        "status": "ok",
    })


@app.route("/api/events")
def api_events():
    """Poll for UI notification events from SQLite. Only returns unread notifications to prevent duplicates."""
    since = request.args.get("since", None, type=str)
    limit = request.args.get("limit", 50, type=int)
    
    try:
        # Only get UNREAD notifications to prevent re-showing
        notifications = NotificationDB.list_unread(limit=limit)
        
        # If 'since' is provided, filter to only newer ones
        if since:
            notifications = [n for n in notifications if n.get("notification_id") != since and 
                           n.get("created_at") > _get_notification_timestamp(since)]
        
        # Transform to match legacy format for backward compatibility
        events = []
        notification_ids_to_mark = []
        
        for notif in notifications:
            notif_id = notif.get("notification_id")
            # Use stable hash-based ID instead of enumeration
            stable_id = abs(hash(notif_id)) % 1000000
            
            events.append({
                "id": stable_id,  # Stable ID based on notification_id
                "notification_id": notif_id,
                "type": notif.get("event_type"),
                "message": notif.get("message"),
                "detail": notif.get("detail", {}),
                "timestamp": notif.get("created_at").isoformat() if isinstance(notif.get("created_at"), datetime) else notif.get("created_at"),
                "read": False,  # Always false since we only fetch unread
            })
            
            notification_ids_to_mark.append(notif_id)
        
        # Batch mark as read after fetching (notifications have been shown)
        for notif_id in notification_ids_to_mark:
            NotificationDB.mark_as_read(notif_id)
        
        # Add cache headers to reduce unnecessary re-renders
        response = jsonify(events)
        if not events:
            # If no events, cache for longer (5 seconds)
            response.headers["Cache-Control"] = "max-age=5, must-revalidate"
        else:
            # If events exist, don't cache (need fresh data)
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except Exception as e:
        logger.error(f"Error fetching notifications: {e}")
        # Fallback to in-memory events
        since_id = request.args.get("since", 0, type=int)
        with _events_lock:
            new_events = [e for e in _events if e["id"] > since_id]
        return jsonify(new_events)


def _get_notification_timestamp(notification_id: str):
    """Helper to get timestamp of a notification by ID (returns ISO string)."""
    try:
        notif = NotificationDB.get_by_id(notification_id)
        return notif.get("created_at", "") if notif else ""
    except Exception:
        return ""




@app.route("/api/codex/sessions")
def api_codex_sessions():
    with _bg_lock:
        sessions = _bg_cache.get('codex_sessions')
    if sessions is None:
        sessions = codex_get_all_sessions()
        with _bg_lock:
            _bg_cache['codex_sessions'] = sessions
    total = len(sessions)
    limit = request.args.get("limit", 0, type=int)
    offset = request.args.get("offset", 0, type=int)
    if limit > 0:
        page = sessions[offset:offset + limit]
        return jsonify({"sessions": page, "total": total, "has_more": offset + limit < total})
    return jsonify({"sessions": sessions, "total": total, "has_more": False})


@app.route("/api/session/<session_id>")
def api_session_detail(session_id):
    full = os.path.join(SESSION_DIR, session_id)
    if not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    info = get_session_info(session_id, full, include_tree=True)
    return jsonify(info)


@app.route("/api/codex/session/<session_id>")
def api_codex_session_detail(session_id):
    info = codex_get_session_info(session_id, include_tree=True)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(info)


@app.route("/api/session/<session_id>/file")
def api_session_file(session_id):
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return jsonify({"error": "Invalid path"}), 400

    full = os.path.join(SESSION_DIR, session_id, rel_path)
    full = os.path.realpath(full)
    session_root = os.path.realpath(os.path.join(SESSION_DIR, session_id))

    if not full.startswith(session_root) or not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404

    try:
        with open(full, "r", errors="replace") as f:
            content = f.read(500_000)
        return jsonify({
            "path": rel_path,
            "content": content,
            "size": os.path.getsize(full),
            "truncated": os.path.getsize(full) > 500_000,
            "host_path": container_to_host_path(full),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/session/<session_id>/file/raw")
def api_session_file_raw(session_id):
    """Serve a session file raw (for 'Open in Browser' in a new tab)."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return "Invalid path", 400
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id, rel_path))
    session_root = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(session_root) or not os.path.isfile(full):
        return "File not found", 404
    return send_file(full)


@app.route("/api/session/<session_id>/file", methods=["PUT"])
def api_session_file_write(session_id):
    """Write content to a session file."""
    data = request.get_json(force=True)
    rel_path = data.get("path", "")
    content = data.get("content")
    if not rel_path or ".." in rel_path or content is None:
        return jsonify({"error": "Invalid path or missing content"}), 400
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id, rel_path))
    session_root = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(session_root) or not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "w") as f:
            f.write(content)
        return jsonify({"ok": True, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/session/<session_id>", methods=["DELETE"])
def api_session_delete(session_id):
    full = os.path.join(SESSION_DIR, session_id)
    full = os.path.realpath(full)
    session_root = os.path.realpath(SESSION_DIR)

    if not full.startswith(session_root):
        return jsonify({"error": "Invalid session ID"}), 400

    # If directory doesn't exist, still succeed (idempotent delete)
    # — the session may exist only in the UI cache
    if os.path.isdir(full):
        if is_session_open(full):
            return jsonify({"error": "Session is currently open in Copilot"}), 409
        try:
            shutil.rmtree(full)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # Always purge from cache
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            _bg_cache['copilot_sessions'] = [s for s in _bg_cache['copilot_sessions'] if s['id'] != session_id]
    return jsonify({"deleted": session_id})



@app.route("/api/session/<session_id>/rename", methods=["POST"])
def api_session_rename(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    nickname = (data.get("nickname") or "").strip()
    meta = read_session_meta(full)
    if nickname:
        meta["nickname"] = nickname
    else:
        meta.pop("nickname", None)
    write_session_meta(full, meta)
    # Sync nickname to workspace.yaml summary so Copilot sees the rename
    ws_file = os.path.join(full, "workspace.yaml")
    try:
        ws = read_workspace(full)
        if nickname:
            ws["summary"] = nickname
        else:
            ws.pop("summary", None)
        with open(ws_file, "w") as f:
            yaml.safe_dump(ws, f, default_flow_style=False)
    except Exception:
        pass
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['nickname'] = nickname
                    if nickname:
                        s['summary'] = nickname
                    break
    return jsonify({"id": session_id, "nickname": nickname})


@app.route("/api/session/<session_id>/star", methods=["POST"])
def api_session_star(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    meta["starred"] = not meta.get("starred", False)
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['starred'] = meta["starred"]
                    break
    return jsonify({"id": session_id, "starred": meta["starred"]})


@app.route("/api/session/<session_id>/archive", methods=["POST"])
def api_session_archive(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    meta["archived"] = not meta.get("archived", False)
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['archived'] = meta["archived"]
                    break
    return jsonify({"id": session_id, "archived": meta["archived"]})


@app.route("/api/session/<session_id>/mr", methods=["GET"])
def api_session_mr_get(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    # Support both old single MR and new array format
    mrs = meta.get("mrs")
    if mrs is None:
        # Migration: convert old "mr" to "mrs" array
        old_mr = meta.get("mr")
        if old_mr:
            mrs = [dict(old_mr, id=str(int(time.time() * 1000)))]
        else:
            mrs = []
    # Enrich new-format entries (mr_id only) with registry data
    mrs = _enrich_session_mrs(mrs)
    return jsonify(mrs)


@app.route("/api/session/<session_id>/mr", methods=["POST"])
def api_session_mr_post(session_id):
    """Add or update an MR for a session. Works with the central registry.
    If URL matches an existing registry entry, updates it and links the session.
    If new URL, creates a registry entry and links the session."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    status = (data.get("status") or "").strip()
    jira = (data.get("jira") or "").strip()
    title = (data.get("title") or "").strip()
    author = (data.get("author") or "").strip()
    priority = (data.get("priority") or "").strip()
    explicit_role = (data.get("role") or "").strip()
    if explicit_role == "auto":
        explicit_role = ""
    mr_id = data.get("id") or data.get("mr_id") or ""

    # Read registry
    registry = _read_merge_requests()
    registry_entry = None

    if mr_id:
        # Editing an existing MR — find by id
        registry_entry = next((m for m in registry if m["id"] == mr_id), None)
    if not registry_entry and url:
        # Find by URL
        url_key = url.lower().rstrip("/")
        registry_entry = next((m for m in registry if (m.get("url") or "").lower().rstrip("/") == url_key), None)

    now_iso = datetime.now(timezone.utc).isoformat()

    if registry_entry:
        # Update existing registry entry
        if status:
            registry_entry["status"] = status
        if jira:
            registry_entry["jira"] = jira
        if title:
            registry_entry["title"] = title
        if author:
            registry_entry["author"] = author
        if priority:
            registry_entry["priority"] = priority
        if url and not registry_entry.get("url"):
            registry_entry["url"] = url
        registry_entry["updated_at"] = now_iso
        mr_id = registry_entry["id"]
    else:
        # Create new registry entry
        if not url:
            return jsonify({"error": "URL required for new MR"}), 400
        mr_id = str(int(time.time() * 1000))
        project_id, mr_iid = _parse_mr_url(url)
        meta_ws = read_session_meta(full).get("workspace", "")
        registry_entry = {
            "id": mr_id,
            "project_id": project_id,
            "mr_iid": mr_iid,
            "title": title,
            "url": url,
            "jira": jira,
            "status": status or "open",
            "author": author,
            "priority": priority or "medium",
            "workspace_id": meta_ws,
            "notes": [],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        registry.append(registry_entry)

    _write_merge_requests(registry)
    # Invalidate registry cache
    _mr_registry_cache["data"] = None

    # Update session link
    meta = read_session_meta(full)
    if "mrs" not in meta:
        meta["mrs"] = []
    # Remove old entry for this mr_id if it exists
    meta["mrs"] = [link for link in meta["mrs"] if link.get("mr_id") != mr_id and link.get("id") != mr_id]
    # Auto-detect role from MR author if not explicitly set
    role = explicit_role or _auto_detect_mr_role(registry_entry)
    # If this session is the author and MR has no author yet, claim it
    if role == "author" and not registry_entry.get("author"):
        prefs = _read_preferences()
        my_name = (prefs.get("name") or "").strip()
        if my_name:
            registry_entry["author"] = my_name
            _write_merge_requests(registry)
            _mr_registry_cache["data"] = None
    # Add new link
    meta["mrs"].append({
        "mr_id": mr_id,
        "role": role,
        "assigned_at": now_iso,
    })
    meta.pop("mr", None)
    write_session_meta(full, meta)

    # Update bg cache
    enriched = _enrich_session_mrs(meta["mrs"])
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = enriched
                    s.pop('mr', None)
                    break

    return jsonify({"id": session_id, "mrs": enriched})


@app.route("/api/session/<session_id>/mr/<mr_id>", methods=["DELETE"])
def api_session_mr_delete(session_id, mr_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    mrs = meta.get("mrs", [])
    # Support both old format (id) and new format (mr_id)
    mrs = [mr for mr in mrs if mr.get("id") != mr_id and mr.get("mr_id") != mr_id]
    meta["mrs"] = mrs
    meta.pop("mr", None)
    write_session_meta(full, meta)
    enriched = _enrich_session_mrs(mrs)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = enriched
                    s.pop('mr', None)
                    break
    return jsonify({"id": session_id, "deleted": True})


@app.route("/api/session/<session_id>/notes", methods=["GET"])
def api_session_notes_get(session_id):
    try:
        # Get notes from SQLite for this session
        full_session_id = session_id
        notes_list = NoteDB.list_by_session(full_session_id)
        # Transform to legacy format for backward compatibility
        notes = [
            {
                "text": n.get("text", ""),
                "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
            }
            for n in notes_list
        ]
        return jsonify({"notes": notes})
    except Exception as e:
        print(f"Error getting session notes: {e}", flush=True)
        return jsonify({"error": "Failed to get notes"}), 500


@app.route("/api/session/<session_id>/notes", methods=["POST"])
def api_session_notes_post(session_id):
    try:
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Note text required"}), 400
        
        # Check if this is a prefixed session_id from an MCP call or standard Copilot
        # If it's already prefixed (e.g. gemini_...) we use it.
        # Otherwise we default to Copilot (unprefixed) logic.
        full_session_id = session_id
        full = os.path.realpath(os.path.join(SESSION_DIR, full_session_id))
        if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
            return jsonify({"error": "Session not found"}), 404

        # Resolve the session's workspace so workspace aggregation can see the note.
        meta = read_session_meta(full)
        workspace_id = (meta.get("workspace") or meta.get("workspace_id") or "").strip()
        if not workspace_id:
            try:
                workspace_id = (read_workspace(full).get("workspace_id") or "").strip()
            except Exception:
                workspace_id = ""

        # Create note in SQLite
        import uuid
        note_id = f"note_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        
        NoteDB.create({
            "note_id": note_id,
            "session_id": full_session_id,
            "workspace_id": workspace_id,
            "text": text,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        
        # Get all notes for this session
        notes_list = NoteDB.list_by_session(full_session_id)
        
        _emit_event("note_created", f"Note added to session", {"session_id": session_id})
        return jsonify({"id": session_id, "workspace_id": workspace_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})
    except Exception as e:
        print(f"Error creating session note: {e}", flush=True)
        return jsonify({"error": "Failed to create note"}), 500


@app.route("/api/session/<session_id>/notes", methods=["DELETE"])
def api_session_notes_delete(session_id):
    try:
        data = request.get_json(force=True)
        idx = data.get("index")
        if idx is None:
            return jsonify({"error": "index required"}), 400
        
        # Get all notes for this session from SQLite
        notes_list = NoteDB.list_by_session(session_id)
        
        if idx < 0 or idx >= len(notes_list):
            return jsonify({"error": "Invalid index"}), 400
        
        # Delete the note at this index
        note_to_delete = notes_list[idx]
        NoteDB.delete(note_to_delete.get("note_id"))
        
        # Get updated notes list
        updated_notes = NoteDB.list_by_session(session_id)
        
        # Transform to legacy format
        notes = [
            {
                "text": n.get("text", ""),
                "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
            }
            for n in updated_notes
        ]
        
        return jsonify({"id": session_id, "notes": notes})
    except Exception as e:
        print(f"Error deleting session note: {e}", flush=True)
        return jsonify({"error": "Failed to delete note"}), 500


# ── Workspaces ──────────────────────────────────────────────────────────────

def _workspaces_path():
    return os.path.join(META_DIR, "workspaces.json")

_workspaces_lock = threading.RLock()
_PROVIDER_CACHE_KEYS = {
    "copilot": "copilot_sessions",
    "claude": "claude_sessions",
    "codex": "codex_sessions",
    "gemini": "gemini_sessions",
    "hermes": "hermes_sessions",
}


def _normalize_provider_name(provider: str) -> str:
    p = str(provider or "").strip().lower()
    if p == "cline":
        return "copilot"
    if p in _PROVIDER_CACHE_KEYS:
        return p
    raise ValueError("Invalid provider")


def _set_cached_session_workspace(provider: str, session_id: str, workspace_id):
    p = _normalize_provider_name(provider)
    cache_key = _PROVIDER_CACHE_KEYS[p]
    sid = str(session_id or "")
    with _bg_lock:
        sessions = _bg_cache.get(cache_key) or []
        for s in sessions:
            if s.get("id") == sid:
                s["workspace"] = workspace_id
                s["workspace_id"] = workspace_id
                break


def _get_cached_session(provider: str, session_id: str) -> dict | None:
    p = _normalize_provider_name(provider)
    cache_key = _PROVIDER_CACHE_KEYS[p]
    sid = str(session_id or "")
    with _bg_lock:
        for s in (_bg_cache.get(cache_key) or []):
            if s.get("id") == sid:
                item = dict(s)
                item["provider"] = p
                return item
    return None


def _workspace_linked_sessions(ws_id: str) -> tuple[list[dict], dict]:
    links = WorkspaceSessionLinkDB.list_by_workspace(ws_id)
    sessions = []
    by_provider = {p: set() for p in _PROVIDER_CACHE_KEYS}
    seen_pairs = set()
    for link in links:
        provider = _normalize_provider_name(link.get("provider"))
        session_id = str(link.get("session_id") or "")
        seen_pairs.add((provider, session_id))
        by_provider[provider].add(session_id)
        cached = _get_cached_session(provider, session_id)
        if cached:
            cached.setdefault("workspace", ws_id)
            cached.setdefault("workspace_id", ws_id)
            sessions.append(cached)
        else:
            sessions.append({
                "id": session_id,
                "provider": provider,
                "workspace": ws_id,
                "workspace_id": ws_id,
                "summary": "Session not available on this client",
                "nickname": "",
                "status": "UNAVAILABLE",
                "archived": False,
                "missing_local": True,
                "attached_at": link.get("attached_at"),
            })

    with _bg_lock:
        for provider, cache_key in _PROVIDER_CACHE_KEYS.items():
            for sess in (_bg_cache.get(cache_key) or []):
                sid = str(sess.get("id") or "")
                if not sid or (provider, sid) in seen_pairs:
                    continue
                sess_ws = str(sess.get("workspace") or sess.get("workspace_id") or "").strip()
                if sess_ws != ws_id:
                    continue
                item = dict(sess)
                item["provider"] = provider
                item.setdefault("workspace", ws_id)
                item.setdefault("workspace_id", ws_id)
                sessions.append(item)
                seen_pairs.add((provider, sid))
    sessions.sort(key=lambda s: str(s.get("updated_at") or s.get("created_at") or s.get("attached_at") or ""), reverse=True)
    return sessions, by_provider


def _set_workspace_link(provider: str, session_id: str, workspace_id):
    provider = _normalize_provider_name(provider)
    sid = str(session_id or "")
    if workspace_id:
        WorkspaceSessionLinkDB.upsert(workspace_id, provider, sid)
    else:
        existing = WorkspaceSessionLinkDB.resolve(provider, sid)
        if existing:
            WorkspaceSessionLinkDB.delete_from_workspace(existing["workspace_id"], provider, sid)
    _set_cached_session_workspace(provider, sid, workspace_id)

def _read_workspaces():
    """Read workspaces from SQLite."""
    try:
        workspaces = WorkspaceDB.list_all(limit=1000)
        
        normalized = []
        for ws in workspaces:
            normalized_ws = {
                "id": ws.get("workspace_id"),
                "workspace_id": ws.get("workspace_id"),
                "name": ws.get("name"),
                "description": ws.get("description", ""),
                "priority": ws.get("priority", "medium"),
                "status": ws.get("status", "open"),
                "task_stats": WorkspaceDB.get_task_stats(ws.get("workspace_id", "")),
                "created_at": ws.get("created_at"),
                "updated_at": ws.get("updated_at"),
            }
            normalized.append(normalized_ws)
        
        return normalized
    except Exception as e:
        logger.error(f"Error reading workspaces: {e}")
        return []

def _write_workspaces(workspaces):
    """Write workspaces to SQLite."""
    try:
        for ws in workspaces:
            workspace_id = ws.get("id") or ws.get("workspace_id")
            if not workspace_id:
                continue
            
            existing = WorkspaceDB.get_by_id(workspace_id)
            if existing:
                WorkspaceDB.update(workspace_id, {
                    "name": ws.get("name", "Untitled"),
                    "description": ws.get("description", ""),
                    "priority": ws.get("priority", "medium"),
                    "status": ws.get("status", "open"),
                })
            else:
                WorkspaceDB.create({
                    "workspace_id": workspace_id,
                    "name": ws.get("name", "Untitled"),
                    "description": ws.get("description", ""),
                    "priority": ws.get("priority", "medium"),
                    "status": ws.get("status", "open"),
                })
    except Exception as e:
        logger.error(f"Error writing workspaces: {e}")

@app.route("/api/workspaces", methods=["GET"])
def api_workspaces_list():
    workspaces = _read_workspaces()
    all_tasks = TaskDB.list_all()
    all_registry_mrs = _read_merge_requests()
    registry_by_id = {m["id"]: m for m in all_registry_mrs}
    # Batch-load all committed KG nodes and edges for KG stats
    from db.knowledge_graph import KnowledgeGraphDB
    all_kg_nodes = KnowledgeGraphDB.list_nodes(limit=10000, include_staged=False)
    all_kg_edges = KnowledgeGraphDB.list_edges()
    # Enrich with session counts and task stats
    for ws in workspaces:
        ws_id = ws["id"]
        # Ensure defaults for legacy workspaces missing new fields
        ws.setdefault("status", "open")
        ws.setdefault("priority", "medium")
        ws.setdefault("start_date", None)
        counts = {"copilot": 0, "claude": 0, "codex": 0, "gemini": 0, "hermes": 0, "total": 0}
        session_status_counts = {}
        projects = set()
        mr_urls = set()
        mr_by_url = {}
        mr_ids_in_sessions = set()
        note_count = 0
        file_count = 0
        git_commit_count = 0
        archived_count = 0
        session_file_count = 0
        ws_sessions, link_ids = _workspace_linked_sessions(ws_id)
        for provider, ids in link_ids.items():
            counts[provider] = len(ids)
            counts["total"] += len(ids)
        for s in ws_sessions:
            st = (s.get("status") or "IDLE").upper()
            session_status_counts[st] = session_status_counts.get(st, 0) + 1
            p = s.get("project")
            if p:
                projects.add(p)
            note_count += len(s.get("notes") or [])
            file_count += s.get("file_count") or 0
            git_commit_count += s.get("git_commit_count") or 0
            session_file_count += (s.get("file_count") or 0) + (s.get("checkpoint_count") or 0) + (s.get("research_count") or 0)
            if s.get("archived"):
                archived_count += 1
            for mr in (s.get("mrs") or []):
                # Support both old format (url) and new format (mr_id)
                url = (mr.get("url") or "").strip().lower().rstrip("/")
                if url:
                    mr_urls.add(url)
                    mr_by_url[url] = mr.get("status") or "open"
                elif mr.get("mr_id"):
                    # Resolve mr_id → registry entry
                    reg = registry_by_id.get(mr["mr_id"])
                    if reg:
                        rurl = (reg.get("url") or "").strip().lower().rstrip("/")
                        if rurl:
                            mr_urls.add(rurl)
                            mr_by_url[rurl] = reg.get("status") or "open"
        # Also include registry MRs for this workspace that weren't in any session
        registry_mrs = [m for m in all_registry_mrs if m.get("workspace_id") == ws_id]
        for m in registry_mrs:
            url = (m.get("url") or "").strip().lower().rstrip("/")
            if url:
                mr_urls.add(url)
                mr_by_url[url] = m.get("status") or "open"
        ws["counts"] = counts
        ws["session_status_counts"] = session_status_counts
        ws["projects"] = sorted(projects)
        ws["mr_count"] = len(mr_urls)
        ws["note_count"] = note_count
        ws["file_count"] = file_count
        ws["git_commit_count"] = git_commit_count
        ws["archived_count"] = archived_count
        ws["session_file_count"] = session_file_count
        # Count distinct MRs by status
        mr_status_counts = {}
        for status in mr_by_url.values():
            mr_status_counts[status] = mr_status_counts.get(status, 0) + 1
        ws["mr_status_counts"] = mr_status_counts
        # Task stats for this workspace
        ws_tasks = [t for t in all_tasks if t.get("workspace_id") == ws_id]
        ws["task_stats"] = {
            "total": len(ws_tasks),
            "todo": sum(1 for t in ws_tasks if t.get("status") == "todo"),
            "in_progress": sum(1 for t in ws_tasks if t.get("status") == "in-progress"),
            "done": sum(1 for t in ws_tasks if t.get("status") == "done"),
            "blocked": sum(1 for t in ws_tasks if t.get("status") == "blocked"),
        }
        # Knowledge Graph stats for this workspace
        ws_kg_nodes = [n for n in all_kg_nodes
                       if ws_id in (n.get("metadata") or {}).get("workspaces", [])]
        ws_kg_node_ids = {n["node_id"] for n in ws_kg_nodes}
        ws_kg_edges = [e for e in all_kg_edges
                       if e["source_id"] in ws_kg_node_ids and e["target_id"] in ws_kg_node_ids]
        nodes_by_type = {}
        for n in ws_kg_nodes:
            t = n.get("node_type", "unknown")
            nodes_by_type[t] = nodes_by_type.get(t, 0) + 1
        staged_count = sum(1 for n in ws_kg_nodes if n.get("status") == "staged")
        ws["kg_stats"] = {
            "total_nodes": len(ws_kg_nodes),
            "total_edges": len(ws_kg_edges),
            "nodes_by_type": nodes_by_type,
            "staged_count": staged_count,
        }
    # Order is now manual (drag-and-drop). Open workspaces appear before closed.
    workspaces.sort(key=lambda w: 0 if w.get("status", "open") == "open" else 1)
    
    # Add ETag based on data hash to prevent unnecessary re-renders
    import hashlib
    data_str = json.dumps(workspaces, sort_keys=True, default=str)
    etag = hashlib.md5(data_str.encode()).hexdigest()
    
    # Check if client has cached version
    if request.headers.get("If-None-Match") == etag:
        return "", 304  # Not Modified
    
    response = jsonify(workspaces)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "max-age=2, must-revalidate"
    return response

@app.route("/api/workspaces", methods=["POST"])
def api_workspaces_create():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    ws_id = _unique_ts_id()
    ws = {
        "id": ws_id,
        "workspace_id": ws_id,
        "name": name,
        "description": (data.get("description") or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "start_date": (data.get("start_date") or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "priority": (data.get("priority") or "").strip() or "medium",
        "status": "open",
        "color": (data.get("color") or "").strip() or None,
    }
    WorkspaceDB.create({
        "workspace_id": ws_id,
        "name": ws["name"],
        "description": ws["description"],
        "priority": ws["priority"],
        "status": ws["status"],
    })
    _emit_event("workspace_created", f"Workspace created: {name}", {"workspace_id": ws_id, "name": name})
    return jsonify(ws)

@app.route("/api/workspaces/reorder", methods=["POST"])
def api_workspaces_reorder():
    data = request.get_json(force=True)
    order = data.get("order", [])
    if not order:
        return jsonify({"error": "order required"}), 400
    workspaces = _read_workspaces()
    ws_map = {ws["id"]: ws for ws in workspaces}
    reordered = [ws_map[wid] for wid in order if wid in ws_map]
    # Append any workspaces not in the order list (safety net)
    seen = set(order)
    for ws in workspaces:
        if ws["id"] not in seen:
            reordered.append(ws)
    _write_workspaces(reordered)
    return jsonify({"ok": True})

@app.route("/api/workspaces/<ws_id>", methods=["PUT"])
def api_workspaces_update(ws_id):
    data = request.get_json(force=True)
    workspaces = _read_workspaces()
    for ws in workspaces:
        if ws["id"] == ws_id:
            if "name" in data:
                ws["name"] = data["name"].strip()
            if "description" in data:
                ws["description"] = data["description"].strip()
            if "start_date" in data:
                ws["start_date"] = (data["start_date"] or "").strip() or None
            if "priority" in data:
                ws["priority"] = (data["priority"] or "").strip() or "medium"
            if "color" in data:
                ws["color"] = (data["color"] or "").strip() or None
            if "status" in data:
                ws["status"] = data["status"].strip()
                if ws["status"] == "closed" and not ws.get("closed_at"):
                    ws["closed_at"] = datetime.now(timezone.utc).isoformat()
                elif ws["status"] == "open":
                    ws.pop("closed_at", None)
            _write_workspaces(workspaces)
            if "status" in data and data["status"] == "closed":
                _emit_event("workspace_closed", f"Workspace closed: {ws.get('name', ws_id)}", {"workspace_id": ws_id})
            elif "status" in data and data["status"] == "open":
                _emit_event("workspace_reopened", f"Workspace reopened: {ws.get('name', ws_id)}", {"workspace_id": ws_id})
            return jsonify(ws)
    return jsonify({"error": "Workspace not found"}), 404

@app.route("/api/workspaces/<ws_id>", methods=["DELETE"])
def api_workspaces_delete(ws_id):
    existing_links = WorkspaceSessionLinkDB.list_by_workspace(ws_id)

    # Remove session links first so FK on workspace_session_links never blocks delete.
    WorkspaceSessionLinkDB.delete_by_workspace(ws_id)
    for link in existing_links:
        try:
            _set_cached_session_workspace(link.get("provider"), link.get("session_id"), None)
        except Exception:
            pass

    # Delete from SQLite
    success = WorkspaceDB.delete(ws_id)
    if not success:
        return jsonify({"error": "Workspace not found"}), 404
    
    _emit_event("workspace_deleted", f"Workspace {ws_id} deleted", {"workspace_id": ws_id})
    return jsonify({"deleted": ws_id})

@app.route("/api/workspaces/<ws_id>/sessions", methods=["GET"])
def api_workspaces_sessions(ws_id):
    """Get workspace-linked sessions joined with locally available sessions."""
    results, _ = _workspace_linked_sessions(ws_id)
    for session in results:
        pkey = session.get("provider") or "copilot"
        if not session.get("cwd") and session.get("project_path"):
            session["cwd"] = session["project_path"]
        if not session.get("resume_command") and not session.get("missing_local"):
            if pkey == "gemini":
                c = session.get("cwd") or "~"
                session["resume_command"] = f"cd {c} && gemini --resume {session['id']}"
            elif pkey == "codex":
                c = session.get("cwd") or "~"
                session["resume_command"] = f"cd {c} && codex resume {session['id']}"
    return jsonify({"sessions": results})


@app.route("/api/workspaces/<ws_id>/session-links", methods=["GET"])
def api_workspace_session_links_list(ws_id):
    if not WorkspaceDB.get_by_id(ws_id):
        return jsonify({"error": "Workspace not found"}), 404
    links = WorkspaceSessionLinkDB.list_by_workspace(ws_id)
    return jsonify({"workspace_id": ws_id, "links": links})


@app.route("/api/workspaces/<ws_id>/session-links", methods=["POST"])
def api_workspace_session_links_upsert(ws_id):
    if not WorkspaceDB.get_by_id(ws_id):
        return jsonify({"error": "Workspace not found"}), 404
    data = request.get_json(force=True) or {}
    provider = data.get("provider")
    session_id = str(data.get("session_id") or "").strip()
    if not provider or not session_id:
        return jsonify({"error": "provider and session_id are required"}), 400
    try:
        link = WorkspaceSessionLinkDB.upsert(ws_id, provider, session_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    _set_cached_session_workspace(link["provider"], session_id, ws_id)
    _emit_event("session_assigned", "Session assigned to workspace", {"session_id": session_id, "workspace_id": ws_id})
    return jsonify(link)


@app.route("/api/workspaces/<ws_id>/session-links/<provider>/<session_id>", methods=["DELETE"])
def api_workspace_session_links_delete(ws_id, provider, session_id):
    try:
        deleted = WorkspaceSessionLinkDB.delete_from_workspace(ws_id, provider, session_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if not deleted:
        return jsonify({"error": "Session link not found"}), 404
    _set_cached_session_workspace(provider, session_id, None)
    return jsonify({"deleted": True, "workspace_id": ws_id, "provider": _normalize_provider_name(provider), "session_id": session_id})


@app.route("/api/session-links/resolve", methods=["GET"])
def api_session_links_resolve():
    provider = request.args.get("provider", "")
    session_id = request.args.get("session_id", "")
    if not provider or not session_id:
        return jsonify({"error": "provider and session_id are required"}), 400
    try:
        provider = _normalize_provider_name(provider)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    row = WorkspaceSessionLinkDB.resolve(provider, session_id)
    return jsonify({
        "provider": provider,
        "session_id": session_id,
        "workspace_id": row.get("workspace_id") if row else None,
    })

@app.route("/api/workspaces/<ws_id>/files", methods=["GET"])
def api_workspaces_files(ws_id):
    """Get all session files grouped by session for a workspace."""
    grouped = []  # [{session_id, provider, summary, project, files: [...]}]

    ws_sessions, _ = _workspace_linked_sessions(ws_id)
    for s in ws_sessions:
        if s.get("missing_local"):
            continue
        pname = s.get("provider")
        sid = s.get("id", "")
        summary = s.get("nickname") or s.get("summary") or sid
        project = s.get("project") or ""
        cwd = s.get("cwd") or s.get("git_root") or ""

        files_seen = {}

        if pname == "copilot":
            full = os.path.realpath(os.path.join(SESSION_DIR, sid))
            if not os.path.isdir(full):
                continue
            events_file = os.path.join(full, "events.jsonl")
            if os.path.exists(events_file):
                try:
                    with open(events_file, "r") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                ev = json.loads(line)
                            except Exception:
                                continue
                            etype = ev.get("type", "")
                            data = ev.get("data", {})
                            ts = ev.get("timestamp", "")
                            if etype == "tool.execution_start":
                                tool_name = data.get("toolName", "")
                                args = data.get("arguments", {})
                                if tool_name in ("create", "edit", "view", "write"):
                                    fpath = args.get("path", "")
                                    if fpath and "/.copilot/" not in fpath:
                                        action = tool_name
                                        if fpath not in files_seen:
                                            files_seen[fpath] = {"path": fpath, "action": action, "count": 0, "first_seen": ts, "last_seen": ts}
                                        files_seen[fpath]["count"] += 1
                                        files_seen[fpath]["last_seen"] = ts
                                        if action in ("create", "edit", "write"):
                                            files_seen[fpath]["action"] = action
                except Exception:
                    pass

        elif pname == "claude":
            raw = claude_load_session_jsonl(sid)
            for msg in (raw or []):
                if not cwd and msg.get("cwd"):
                    cwd = msg["cwd"]
                if msg.get("type") != "assistant":
                    continue
                content = msg.get("message", {}).get("content", "")
                ts = msg.get("timestamp", "")
                if not isinstance(content, list):
                    continue
                for block in content:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    tool_name = block.get("name", "")
                    inp = block.get("input", {})
                    if not isinstance(inp, dict):
                        continue
                    fpath = inp.get("path", inp.get("file_path", ""))
                    if not fpath or "/.claude/" in fpath or "/.copilot/" in fpath:
                        continue
                    action = "view"
                    if tool_name in ("Write", "create"):
                        action = "create"
                    elif tool_name in ("Edit", "edit"):
                        action = "edit"
                    elif tool_name in ("Read", "view"):
                        action = "view"
                    if fpath not in files_seen:
                        files_seen[fpath] = {"path": fpath, "action": action, "count": 0, "first_seen": ts, "last_seen": ts}
                    files_seen[fpath]["count"] += 1
                    files_seen[fpath]["last_seen"] = ts
                    if action in ("create", "edit"):
                        files_seen[fpath]["action"] = action

        elif pname == "codex":
            # Extract files from Codex JSONL via api_codex_session_project_files logic
            res = api_codex_session_project_files(sid)
            data = res.get_json() if hasattr(res, "get_json") else {}
            for fi in data.get("files", []):
                fpath = fi.get("path")
                if fpath not in files_seen:
                    files_seen[fpath] = fi
                else:
                    files_seen[fpath]["count"] += fi.get("count", 0)

        elif pname == "gemini":
            # Parse tool calls from Gemini chat JSON
            messages = s.get("messages", [])
            for msg in messages:
                ts = msg.get("timestamp", "")
                tool_calls = msg.get("toolCalls", [])
                for tc in tool_calls:
                    tool_name = tc.get("function", {}).get("name", "")
                    inp = tc.get("function", {}).get("arguments", {})
                    if not isinstance(inp, dict):
                        continue
                    fpath = inp.get("path", inp.get("file_path", ""))
                    if not fpath or "/.gemini/" in fpath:
                        continue
                    action = "view"
                    if tool_name in ("create", "write_file", "edit"):
                        action = "edit"
                    if fpath not in files_seen:
                        files_seen[fpath] = {"path": fpath, "action": action, "count": 0, "first_seen": ts, "last_seen": ts}
                    files_seen[fpath]["count"] += 1
                    files_seen[fpath]["last_seen"] = ts

        elif pname == "hermes":
            # Extract files from Hermes session via project-files endpoint
            res = api_hermes_session_project_files(sid)
            fdata = res.get_json() if hasattr(res, "get_json") else {}
            for fi in fdata.get("files", []):
                fpath = fi.get("path")
                if fpath not in files_seen:
                    files_seen[fpath] = fi
                else:
                    files_seen[fpath]["count"] += fi.get("count", 0)

        # Build file list for this session
        file_list = []
        for fpath, info in files_seen.items():
            info["name"] = os.path.basename(fpath)
            info["relative"] = os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
            file_list.append(info)
        file_list.sort(key=lambda x: x.get("last_seen", "") or "", reverse=True)

        if file_list:
            grouped.append({
                "session_id": sid,
                "provider": pname,
                "summary": summary,
                "project": project,
                "cwd": cwd,
                "file_count": len(file_list),
                "files": file_list,
            })

    grouped.sort(key=lambda g: g.get("summary", "").lower())
    return jsonify({"groups": grouped})

@app.route("/api/workspaces/<ws_id>/session-files", methods=["GET"])
def api_workspaces_session_files(ws_id):
    """Get session artifact files (plan, checkpoints, files/, research/) grouped by session."""
    grouped = []
    ws_sessions, _ = _workspace_linked_sessions(ws_id)
    for s in ws_sessions:
        if s.get("missing_local"):
            continue
        pname = s.get("provider")
        sid = s.get("id", "")
        summary = s.get("nickname") or s.get("summary") or sid

        if pname == "copilot":
            session_path = os.path.join(SESSION_DIR, sid)
        elif pname == "claude":
            session_path = os.path.join(CLAUDE_DIR, sid) if os.path.isdir(os.path.join(CLAUDE_DIR, sid)) else ""
        elif pname == "codex":
            session_dir = codex_find_session_dir(sid)
            session_path = session_dir if session_dir else ""
        elif pname == "gemini":
            # Gemini sessions in chats/ are single files, but they might have artifact dirs
            session_path = os.path.join(GEMINI_DIR, "tmp", "savant-app", "chats", sid)
            if not os.path.isdir(session_path):
                session_path = ""
        elif pname == "hermes":
            # Hermes sessions are single JSON files, no artifact directory
            session_path = ""
        else:
            continue
        if not session_path or not os.path.isdir(session_path):
            continue

        artifacts = list_session_tree(session_path)
        all_files = []
        if artifacts.get("plan"):
            all_files.append({**artifacts["plan"], "category": "plan"})
        for fi in artifacts.get("files", []):
            all_files.append({**fi, "category": "file"})
        for r in artifacts.get("research", []):
            all_files.append({**r, "category": "research"})

        if all_files:
            grouped.append({
                "session_id": sid,
                "provider": pname,
                "summary": summary,
                "file_count": len(all_files),
                "files": all_files,
            })

    grouped.sort(key=lambda g: g.get("summary", "").lower())
    return jsonify({"groups": grouped})

@app.route("/api/workspaces/<ws_id>/notes", methods=["GET"])
def api_workspaces_notes(ws_id):
    """Aggregate notes from all sessions in a workspace, grouped by session, ordered by created_at."""
    groups = []
    seen_session_ids = set()

    # 1. Notes from local session cache for workspace-linked sessions
    ws_sessions, _ = _workspace_linked_sessions(ws_id)
    for s in ws_sessions:
        if s.get("missing_local"):
            continue
        notes = s.get("notes") or []
        if not notes:
            continue
        seen_session_ids.add(s.get("id", ""))
        sorted_notes = sorted(notes, key=lambda n: n.get("timestamp") or "", reverse=True)
        groups.append({
            "session_id": s.get("id", ""),
            "provider": s.get("provider", "copilot"),
            "summary": s.get("nickname") or s.get("summary") or s.get("id", ""),
            "note_count": len(sorted_notes),
            "notes": sorted_notes,
        })

    # 2. Notes from SQLite (created via MCP tools)
    try:
        db_notes = NoteDB.list_by_workspace(ws_id, limit=500)
        by_session = {}
        for n in db_notes:
            sid = n.get("session_id", "")
            if sid in seen_session_ids:
                continue
            by_session.setdefault(sid, []).append({
                "text": n.get("text", ""),
                "timestamp": n.get("created_at", ""),
            })
        for sid, notes in by_session.items():
            sorted_notes = sorted(notes, key=lambda n: n.get("timestamp") or "", reverse=True)
            groups.append({
                "session_id": sid,
                "provider": "copilot",
                "summary": sid[:12] + "…" if len(sid) > 12 else sid,
                "note_count": len(sorted_notes),
                "notes": sorted_notes,
            })
    except Exception as e:
        logger.error(f"Error loading SQLite notes for workspace {ws_id}: {e}")

    groups.sort(key=lambda g: g["notes"][0].get("timestamp", "") if g["notes"] else "", reverse=True)
    return jsonify({"groups": groups})

@app.route("/api/workspaces/search", methods=["GET"])
def api_workspaces_search():
    """Deep search across all workspaces — names, descriptions, session summaries, notes, tasks."""
    query = (request.args.get("q") or "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"workspaces": [], "sessions": [], "notes": [], "tasks": []})

    workspaces = _read_workspaces()
    all_tasks = TaskDB.list_all()
    ws_matches = []
    session_matches = []
    note_matches = []
    task_matches = []

    # Search workspace name/description
    for ws in workspaces:
        ws.setdefault("status", "open")
        ws.setdefault("priority", "medium")
        haystack = ((ws.get("name") or "") + " " + (ws.get("description") or "")).lower()
        if query in haystack:
            ws_matches.append(ws)

    # Search sessions and notes within workspaces (joined by server-owned links)
    ws_by_id = {w["id"]: w for w in workspaces}
    for ws_id, ws_obj in ws_by_id.items():
        ws_name = ws_obj.get("name", "")
        ws_sessions, _ = _workspace_linked_sessions(ws_id)
        for s in ws_sessions:
            sid = s.get("id", "")
            summary = s.get("nickname") or s.get("summary") or sid
            pname = s.get("provider", "copilot")
            # Session summary match
            if query in summary.lower() or query in (s.get("project") or "").lower():
                session_matches.append({
                    "session_id": sid, "provider": pname, "summary": summary,
                    "project": s.get("project") or "",
                    "workspace_id": ws_id, "workspace_name": ws_name,
                })
            # Note matches
            for note in (s.get("notes") or []):
                text = (note.get("text") or "").lower()
                if query in text:
                    note_matches.append({
                        "session_id": sid, "provider": pname, "summary": summary,
                        "workspace_id": ws_id, "workspace_name": ws_name,
                        "text": note.get("text", ""), "timestamp": note.get("timestamp", ""),
                    })

    # Search tasks
    for t in all_tasks:
        ws_id = t.get("workspace_id")
        if not ws_id or ws_id not in ws_by_id:
            continue
        haystack = ((t.get("title") or "") + " " + (t.get("description") or "")).lower()
        if query in haystack:
            task_matches.append({
                "id": t.get("task_id") or t.get("id"), "seq": t.get("seq"), "title": t.get("title", ""), "status": t.get("status", ""),
                "workspace_id": ws_id, "workspace_name": ws_by_id[ws_id].get("name", ""),
            })

    note_matches.sort(key=lambda n: n.get("timestamp", ""), reverse=True)
    return jsonify({
        "workspaces": ws_matches[:20],
        "sessions": session_matches[:20],
        "notes": note_matches[:30],
        "tasks": task_matches[:20],
        "query": query,
    })

@app.route("/api/all-mrs", methods=["GET"])
def api_all_mrs():
    """Return all MRs aggregated across all sessions and providers.
    Reads from the central merge_requests.json registry first, then
    falls back to session-embedded data for any MRs not in the registry.
    ?filter=open (default) returns non-merged/closed; ?filter=closed returns merged/closed.
    """
    filter_mode = request.args.get("filter", "open")  # 'open' or 'closed'
    closed_statuses = {"merged", "closed"}

    ws_map = {}
    for w in _read_workspaces():
        ws_map[w["id"]] = w.get("name", "")

    # Build mr_id → registry entry lookup
    registry = _read_merge_requests()
    registry_by_id = {m["id"]: m for m in registry}
    
    all_mrs = []
    processed_mr_ids = set()
    
    # 1. Add MRs from the central registry
    for mr in registry:
        if filter_mode == "closed" and mr.get("status") not in closed_statuses:
            continue
        if filter_mode == "open" and mr.get("status") in closed_statuses:
            continue
        mr["source"] = "registry"
        all_mrs.append(mr)
        processed_mr_ids.add(mr["id"])

    # 2. Add MRs from sessions that are not in the registry
    # (e.g., due to migration or incomplete sync)
    for ws_id, ws_name in ws_map.items():
        ws_sessions, _ = _workspace_linked_sessions(ws_id)
        for s in ws_sessions:
            if s.get("missing_local"):
                continue
            for mr_link in (s.get("mrs") or []):
                mr_id = mr_link.get("mr_id") or mr_link.get("id")
                if not mr_id or mr_id in processed_mr_ids:
                    continue

                # Try to resolve MR data from registry entry if available
                reg_entry = registry_by_id.get(mr_id)
                if reg_entry:
                    if filter_mode == "closed" and reg_entry.get("status") not in closed_statuses:
                        continue
                    if filter_mode == "open" and reg_entry.get("status") in closed_statuses:
                        continue
                    reg_entry["source"] = "session_link"
                    all_mrs.append(reg_entry)
                    processed_mr_ids.add(mr_id)
                else:
                    # If not in registry, create a placeholder from session link data
                    mr_data = {
                        "id": mr_id,
                        "title": mr_link.get("title") or f"MR {mr_id[:8]}",
                        "url": mr_link.get("url") or "",
                        "status": mr_link.get("status") or "open",
                        "workspace_id": ws_id,
                        "workspace_name": ws_name,
                        "author": mr_link.get("author") or "",
                        "role": mr_link.get("role") or "",
                        "assigned_at": mr_link.get("assigned_at"),
                        "source": "session_link",
                    }
                    if filter_mode == "closed" and mr_data.get("status") not in closed_statuses:
                        continue
                    if filter_mode == "open" and mr_data.get("status") in closed_statuses:
                        continue
                    all_mrs.append(mr_data)
                    processed_mr_ids.add(mr_id)

    # Sort by update time, then ID
    all_mrs.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or x.get("assigned_at") or "", reverse=True)
    
    return jsonify(all_mrs)


@app.route("/api/all-jira-tickets", methods=["GET"])
def api_all_jira_tickets():
    """Return all Jira tickets aggregated across the registry and linked sessions."""
    filter_mode = request.args.get("filter", "open")
    closed_statuses = {"done", "closed"}

    ws_map = {w["id"]: w.get("name", "") for w in _read_workspaces()}
    with _bg_lock:
        for cache_key in _PROVIDER_CACHE_KEYS.values():
            for sess in (_bg_cache.get(cache_key) or []):
                sess_ws = str(sess.get("workspace") or sess.get("workspace_id") or "").strip()
                if sess_ws and sess_ws not in ws_map:
                    ws_map[sess_ws] = sess.get("workspace_name") or sess_ws
    registry = JiraTicketDB.list_all(limit=1000)
    registry_by_id = {t["ticket_id"]: t for t in registry}

    all_tickets = []
    processed_ticket_ids = set()
    tickets_by_id = {}

    for ticket in registry:
        if filter_mode == "closed" and ticket.get("status") not in closed_statuses:
            continue
        if filter_mode == "open" and ticket.get("status") in closed_statuses:
            continue
        ticket.setdefault("sessions", [])
        ticket["source"] = "registry"
        all_tickets.append(ticket)
        processed_ticket_ids.add(ticket["ticket_id"])
        tickets_by_id[ticket["ticket_id"]] = ticket

    for ws_id, ws_name in ws_map.items():
        ws_sessions, _ = _workspace_linked_sessions(ws_id)
        for s in ws_sessions:
            if s.get("missing_local"):
                continue
            for ticket_link in (s.get("jira_tickets") or []):
                ticket_id = ticket_link.get("ticket_id") or ticket_link.get("id")
                if not ticket_id or ticket_id in processed_ticket_ids:
                    target_ticket = tickets_by_id.get(ticket_id)
                    if target_ticket is None:
                        continue
                else:
                    target_ticket = None

                reg_entry = registry_by_id.get(ticket_id)
                session_chip = {
                    "id": s.get("id"),
                    "provider": s.get("provider", "copilot"),
                    "summary": s.get("nickname") or s.get("summary") or s.get("id"),
                    "role": ticket_link.get("role") or "",
                    "assigned_at": ticket_link.get("assigned_at") or ticket_link.get("created_at") or "",
                }

                if reg_entry:
                    if filter_mode == "closed" and reg_entry.get("status") not in closed_statuses:
                        continue
                    if filter_mode == "open" and reg_entry.get("status") in closed_statuses:
                        continue
                    target_ticket = target_ticket or tickets_by_id.get(ticket_id) or dict(reg_entry)
                    target_ticket.setdefault("sessions", [])
                    target_ticket["sessions"].append(session_chip)
                    if target_ticket not in all_tickets:
                        target_ticket["source"] = "session_link"
                        all_tickets.append(target_ticket)
                        tickets_by_id[ticket_id] = target_ticket
                        processed_ticket_ids.add(ticket_id)
                else:
                    ticket_data = {
                        "ticket_id": ticket_id,
                        "ticket_key": ticket_link.get("ticket_key") or ticket_id,
                        "title": ticket_link.get("title") or f"Jira {ticket_id[:8]}",
                        "url": ticket_link.get("url") or "",
                        "status": ticket_link.get("status") or "todo",
                        "priority": ticket_link.get("priority") or "medium",
                        "assignee": ticket_link.get("assignee") or "",
                        "reporter": ticket_link.get("reporter") or "",
                        "workspace_id": ws_id,
                        "workspace_name": ws_name,
                        "sessions": [session_chip],
                        "source": "session_link",
                        "created_at": ticket_link.get("created_at") or ticket_link.get("assigned_at") or "",
                        "updated_at": ticket_link.get("updated_at") or ticket_link.get("assigned_at") or "",
                    }
                    if filter_mode == "closed" and ticket_data.get("status") not in closed_statuses:
                        continue
                    if filter_mode == "open" and ticket_data.get("status") in closed_statuses:
                        continue
                    all_tickets.append(ticket_data)
                    tickets_by_id[ticket_id] = ticket_data
                    processed_ticket_ids.add(ticket_id)

    all_tickets.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or x.get("assigned_at") or "", reverse=True)
    return jsonify(all_tickets)


@app.route("/api/preferences", methods=["GET"])
def api_preferences_get():
    return jsonify(_read_preferences())


@app.route("/api/preferences", methods=["POST"])
def api_preferences_update():
    data = request.get_json(force=True) or {}
    _write_preferences(data)
    return jsonify(data)


# ── Health Checks ─────────────────────────────────────────────────────────────

@app.route("/health/live", methods=["GET"])
def health_live():
    return jsonify({"status": "ok"})


@app.route("/health/ready", methods=["GET"])
def health_ready():
    # Check if database is accessible
    try:
        get_connection()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 503


# ── Utility Routes ────────────────────────────────────────────────────────────

@app.route("/api/utils/markdown", methods=["POST"])
def api_utils_markdown():
    data = request.get_json(force=True) or {}
    text = data.get("text")
    if not text:
        return jsonify({"error": "Text is required"}), 400
    # Use CommonMark parser for consistent Markdown rendering
    from commonmark import Parser
    parser = Parser()
    ast = parser.parse(text)
    # This is a stub; a real implementation would render the AST to HTML or another format.
    # For now, just return the parsed AST (as a string representation).
    from commonmark.render.html import HtmlRenderer
    renderer = HtmlRenderer()
    html_output = renderer.render(ast)
    return jsonify({"html": html_output})


# ── Environment Information ───────────────────────────────────────────────

@app.route("/api/environment", methods=["GET"])
def api_environment_info():
    """Return environment information (OS, Python version, etc.)."""
    return jsonify({
        "os": os.name,
        "platform": sys.platform,
        "python_version": sys.version,
        "project_dir": os.path.abspath(os.getcwd()),
        "session_dir": SESSION_DIR,
        "claude_dir": CLAUDE_DIR,
        "gemini_dir": GEMINI_DIR,
        "codex_dir": CODEX_DIR,
        "hermes_dir": HERMES_DIR,
        "meta_dir": META_DIR,
        "in_docker": _IN_DOCKER,
    })

# ── LLM Provider Endpoints ───────────────────────────────────────────────
# These endpoints are for managing LLM providers and their data.

def _read_llm_providers():
    """Read LLM providers from SQLite."""
    try:
        providers = LLMProviderDB.list_all()
        # Ensure consistent structure and defaults
        normalized = []
        for p in providers:
            normalized_p = {
                "id": p.get("provider_id"),
                "provider_id": p.get("provider_id"),
                "name": p.get("name"),
                "description": p.get("description", ""),
                "status": p.get("status", "enabled"),
                "created_at": p.get("created_at"),
                "updated_at": p.get("updated_at"),
            }
            normalized.append(normalized_p)
        return normalized
    except Exception as e:
        logger.error(f"Error reading LLM providers: {e}")
        return []

def _write_llm_providers(providers):
    """Write LLM providers to SQLite."""
    try:
        for p in providers:
            provider_id = p.get("id") or p.get("provider_id")
            if not provider_id:
                continue
            
            existing = LLMProviderDB.get_by_id(provider_id)
            if existing:
                LLMProviderDB.update(provider_id, {
                    "name": p.get("name", "Untitled"),
                    "description": p.get("description", ""),
                    "status": p.get("status", "enabled"),
                })
            else:
                LLMProviderDB.create({
                    "provider_id": provider_id,
                    "name": p.get("name", "Untitled"),
                    "description": p.get("description", ""),
                    "status": p.get("status", "enabled"),
                })
    except Exception as e:
        logger.error(f"Error writing LLM providers: {e}")


@app.route("/api/llm-providers", methods=["GET"])
def api_llm_providers_list():
    providers = _read_llm_providers()
    return jsonify(providers)


@app.route("/api/llm-providers", methods=["POST"])
def api_llm_providers_create():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    provider_id = _unique_ts_id()
    p = {
        "id": provider_id,
        "name": name,
        "description": (data.get("description") or "").strip(),
        "status": "enabled",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    LLMProviderDB.create({
        "provider_id": provider_id,
        "name": p["name"],
        "description": p["description"],
        "status": p["status"],
    })
    return jsonify(p)


@app.route("/api/llm-providers/<provider_id>", methods=["PUT"])
def api_llm_providers_update(provider_id):
    data = request.get_json(force=True) or {}
    providers = _read_llm_providers()
    for p in providers:
        if p["id"] == provider_id:
            if "name" in data:
                p["name"] = data["name"].strip()
            if "description" in data:
                p["description"] = data["description"].strip()
            if "status" in data:
                p["status"] = data["status"].strip()
            _write_llm_providers(providers)
            return jsonify(p)
    return jsonify({"error": "Provider not found"}), 404

@app.route("/api/llm-providers/<provider_id>", methods=["DELETE"])
def api_llm_providers_delete(provider_id):
    success = LLMProviderDB.delete(provider_id)
    if not success:
        return jsonify({"error": "Provider not found"}), 404
    return jsonify({"deleted": provider_id})


# ── Model Registration Endpoints ──────────────────────────────────────────────

def _read_models():
    """Read models from SQLite."""
    try:
        models = ModelDB.list_all()
        # Ensure consistent structure and defaults
        normalized = []
        for m in models:
            normalized_m = {
                "id": m.get("model_id"),
                "model_id": m.get("model_id"),
                "provider_id": m.get("provider_id"),
                "name": m.get("name"),
                "description": m.get("description", ""),
                "status": m.get("status", "enabled"),
                "created_at": m.get("created_at"),
                "updated_at": m.get("updated_at"),
            }
            normalized.append(normalized_m)
        return normalized
    except Exception as e:
        logger.error(f"Error reading models: {e}")
        return []

def _write_models(models):
    """Write models to SQLite."""
    try:
        for m in models:
            model_id = m.get("id") or m.get("model_id")
            if not model_id:
                continue
            
            existing = ModelDB.get_by_id(model_id)
            if existing:
                ModelDB.update(model_id, {
                    "name": m.get("name", "Untitled"),
                    "description": m.get("description", ""),
                    "status": m.get("status", "enabled"),
                })
            else:
                ModelDB.create({
                    "model_id": model_id,
                    "provider_id": m.get("provider_id"),
                    "name": m.get("name", "Untitled"),
                    "description": m.get("description", ""),
                    "status": m.get("status", "enabled"),
                })
    except Exception as e:
        logger.error(f"Error writing models: {e}")


@app.route("/api/models", methods=["GET"])
def api_models_list():
    """List all registered models."""
    models = _read_models()
    providers = _read_llm_providers()
    provider_map = {p["id"]: p["name"] for p in providers}
    for m in models:
        m["provider_name"] = provider_map.get(m.get("provider_id"), "Unknown")
    return jsonify(models)


@app.route("/api/models", methods=["POST"])
def api_models_create():
    """Register a new model."""
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    provider_id = data.get("provider_id")
    if not name or not provider_id:
        return jsonify({"error": "name and provider_id are required"}), 400
    model_id = _unique_ts_id()
    m = {
        "id": model_id,
        "model_id": model_id,
        "provider_id": provider_id,
        "name": name,
        "description": (data.get("description") or "").strip(),
        "status": "enabled",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    ModelDB.create({
        "model_id": model_id,
        "provider_id": provider_id,
        "name": m["name"],
        "description": m["description"],
        "status": m["status"],
    })
    return jsonify(m)


@app.route("/api/models/<model_id>", methods=["PUT"])
def api_models_update(model_id):
    """Update an existing model."""
    data = request.get_json(force=True) or {}
    models = _read_models()
    for m in models:
        if m["id"] == model_id:
            if "name" in data:
                m["name"] = data["name"].strip()
            if "description" in data:
                m["description"] = data["description"].strip()
            if "status" in data:
                m["status"] = data["status"].strip()
            _write_models(models)
            return jsonify(m)
    return jsonify({"error": "Model not found"}), 404

@app.route("/api/models/<model_id>", methods=["DELETE"])
def api_models_delete(model_id):
    """Delete a model."""
    success = ModelDB.delete(model_id)
    if not success:
        return jsonify({"error": "Model not found"}), 404
    return jsonify({"deleted": model_id})


# ── LLM Provider & Model Configuration Endpoints ──────────────────────────────
# These are for managing API keys, model endpoints, etc.

# Placeholder for actual config loading/saving logic
def _read_llm_config():
    """Read LLM configuration from a file or DB."""
    # In a real app, this would load from a file (e.g., config.yaml) or DB.
    # For now, return dummy data.
    return {
        "copilot": {"api_key": "dummy_copilot_key", "endpoint": "https://api.copilot.com/v1"},
        "claude": {"api_key": "dummy_claude_key", "endpoint": "https://api.claude.com/v1"},
        "gemini": {"api_key": "dummy_gemini_key", "endpoint": "https://generativelanguage.googleapis.com/v1beta/models"},
        "codex": {"api_key": "dummy_codex_key", "endpoint": "https://api.codex.ai/v1"},
        "hermes": {"api_key": "dummy_hermes_key", "endpoint": "https://api.hermes.ai/v1"},
    }

def _write_llm_config(config):
    """Write LLM configuration."""
    # In a real app, this would save to a file or DB.
    pass


@app.route("/api/llm-config", methods=["GET"])
def api_llm_config_get():
    """Get LLM configuration."""
    config = _read_llm_config()
    # In a real app, sensitive info like API keys would be masked or omitted.
    return jsonify(config)


@app.route("/api/llm-config", methods=["POST"])
def api_llm_config_update():
    """Update LLM configuration."""
    data = request.get_json(force=True) or {}
    config = _read_llm_config()
    for key, value in data.items():
        if key in config:
            config[key] = value
    _write_llm_config(config)
    return jsonify({"ok": True, "config": config})


# ── Helper Functions for MR & Jira Integration ───────────────────────────────

# Cache for merge requests registry to avoid frequent file reads
_mr_registry_cache = {"data": None, "timestamp": 0}
_MR_REGISTRY_FILE = os.path.join(META_DIR, "merge_requests.json")
_MAX_AGE_SECONDS = 5 * 60  # Cache for 5 minutes

def _read_merge_requests():
    """Read MRs from the central registry file."""
    now = time.time()
    if _mr_registry_cache["data"] is not None and (now - _mr_registry_cache["timestamp"]) < _MAX_AGE_SECONDS:
        return _mr_registry_cache["data"]
    
    if not os.path.exists(_MR_REGISTRY_FILE):
        _mr_registry_cache["data"] = []
        _mr_registry_cache["timestamp"] = now
        return []
    
    try:
        with open(_MR_REGISTRY_FILE, "r") as f:
            data = json.load(f)
        _mr_registry_cache["data"] = data
        _mr_registry_cache["timestamp"] = now
        return data
    except Exception as e:
        logger.error(f"Error reading MR registry {_MR_REGISTRY_FILE}: {e}")
        return []

def _write_merge_requests(mrs):
    """Write MRs to the central registry file."""
    try:
        with open(_MR_REGISTRY_FILE, "w") as f:
            json.dump(mrs, f, indent=2)
        # Invalidate cache
        _mr_registry_cache["data"] = None
    except Exception as e:
        logger.error(f"Error writing MR registry {_MR_REGISTRY_FILE}: {e}")


def _parse_mr_url(url):
    """Parse GitLab/GitHub MR URL to extract project_id and mr_iid."""
    # Regex to capture project ID and MR IID from common GitLab/GitHub URLs
    # Example GitLab: https://gitlab.com/mygroup/myproject/-/merge_requests/123
    # Example GitHub: https://github.com/myorg/myrepo/pull/456
    match = re.search(r'(?:gitlab\.com|github\.com)/([^/]+)/([^/]+?)(?:/-/merge_requests/|/pull/)([\d]+)', url)
    if match:
        project_id = f"{match.group(1)}/{match.group(2)}"
        mr_iid = match.group(3)
        return project_id, mr_iid
    return None, None

def _auto_detect_mr_role(mr_entry):
    """Auto-detect role based on MR author and user preferences."""
    try:
        prefs = _read_preferences()
        my_name = (prefs.get("name") or "").strip()
        mr_author = (mr_entry.get("author") or "").strip()
        if my_name and mr_author and my_name.lower() == mr_author.lower():
            return "author"
    except Exception:
        pass
    return "reviewer"  # Default role

def _enrich_session_mrs(mrs):
    """Enrich MR links from sessions with data from the central registry."""
    enriched = []
    registry = _read_merge_requests()
    registry_map = {m["id"]: m for m in registry}
    for link in mrs or []:
        mr_id = link.get("mr_id") or link.get("id")
        if not mr_id:
            continue
        reg_entry = registry_map.get(mr_id)
        if reg_entry:
            # Merge session link data with registry data
            merged = dict(reg_entry)
            merged.update(link) # Session link data (e.g., role, assigned_at) takes precedence
            enriched.append(merged)
        else:
            # MR not found in registry, use session link data as is
            link["source"] = "session_only"
            enriched.append(link)
    # Sort by updated_at (registry) or assigned_at (session link)
    enriched.sort(key=lambda x: x.get("updated_at") or x.get("assigned_at") or "", reverse=True)
    return enriched

def _enrich_session_jira_tickets(tickets):
    """Enrich Jira ticket links from sessions with data from the central registry."""
    enriched = []
    registry = _read_jira_tickets()
    registry_map = {t["id"]: t for t in registry}
    for ticket in tickets or []:
        ticket_id = ticket.get("ticket_id")
        if not ticket_id:
            continue
        reg_entry = registry_map.get(ticket_id)
        if reg_entry:
            # Merge session ticket data with registry data
            merged = dict(reg_entry)
            merged.update(ticket) # Session ticket data (e.g., role) takes precedence
            enriched.append(merged)
        else:
            # Ticket not found in registry, use session ticket data as is
            ticket["source"] = "session_only"
            enriched.append(ticket)
    # Sort by updated_at (registry) or assigned_at (session link)
    enriched.sort(key=lambda x: x.get("updated_at") or x.get("assigned_at") or "", reverse=True)
    return enriched

# ── Session Management Endpoints ──────────────────────────────────────────────

@app.route("/api/session/<session_id>/convert", methods=["POST"])
def api_session_convert(session_id):
    """Convert a session to a new prompt, potentially with context from previous history."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True) or {}
    prompt = data.get("prompt", "").strip()
    convert_context = data.get("context", {}) # e.g., {'mode': 'handoff', 'data': {...}}

    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    # Get session info to build conversion prompt
    info = get_session_info(session_id, full)
    conv_stats = None # TODO: Implement gathering of conversation stats if needed

    # Build the actual prompt string based on conversion context
    final_prompt = ""
    if convert_context.get("mode") == "handoff":
        final_prompt = build_convert_prompt(info, conv_stats, provider=info.get("provider", "copilot"))
    else:
        # Default conversion logic, perhaps just the session summary + prompt
        final_prompt = f"Continue from session: {info.get('summary') or info.get('nickname')}\n\n{prompt}"

    # Create a new session (or update existing if that's the desired flow)
    # For now, just return the converted prompt
    return jsonify({"converted_prompt": final_prompt})


# ── Codex Session Management Endpoints ─────────────────────────────────────────

def codex_session_dir(session_id):
    return os.path.join(CODEX_SESSIONS_DIR, session_id)

def codex_find_session_jsonl(session_id):
    path = os.path.join(CODEX_SESSIONS_DIR, session_id, "session.jsonl")
    return path if os.path.exists(path) else None

def codex_find_session_dir(session_id):
    path = os.path.join(CODEX_SESSIONS_DIR, session_id)
    return path if os.path.isdir(path) else None

def codex_session_files(session_id):
    path = codex_find_session_dir(session_id)
    if not path:
        return []
    return glob.glob(os.path.join(path, "**", "*"), recursive=True)

def codex_safe_read_jsonl(path):
    entries = []
    try:
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.error(f"Error reading JSONL file {path}: {e}")
    return entries

def codex_load_all_meta():
    meta_file = CODEX_META_DIR
    if not os.path.exists(meta_file):
        return {}
    try:
        with open(meta_file, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def codex_save_all_meta(meta):
    try:
        os.makedirs(os.path.dirname(CODEX_META_DIR), exist_ok=True)
        with open(CODEX_META_DIR, "w") as f:
            json.dump(meta, f)
    except Exception as e:
        logger.error(f"Error saving Codex meta {CODEX_META_DIR}: {e}")

def codex_read_session_meta(session_id):
    meta = codex_load_all_meta()
    return meta.get(session_id, {})

def codex_write_session_meta(session_id, meta_data):
    meta = codex_load_all_meta()
    meta[session_id] = meta_data
    codex_save_all_meta(meta)

def codex_get_all_sessions():
    """List all Codex sessions (dirs in CODEX_SESSIONS_DIR)."""
    sessions = []
    for sid in os.listdir(CODEX_SESSIONS_DIR):
        session_path = codex_session_dir(sid)
        if os.path.isdir(session_path):
            session_file = codex_find_session_jsonl(sid)
            if session_file:
                entries = codex_safe_read_jsonl(session_file)
                if entries:
                    meta = codex_read_session_meta(sid)
                    summary = meta.get("nickname") or meta.get("summary")
                    if not summary:
                        # Try to find a summary from first assistant message
                        for entry in entries:
                            if entry.get("type") == "message" and entry.get("role") == "assistant":
                                summary = entry.get("content", "").strip()[:120]
                                break
                    sessions.append({
                        "id": sid,
                        "provider": "codex",
                        "summary": summary,
                        "nickname": meta.get("nickname", ""),
                        "starred": meta.get("starred", False),
                        "archived": meta.get("archived", False),
                        "created_at": entry.get("timestamp", "") if entries else "",
                        "updated_at": entry.get("timestamp", "") if entries else "", # Use last entry timestamp as proxy
                        "status": "active" if is_session_open(session_path) else "idle",
                    })
    sessions.sort(key=lambda s: s.get("updated_at") or s.get("created_at") or "", reverse=True)
    return sessions

def codex_get_session_info(session_id, include_tree=False):
    path = codex_session_dir(session_id)
    if not path or not os.path.isdir(path):
        return None
    
    entries = codex_safe_read_jsonl(codex_find_session_jsonl(session_id))
    if not entries:
        return None
    
    meta = codex_read_session_meta(session_id)
    
    # Extract project context from first user message's environment context
    cwd = ""
    branch = ""
    project = ""
    for entry in entries:
        if entry.get("type") != "message" or entry.get("role") != "user":
            continue
        text = _codex_message_text(entry.get("content"))
        if "<environment_context>" in text:
            env_ctx = _codex_extract_env_context(text)
            if env_ctx:
                cwd = env_ctx.get("cwd") or cwd
                branch = env_ctx.get("branch") or branch
                project = env_ctx.get("project") or project
                break
    
    first_msg_ts = entries[0].get("timestamp", "")
    last_msg_ts = entries[-1].get("timestamp", "")
    
    # Extract common file info from tool calls
    tool_calls = [e for e in entries if e.get("type") == "function_call"]
    files_seen = {}
    git_commands = []
    for call in tool_calls:
        tool_name = call.get("name", "").lower()
        args = _codex_parse_arguments(call.get("arguments"))
        ts = call.get("timestamp", "")
        
        fpath = _codex_extract_tool_path(args)
        if fpath and "/.codex/" not in fpath and "/.claude/" not in fpath and "/.copilot/" not in fpath:
            action = "view"
            if any(k in tool_name for k in ("write", "create")):
                action = "create"
            elif any(k in tool_name for k in ("edit", "patch", "replace")):
                action = "edit"
            elif any(k in tool_name for k in ("read", "view", "open")):
                action = "view"
            
            if fpath not in files_seen:
                files_seen[fpath] = {"path": fpath, "action": action, "count": 0, "first_seen": ts, "last_seen": ts}
            files_seen[fpath]["count"] += 1
            files_seen[fpath]["last_seen"] = ts
            if action in ("create", "edit"):
                files_seen[fpath]["action"] = action

        # Track git commands
        if tool_name in ("shell", "bash", "exec_command"):
            cmd = _codex_extract_command_string(args)
            if cmd and "git " in cmd:
                git_commands.append({"command": cmd, "timestamp": ts})

    file_list = []
    for fpath, info in files_seen.items():
        info["name"] = os.path.basename(fpath)
        info["relative"] = os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
        file_list.append(info)
    file_list.sort(key=lambda x: x.get("last_seen", "") or "", reverse=True)

    return {
        "id": session_id,
        "provider": "codex",
        "summary": meta.get("nickname") or meta.get("summary") or _codex_extract_summary(entries) or session_id[:8],
        "nickname": meta.get("nickname", ""),
        "starred": meta.get("starred", False),
        "archived": meta.get("archived", False),
        "project": project or (cwd.split("/")[-1] if cwd else ""),
        "cwd": cwd,
        "branch": branch,
        "created_at": first_msg_ts,
        "updated_at": last_msg_ts,
        "status": "active" if is_session_open(path) else "idle",
        "file_count": len(file_list),
        "git_commit_count": len([g for g in git_commands if "commit" in g["command"]]),
        "files": file_list,
        "tool_calls": tool_calls,
        "git_commands": git_commands,
    }

@app.route("/api/codex/session/<session_id>/project-files")
def api_codex_session_project_files(session_id):
    """Extract files created/edited/read during a Codex session from JSONL."""
    path = codex_find_session_jsonl(session_id)
    if not path:
        return jsonify({"error": "Session not found"}), 404

    entries = codex_safe_read_jsonl(path)
    if not entries:
        return jsonify({"files": [], "cwd": ""})

    cwd = ""
    files_seen = {}

    for entry in entries:
        if entry.get("type") != "message" or entry.get("role") != "user":
            continue
        text = _codex_message_text(entry.get("content"))
        if "<environment_context>" in text:
            cwd = _codex_extract_env_context(text) or cwd
            if cwd:
                break

    for entry in entries:
        if entry.get("type") != "function_call":
            continue
        tool_name = (entry.get("name") or "").lower()
        args = _codex_parse_arguments(entry.get("arguments"))
        ts = entry.get("timestamp", "")
        fpath = _codex_extract_tool_path(args)
        if not fpath or "/.codex/" in fpath or "/.claude/" in fpath or "/.copilot/" in fpath:
            continue

        action = "view"
        if any(k in tool_name for k in ("write", "create")):
            action = "create"
        elif any(k in tool_name for k in ("edit", "patch", "replace")):
            action = "edit"
        elif any(k in tool_name for k in ("read", "view", "open")):
            action = "view"
        else:
            action = tool_name or "view"

        if fpath not in files_seen:
            files_seen[fpath] = {
                "path": fpath,
                "action": action,
                "count": 0,
                "first_seen": ts,
                "last_seen": ts,
            }
        files_seen[fpath]["count"] += 1
        files_seen[fpath]["last_seen"] = ts
        if action in ("create", "edit", "write"):
            files_seen[fpath]["action"] = action

    file_list = []
    for fpath, info in files_seen.items():
        info["name"] = os.path.basename(fpath)
        info["relative"] = (
            os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
        )
        file_list.append(info)

    file_list.sort(key=lambda x: x.get("last_seen", ""), reverse=True)
    return jsonify({"files": file_list, "cwd": cwd})


@app.route("/api/codex/session/<session_id>/git-changes")
def api_codex_session_git_changes(session_id):
    """Extract git commands, commits, and file changes from Codex JSONL."""
    path = codex_find_session_jsonl(session_id)
    if not path:
        return jsonify({"error": "Session not found"}), 404

    entries = codex_safe_read_jsonl(path)
    if not entries:
        return jsonify({"commits": [], "file_changes": [], "git_commands": [], "file_summary": []})

    tool_starts = {}
    tool_results = {}
    commits = []
    file_changes = []
    git_commands = []

    for entry in entries:
        etype = entry.get("type", "")
        ts = entry.get("timestamp", "")

        if etype == "function_call":
            tool_name = (entry.get("name") or "").lower()
            args = _codex_parse_arguments(entry.get("arguments"))
            call_id = entry.get("call_id") or ""
            tool_starts[call_id] = {"name": tool_name, "args": args, "ts": ts}

            fpath = _codex_extract_tool_path(args)
            if fpath:
                if any(k in tool_name for k in ("write", "create")):
                    file_changes.append({"type": "create", "path": fpath, "timestamp": ts})
                elif any(k in tool_name for k in ("edit", "patch", "replace")):
                    file_changes.append({"type": "edit", "path": fpath, "timestamp": ts})

        elif etype == "function_call_output":
            call_id = entry.get("call_id") or ""
            output = entry.get("output")
            result_text = ""
            success = None
            if isinstance(output, dict):
                result_text = json.dumps(output)
            elif isinstance(output, str):
                try:
                    parsed = json.loads(output)
                    if isinstance(parsed, dict):
                        result_text = str(parsed.get("output", parsed))
                        meta = parsed.get("metadata", {})
                        if isinstance(meta, dict) and meta.get("exit_code") is not None:
                            success = meta.get("exit_code") == 0
                    else:
                        result_text = str(parsed)
                except Exception:
                    result_text = output
            tool_results[call_id] = {"result": result_text, "ts": ts, "success": success}

    git_cmd_pattern = re.compile(
        r"\bgit\s+(--no-pager\s+)?(commit|push|pull|add|diff|status|checkout|switch|log|merge|rebase|stash|reset|branch|tag|fetch|clone|remote)"
    )
    for call_id, start in tool_starts.items():
        tool_name = start["name"]
        if tool_name not in ("shell", "bash", "exec_command"):
            continue

        cmd = _codex_extract_command_string(start["args"])
        if not cmd or not git_cmd_pattern.search(cmd):
            continue

        result_info = tool_results.get(call_id, {})
        result_text = result_info.get("result", "")

        is_commit = "git" in cmd and "commit" in cmd
        is_push = "git" in cmd and "push" in cmd
        is_diff = "git" in cmd and "diff" in cmd
        is_status = "git" in cmd and "status" in cmd
        is_add = "git" in cmd and "add " in cmd
        is_checkout = "git" in cmd and ("checkout" in cmd or "switch" in cmd)

        git_commands.append({
            "command": cmd[:500],
            "timestamp": start["ts"],
            "result": result_text[:3000],
            "type": "commit" if is_commit else "push" if is_push else "diff" if is_diff else "status" if is_status else "add" if is_add else "checkout" if is_checkout else "other",
        })

        if is_commit and result_text:
            match = re.search(r"\[(\S+)\s+([a-f0-9]+)\]\s+(.*?)(?:\\n|$)", result_text)
            if match:
                branch = match.group(1)
                sha = match.group(2)
                message = match.group(3)
                files_match = re.search(r"(\d+)\s+files?\s+changed", result_text)
                ins_match = re.search(r"(\d+)\s+insertions?", result_text)
                del_match = re.search(r"(\d+)\s+deletions?", result_text)
                commits.append({
                    "sha": sha,
                    "branch": branch,
                    "message": message,
                    "timestamp": start["ts"],
                    "files_changed": int(files_match.group(1)) if files_match else 0,
                    "insertions": int(ins_match.group(1)) if ins_match else 0,
                    "deletions": int(del_match.group(1)) if del_match else 0,
                })

    unique_files = {}
    for fc in file_changes:
        path_key = fc["path"]
        if path_key not in unique_files:
            unique_files[path_key] = {
                "path": path_key,
                "creates": 0,
                "edits": 0,
                "first_seen": fc["timestamp"],
                "last_seen": fc["timestamp"],
            }
        if fc["type"] == "create":
            unique_files[path_key]["creates"] += 1
        else:
            unique_files[path_key]["edits"] += 1
        unique_files[path_key]["last_seen"] = fc["timestamp"]

    return jsonify({
        "commits": commits,
        "file_changes": file_changes,
        "file_summary": sorted(unique_files.values(), key=lambda x: x["last_seen"], reverse=True),
        "git_commands": git_commands,
    })


@app.route("/api/codex/search")
def api_codex_search():
    query = request.args.get("q", "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"results": [], "error": "Query too short"})
    results = []
    limit = int(request.args.get("limit", 50))
    for path in codex_session_files():
        entries = codex_safe_read_jsonl(path)
        if not entries:
            continue
        session_id = _codex_extract_session_id(path, entries[0])
        meta = codex_read_session_meta(session_id)
        summary = meta.get("nickname") or _codex_extract_summary(entries) or session_id[:8]
        for entry in entries:
            if entry.get("type") != "message":
                continue
            text = _codex_message_text(entry.get("content"))
            if query in text.lower():
                idx = text.lower().index(query)
                start = max(0, idx - 80)
                snippet = text[start:start + 200]
                results.append({
                    "session_id": session_id,
                    "summary": summary,
                    "provider": "codex",
                    "timestamp": entry.get("timestamp", ""),
                    "content": snippet,
                })
                if len(results) >= limit:
                    break
        if len(results) >= limit:
            break
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"results": results})


if __name__ == "__main__":
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("FLASK_PORT", "8090"))
    app.run(host=host, port=port, debug=False)
    
# --- End of original app.py content ---
# This section replaces the original content with the corrected version.
# The following code blocks were removed:
# 1. The entire 'api_sessions' function definition.
# 2. The entire 'api_bulk_delete' function definition.

# Corrected code below:


if __name__ == "__main__":
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("FLASK_PORT", "8090"))
    app.run(host=host, port=port, debug=False)
