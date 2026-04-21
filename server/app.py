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
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from flask import Flask, jsonify, request, abort, send_file
from sqlite_client import get_sqlite, get_connection, init_sqlite, close_sqlite
from db.workspaces import WorkspaceDB
from db.tasks import TaskDB
from db.notes import NoteDB
from db.merge_requests import MergeRequestDB
from db.jira_tickets import JiraTicketDB
from db.notifications import NotificationDB
from hardening import rate_limit, validate_request, safe_limit
from abilities.routes import abilities_bp
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


@app.route("/api/sessions")
def api_sessions():
    with _bg_lock:
        sessions = _bg_cache.get('copilot_sessions')
    if sessions is None:
        return jsonify({"sessions": [], "total": 0, "has_more": False, "loading": True})
    total = len(sessions)
    limit = request.args.get("limit", 0, type=int)
    offset = request.args.get("offset", 0, type=int)
    if limit > 0:
        page = sessions[offset:offset + limit]
        return jsonify({"sessions": page, "total": total, "has_more": offset + limit < total})
    return jsonify({"sessions": sessions, "total": total, "has_more": False})


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


@app.route("/api/sessions/bulk-delete", methods=["POST"])
def api_bulk_delete():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No session IDs provided"}), 400

    session_root = os.path.realpath(SESSION_DIR)
    deleted = []
    errors = []

    for sid in ids:
        full = os.path.realpath(os.path.join(SESSION_DIR, sid))
        if not full.startswith(session_root):
            errors.append({"id": sid, "error": "Invalid ID"})
            continue
        if os.path.isdir(full):
            if is_session_open(full):
                errors.append({"id": sid, "error": "Session is open"})
                continue
            try:
                shutil.rmtree(full)
            except Exception as e:
                errors.append({"id": sid, "error": str(e)})
                continue
        deleted.append(sid)

    if deleted:
        with _bg_lock:
            if _bg_cache.get('copilot_sessions') is not None:
                deleted_set = set(deleted)
                _bg_cache['copilot_sessions'] = [s for s in _bg_cache['copilot_sessions'] if s['id'] not in deleted_set]
    return jsonify({"deleted": deleted, "errors": errors})


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
        
        # Create note in SQLite
        import uuid
        note_id = f"note_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        
        NoteDB.create({
            "note_id": note_id,
            "session_id": full_session_id,
            "workspace_id": "",
            "text": text,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        
        # Get all notes for this session
        notes_list = NoteDB.list_by_session(full_session_id)
        
        _emit_event("note_created", f"Note added to session", {"session_id": session_id})
        return jsonify({"id": session_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})
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
        with _bg_lock:
            for provider in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
                sessions = _bg_cache.get(provider) or []
                for s in sessions:
                    if s.get("workspace") == ws_id:
                        pkey = provider.replace("_sessions", "")
                        counts[pkey] += 1
                        counts["total"] += 1
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
    # Delete from SQLite
    success = WorkspaceDB.delete(ws_id)
    if not success:
        return jsonify({"error": "Workspace not found"}), 404
    
    # Remove workspace assignment from all sessions
    with _bg_lock:
        for provider in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            sessions = _bg_cache.get(provider) or []
            for s in sessions:
                if s.get("workspace") == ws_id:
                    s["workspace"] = None
    
    _emit_event("workspace_deleted", f"Workspace {ws_id} deleted", {"workspace_id": ws_id})
    return jsonify({"deleted": ws_id})

@app.route("/api/workspaces/<ws_id>/sessions", methods=["GET"])
def api_workspaces_sessions(ws_id):
    """Get all sessions across all providers for a workspace."""
    results = []
    with _bg_lock:
        for provider in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pkey = provider.replace("_sessions", "")
            sessions = _bg_cache.get(provider) or []
            for s in sessions:
                if s.get("workspace") == ws_id:
                    session = dict(s)
                    # pkey is 'gemini' here for gemini_sessions
                    session["provider"] = pkey
                    # Ensure cwd and resume_command are present for terminal resume
                    if not session.get("cwd") and session.get("project_path"):
                        session["cwd"] = session["project_path"]
                    if not session.get("resume_command"):
                        if pkey == "gemini":
                            c = session.get("cwd") or "~"
                            session["resume_command"] = f"cd {c} && gemini --resume {session['id']}"
                        elif pkey == "codex":
                            c = session.get("cwd") or "~"
                            session["resume_command"] = f"cd {c} && codex resume {session['id']}"
                    results.append(session)
    results.sort(key=lambda s: str(s.get("updated_at") or s.get("created_at") or ""), reverse=True)
    return jsonify({"sessions": results})

@app.route("/api/workspaces/<ws_id>/files", methods=["GET"])
def api_workspaces_files(ws_id):
    """Get all session files grouped by session for a workspace."""
    grouped = []  # [{session_id, provider, summary, project, files: [...]}]

    with _bg_lock:
        for provider_key in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pname = provider_key.replace("_sessions", "")
            for s in (_bg_cache.get(provider_key) or []):
                if s.get("workspace") != ws_id:
                    continue
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
                    from flask import request
                    res = api_codex_session_project_files(sid)
                    data = res.get_json() if hasattr(res, 'get_json') else {}
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
                    fdata = res.get_json() if hasattr(res, 'get_json') else {}
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
    with _bg_lock:
        for provider_key in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pname = provider_key.replace("_sessions", "")
            for s in (_bg_cache.get(provider_key) or []):
                if s.get("workspace") != ws_id:
                    continue
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

    # 1. Notes from bg_cache (embedded in session file data)
    with _bg_lock:
        for provider_key in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pname = provider_key.replace("_sessions", "")
            for s in (_bg_cache.get(provider_key) or []):
                if s.get("workspace") != ws_id:
                    continue
                notes = s.get("notes") or []
                if not notes:
                    continue
                seen_session_ids.add(s.get("id", ""))
                sorted_notes = sorted(notes, key=lambda n: n.get("timestamp") or "", reverse=True)
                groups.append({
                    "session_id": s.get("id", ""),
                    "provider": pname,
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

    # Search sessions and notes within workspaces
    ws_by_id = {w["id"]: w for w in workspaces}
    with _bg_lock:
        for provider_key in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pname = provider_key.replace("_sessions", "")
            for s in (_bg_cache.get(provider_key) or []):
                ws_id = s.get("workspace")
                if not ws_id or ws_id not in ws_by_id:
                    continue
                ws_name = ws_by_id[ws_id].get("name", "")
                sid = s.get("id", "")
                summary = s.get("nickname") or s.get("summary") or sid
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

    mr_map = {}  # url_key → { url, jira, status, project, sessions: [...] }

    # Seed from registry (source of truth)
    for m in registry:
        url = (m.get("url") or "").strip()
        if not url:
            continue
        key = url.lower().rstrip("/")
        mr_map[key] = {
            "url": url,
            "title": m.get("title") or "",
            "jira": m.get("jira") or "",
            "status": m.get("status") or "open",
            "author": m.get("author") or "",
            "priority": m.get("priority") or "medium",
            "project": m.get("project_id") or "Other",
            "mr_id": m["id"],
            "sessions": [],
        }

    # Walk sessions and attach session info
    with _bg_lock:
        providers = [
            ("copilot", _bg_cache.get("copilot_sessions") or []),
            ("claude",  _bg_cache.get("claude_sessions") or []),
            ("codex", _bg_cache.get("codex_sessions") or []),
            ("gemini", _bg_cache.get("gemini_sessions") or []),
            ("hermes", _bg_cache.get("hermes_sessions") or []),
        ]
    for prov, sessions in providers:
        for s in sessions:
            mrs = s.get("mrs") or []
            # backward compat: old single "mr" field
            if not mrs and s.get("mr"):
                mrs = [{"url": s["mr"], "status": "open", "role": "author", "jira": ""}]
            for mr in mrs:
                url = (mr.get("url") or "").strip()
                # New format: resolve mr_id → registry
                if not url and mr.get("mr_id"):
                    reg = registry_by_id.get(mr["mr_id"])
                    if reg:
                        url = (reg.get("url") or "").strip()
                if not url:
                    continue
                key = url.lower().rstrip("/")
                if key not in mr_map:
                    proj = ""
                    m_gl = re.search(r'(?:gitlab\.com|gitlab\.[^/]+)/(.+?)/-/merge_requests/', url)
                    if m_gl:
                        proj = m_gl.group(1)
                    else:
                        m_gh = re.search(r'github\.com/([^/]+/[^/]+)/pull/', url)
                        if m_gh:
                            proj = m_gh.group(1)
                    mr_map[key] = {
                        "url": url,
                        "jira": mr.get("jira") or "",
                        "status": mr.get("status") or "open",
                        "project": proj or "Other",
                        "sessions": [],
                    }
                entry = mr_map[key]
                if mr.get("jira") and not entry["jira"]:
                    entry["jira"] = mr["jira"]
                sid = s.get("session_id") or s.get("id") or ""
                summary = s.get("summary") or s.get("name") or sid[:8]
                ws_id = s.get("workspace_id") or s.get("workspace") or ""
                entry["sessions"].append({
                    "id": sid,
                    "summary": summary,
                    "provider": prov,
                    "role": mr.get("role") or "author",
                    "workspace_id": ws_id,
                    "workspace_name": ws_map.get(ws_id, ""),
                })

    if filter_mode == "closed":
        result = [m for m in mr_map.values() if m["status"] in closed_statuses]
    else:
        result = [m for m in mr_map.values() if m["status"] not in closed_statuses]
    result.sort(key=lambda m: m["url"].lower())
    return jsonify(result)

@app.route("/api/all-jira-tickets", methods=["GET"])
def api_all_jira_tickets():
    """Return all Jira tickets from the central registry.
    ?filter=open (default) returns non-done; ?filter=closed returns done.
    ?assignee=name filters by assignee (case-insensitive substring match).
    ?status=exact filters by exact status value.
    """
    filter_mode = request.args.get("filter", "open")
    closed_statuses = {"done"}

    tickets = _read_jira_tickets()

    # Enrich with session links
    with _bg_lock:
        providers = [
            ("copilot", _bg_cache.get("copilot_sessions") or []),
            ("claude",  _bg_cache.get("claude_sessions") or []),
            ("codex", _bg_cache.get("codex_sessions") or []),
            ("gemini", _bg_cache.get("gemini_sessions") or []),
            ("hermes", _bg_cache.get("hermes_sessions") or []),
        ]

    ws_map = {}
    for w in _read_workspaces():
        ws_map[w["id"]] = w.get("name", "")

    registry_by_id = {t["id"]: t for t in tickets}

    for t in tickets:
        t["sessions"] = []

    for prov, sessions in providers:
        for s in sessions:
            jt_links = s.get("jira_tickets") or []
            for link in jt_links:
                ticket_id = link.get("ticket_id")
                if ticket_id and ticket_id in registry_by_id:
                    sid = s.get("session_id") or s.get("id") or ""
                    summary = s.get("summary") or s.get("name") or sid[:8]
                    ws_id = s.get("workspace_id") or s.get("workspace") or ""
                    registry_by_id[ticket_id].setdefault("sessions", []).append({
                        "id": sid,
                        "summary": summary,
                        "provider": prov,
                        "role": link.get("role") or "watcher",
                        "workspace_id": ws_id,
                        "workspace_name": ws_map.get(ws_id, ""),
                    })

    # Apply assignee filter
    assignee_filter = (request.args.get("assignee") or "").strip().lower()
    if assignee_filter:
        tickets = [t for t in tickets if assignee_filter in (t.get("assignee") or "").lower()]

    # Apply exact status filter (overrides open/closed toggle)
    status_filter = (request.args.get("status") or "").strip()
    if status_filter:
        tickets = [t for t in tickets if t.get("status") == status_filter]
    elif filter_mode == "closed":
        tickets = [t for t in tickets if t.get("status") in closed_statuses]
    else:
        tickets = [t for t in tickets if t.get("status") not in closed_statuses]

    tickets.sort(key=lambda t: (t.get("ticket_key") or "").lower())
    return jsonify(tickets)


@app.route("/api/workspaces/<ws_id>/context", methods=["GET"])
def api_workspaces_context(ws_id):
    """Generate a union-session context prompt aggregating all session data for a workspace."""
    workspaces = _read_workspaces()
    ws = next((w for w in workspaces if w["id"] == ws_id), None)
    if not ws:
        return jsonify({"error": "Workspace not found"}), 404

    sessions = _collect_workspace_sessions(ws_id)
    session_artifacts = _collect_session_artifacts(sessions)
    prompt = _build_union_prompt(ws, ws_id, sessions, session_artifacts)
    return jsonify({"prompt": prompt, "session_count": len(sessions), "workspace": ws["name"]})


def _collect_workspace_sessions(ws_id):
    """Gather all active (non-archived) sessions assigned to a workspace."""
    sessions = []
    with _bg_lock:
        for provider in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
            pkey = provider.replace("_sessions", "")
            for s in (_bg_cache.get(provider) or []):
                if s.get("workspace") == ws_id and not s.get("archived"):
                    session = dict(s)
                    session["provider"] = pkey
                    sessions.append(session)
    sessions.sort(key=lambda s: str(s.get("updated_at") or s.get("created_at") or ""), reverse=True)
    return sessions


def _collect_session_artifacts(sessions):
    """Walk session directories and collect plans, files, research, checkpoints."""
    session_artifacts = {}
    for s in sessions:
        sid = s["id"]
        pname = s["provider"]
        if pname == "copilot":
            sp = os.path.join(SESSION_DIR, sid)
        elif pname == "claude":
            sp = os.path.join(CLAUDE_DIR, sid)
        elif pname == "hermes":
            sp = os.path.join(HERMES_SESSIONS_DIR, sid)
        else:
            continue
        sp = os.path.realpath(sp)
        if not os.path.isdir(sp):
            continue
        artifacts = list_session_tree(sp)
        host_sp = container_to_host_path(sp)
        file_list = []
        if artifacts.get("plan"):
            file_list.append({"name": "plan.md", "path": os.path.join(host_sp, "plan.md"), "category": "plan"})
        for fi in artifacts.get("files", []):
            file_list.append({"name": fi["name"], "path": os.path.join(host_sp, fi["path"]), "category": "file"})
        for r in artifacts.get("research", []):
            file_list.append({"name": r["name"], "path": os.path.join(host_sp, r["path"]), "category": "research"})
        for cp in artifacts.get("checkpoints", []):
            file_list.append({"name": cp["name"], "path": os.path.join(host_sp, cp["path"]), "category": "checkpoint"})
        session_artifacts[sid] = {"host_path": host_sp, "files": file_list}
    return session_artifacts


def _format_session_detail(s, index, session_artifacts):
    """Format a single session's detail block for the union prompt."""
    sid = s["id"]
    provider_label = s["provider"].upper()
    summary = s.get("nickname") or s.get("summary") or "No summary"
    arts = session_artifacts.get(sid, {})
    host_path = arts.get("host_path", "")
    files = arts.get("files", [])

    lines = []
    lines.append(f"### Session {index}: {summary}")
    lines.append(f"- **Provider:** {provider_label}")
    lines.append(f"- **Session ID:** `{sid}`")
    if host_path:
        lines.append(f"- **Session Path:** `{host_path}`")
    if s.get("project"):
        lines.append(f"- **Project:** {s['project']}")
    if s.get("cwd") or s.get("git_root"):
        lines.append(f"- **Working Directory:** `{s.get('cwd') or s.get('git_root')}`")
    if s.get("branch"):
        lines.append(f"- **Branch:** {s['branch']}")
    if s.get("status"):
        lines.append(f"- **Status:** {s['status']}")
    if s.get("last_intent"):
        lines.append(f"- **Last Intent:** {s['last_intent']}")
    if s.get("created_at"):
        lines.append(f"- **Started:** {s['created_at']}")
    if s.get("updated_at"):
        lines.append(f"- **Last Activity:** {s['updated_at']}")
    models = s.get("models") or []
    if models:
        lines.append(f"- **Models:** {', '.join(models)}")
    mrs = s.get("mrs") or []
    for mr in mrs:
        mr_line = f"- **MR:** {mr.get('url', 'N/A')} (status: {mr.get('status', '?')})"
        if mr.get("jira"):
            mr_line += f" — JIRA: {mr['jira']}"
        lines.append(mr_line)
    if files:
        lines.append("")
        lines.append("**📂 Session artifacts (read these for context):**")
        for f in files:
            icon = {"plan": "📝", "file": "📄", "research": "🔬", "checkpoint": "🔖"}.get(f["category"], "📄")
            lines.append(f"  - {icon} `{f['path']}`")
    notes = s.get("notes") or []
    if notes:
        lines.append("")
        lines.append("**📌 Session notes:**")
        for note in notes[-5:]:
            lines.append(f"  - {note.get('text', '')}")
    user_msgs = s.get("user_messages") or []
    if user_msgs:
        lines.append("")
        lines.append("**💬 Recent user messages (for intent context):**")
        for msg in user_msgs[-3:]:
            content = (msg.get("content") or "")[:300]
            lines.append(f"  - {content}")
    stats = []
    if s.get("message_count"):
        stats.append(f"{s['message_count']} messages")
    if s.get("turn_count"):
        stats.append(f"{s['turn_count']} turns")
    if s.get("event_count"):
        stats.append(f"{s['event_count']} events")
    if stats:
        lines.append(f"- **Stats:** {', '.join(stats)}")
    lines.append("")
    return lines


def _build_union_prompt(ws, ws_id, sessions, session_artifacts):
    """Assemble the full union-session markdown prompt."""
    lines = []
    lines.append(f"# UNION SESSION — Workspace: {ws['name']}")
    lines.append("")
    if ws.get("description"):
        lines.append(f"> {ws['description']}")
        lines.append("")
    lines.append("## Instructions")
    lines.append("")
    lines.append("You are **creating a union session** — an umbrella session that consolidates context")
    lines.append(f"from {len(sessions)} existing coding sessions in the **{ws['name']}** workspace.")
    lines.append("These sessions contain prior work, decisions, code changes, and documentation.")
    lines.append("Your role is to unify this knowledge and drive the next phase of work.")
    lines.append("")
    lines.append("**Your job (execute in order):**")
    lines.append("1. **AUTO-SETUP** — Immediately assign this session to the workspace and add a bridge note (see Auto-Setup section)")
    lines.append("2. Read and understand the session artifacts listed below (plans, files, research)")
    lines.append("3. **BUILD THE KNOWLEDGE GRAPH** (see dedicated section below) — this is a first-class entity, mandatory before any work")
    lines.append("4. Use this accumulated context when working on new tasks")
    lines.append("5. Do NOT re-do work that prior sessions already completed")
    lines.append("6. Reference prior session findings when making decisions")
    lines.append("7. **ALWAYS consult the knowledge graph** before starting any task — update it as work progresses")
    lines.append("")
    lines.append("**Use MCP tools extensively:**")
    lines.append("- **savant-context** (`code_search`, `memory_bank_search`, `memory_resources_read`, `repos_list`)")
    lines.append("  — Search across iCapital codebases and memory bank docs for implementations, architecture, flows.")
    lines.append("  — Always prefer semantic search over guessing about code in external repos.")
    lines.append("- **savant-abilities** (`resolve_abilities` with personas like `engineer`, `architect`, `reviewer`, `support`)")
    lines.append("  — Adopt the right persona for the task at hand (e.g., reviewer for code review, architect for design).")
    lines.append("  — Use `list_personas`, `list_rules`, `list_policies` to discover available capabilities.")
    lines.append("- **savant-workspace** (`list_session_notes`, `create_session_note`, `list_tasks`, `create_task`)")
    lines.append("  — Read and write session notes, manage tasks — all from the terminal.")
    lines.append("- Use these tools proactively — don't wait to be asked. Search for related code, existing patterns,")
    lines.append("  and architectural context before making changes or recommendations.")
    lines.append("")
    lines.append("**Auto-Setup (do this FIRST, before reading anything):**")
    lines.append("1. Call `savant-workspace-assign_session_to_workspace` with the workspace ID to auto-assign this session")
    lines.append(f"   - Workspace: **{ws['name']}** (ID: `{ws_id}`)")
    lines.append("2. Call `savant-workspace-create_session_note` with a note like:")
    lines.append(f'   - `"🔗 UNION/BRIDGE SESSION — Consolidates {len(sessions)} sessions from {ws["name"]} workspace. Knowledge graph in files/knowledge-graph.md."`')
    lines.append("3. Then proceed with reading session artifacts and building the knowledge graph")
    lines.append("")
    lines.append("**Reading checkpoints:** Each session may have `checkpoints/` with numbered checkpoint files")
    lines.append("(e.g., `001-*.md`, `002-*.md`). These are snapshots of progress. Read `checkpoints/index.md`")
    lines.append("first for a summary, then dive into individual checkpoints for detailed history.")
    lines.append("")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## ⚠️ MANDATORY FIRST STEP: Build the Knowledge Graph")
    lines.append("")
    lines.append("> **THE KNOWLEDGE GRAPH IS A FIRST-CLASS ENTITY IN BRIDGE SESSIONS.**")
    lines.append("> It is NOT optional documentation — it is the core artifact that drives all subsequent work.")
    lines.append("> You MUST build it BEFORE doing any other work. You MUST consult it BEFORE every task.")
    lines.append("> You MUST update it as you make new discoveries, decisions, and changes.")
    lines.append("> The entire value of this bridge session depends on a living, accurate knowledge graph.")
    lines.append("")
    lines.append("### What to do")
    lines.append("")
    lines.append("Read through **every session's** checkpoints, plans, files, and conversation history")
    lines.append("to understand the full timeline of decisions, changes, and discoveries. Then:")
    lines.append("")
    lines.append("1. **Create a knowledge graph** that maps ALL relationships between:")
    lines.append("   - **Sessions → Files:** Which files each session created, modified, or deleted")
    lines.append("   - **Sessions → Features:** What features, fixes, or capabilities each session delivered")
    lines.append("   - **Code Entities → Connections:** Functions, classes, endpoints and how they relate")
    lines.append("   - **Decisions → Rationale:** What was decided, why, and which session made the call")
    lines.append("   - **Dependencies → Order:** Which sessions built on work from other sessions")
    lines.append("   - **Open Items → Status:** Unfinished work, known issues, TODOs carried forward")
    lines.append("   - **Bugs Found → Resolution:** Issues discovered and whether they were fixed")
    lines.append("")
    lines.append("2. **Save the knowledge graph** to `files/knowledge-graph.md` in your session directory.")
    lines.append("   Structure it with these sections:")
    lines.append("   - **Timeline** — Chronological list of sessions and what happened in each")
    lines.append("   - **Entities** — All code entities, files, services, and concepts involved")
    lines.append("   - **Relationships** — How entities connect (calls, imports, depends-on, modifies)")
    lines.append("   - **Decisions Log** — Key decisions with context and rationale")
    lines.append("   - **Open Items** — Anything unfinished, blocked, or needing attention")
    lines.append("")
    lines.append("3. **Include a Mermaid visualization** in the knowledge graph file:")
    lines.append("   ```mermaid")
    lines.append("   graph LR")
    lines.append("     S1[Session 1: Feature X] -->|modified| F1[file-a.py]")
    lines.append("     S1 -->|decided| D1[Use JWT auth]")
    lines.append("     S2[Session 2: Bug fix] -->|fixed| F1")
    lines.append("     S2 -->|depends on| S1")
    lines.append("     S3[Session 3: Refactor] -->|moved| F1 --> F2[file-b.py]")
    lines.append("   ```")
    lines.append("")
    lines.append("4. **Keep the knowledge graph updated** as you work — add new findings, decisions,")
    lines.append("   and file changes. This is a living document, not a one-time artifact.")
    lines.append("")
    lines.append("5. **Save all your own work artifacts** to `files/` as well — any analysis, summaries,")
    lines.append("   diagrams, or reference material you produce.")
    lines.append("")
    lines.append("6. **ALWAYS reference the knowledge graph before starting any task:**")
    lines.append("   - Check **Open Items** for unfinished work related to what you're about to do")
    lines.append("   - Check **Decisions Log** so you don't revisit already-settled questions")
    lines.append("   - Check **Entities** and **Relationships** to understand what code is involved")
    lines.append("   - After completing work, update the graph with new entities, decisions, and status changes")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append(f"## Existing Sessions ({len(sessions)})")
    lines.append("")
    for i, s in enumerate(sessions, 1):
        lines.extend(_format_session_detail(s, i, session_artifacts))

    # Quick-start section
    lines.append("---")
    lines.append("")
    lines.append("## Quick Start")
    lines.append("")
    lines.append("**Step 0 — Auto-Setup (do IMMEDIATELY):**")
    lines.append(f"1. Assign this session to workspace `{ws_id}` using `savant-workspace-assign_session_to_workspace`")
    lines.append("2. Add a bridge session note using `savant-workspace-create_session_note`")
    lines.append("")
    lines.append("**Step 1 — Read session context:**")
    lines.append("1. Read the `plan.md` files — they contain task lists, progress, and architectural decisions")
    lines.append("2. Read `checkpoints/index.md` for each session — this gives you the full timeline of work")
    lines.append("3. Scan `files/` for persistent artifacts and `research/` for investigation notes")
    lines.append("")
    lines.append("**Step 2 — Build the knowledge graph:**")
    lines.append("1. Build the knowledge graph from all of the above")
    lines.append("2. Save it to `files/knowledge-graph.md` in your session directory")
    lines.append("3. Display the Mermaid knowledge graph visual to the user")
    lines.append("")
    lines.append("**Step 3 — Before EVERY task:**")
    lines.append("1. Re-read `files/knowledge-graph.md` to check open items, decisions, and related entities")
    lines.append("2. After completing the task, update the knowledge graph with changes")
    lines.append("")

    plan_paths = [f["path"] for arts in session_artifacts.values() for f in arts.get("files", []) if f["category"] == "plan"]
    if not plan_paths:
        plan_paths = [os.path.join(arts["host_path"], "plan.md") for arts in session_artifacts.values() if os.path.isfile(os.path.join(arts["host_path"], "plan.md"))] if session_artifacts else []

    if plan_paths:
        lines.append("**Read these plan files first:**")
        lines.append("```")
        for p in plan_paths:
            lines.append(f"cat \"{p}\"")
        lines.append("```")
        lines.append("")

    cp_index_paths = []
    for arts in session_artifacts.values():
        idx_path = os.path.join(arts["host_path"], "checkpoints", "index.md")
        if any(f["name"] == "index.md" and "checkpoint" in f.get("path", "") for f in arts.get("files", [])):
            cp_index_paths.append(idx_path)
        elif os.path.isfile(idx_path.replace(container_to_host_path("/"), "/")):
            cp_index_paths.append(idx_path)

    if cp_index_paths:
        lines.append("**Then read checkpoint indexes for full history:**")
        lines.append("```")
        for p in cp_index_paths:
            lines.append(f"cat \"{p}\"")
        lines.append("```")
        lines.append("")

    lines.append("Once auto-setup is done, build the knowledge graph, save it to `files/knowledge-graph.md`,")
    lines.append("display the Mermaid visualization, then ask the user what they'd like to work on next.")

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# ── Preferences Endpoints ────────────────────────────────────────────────────

@app.route("/api/preferences", methods=["GET"])
def api_preferences_get():
    """Return current preferences merged with defaults."""
    defaults = _default_preferences()
    prefs = _read_preferences()
    merged = {**defaults, **prefs}
    
    # Migration: Ensure gemini is in enabled_providers if not explicitly disabled
    if "enabled_providers" in merged:
        if "gemini" not in merged["enabled_providers"]:
            # If they have the old default list, add gemini
            old_defaults = ["copilot", "claude", "codex"]
            if all(p in merged["enabled_providers"] for p in old_defaults):
                merged["enabled_providers"].append("gemini")
                
    return jsonify(merged)


@app.route("/api/preferences", methods=["POST"])
def api_preferences_save():
    """Save preferences and return the merged result."""
    data = request.get_json(force=True)
    prefs = _read_preferences()
    for key in ("name", "work_week", "enabled_providers", "theme", "terminal"):
        if key in data:
            prefs[key] = data[key]
    _write_preferences(prefs)
    defaults = _default_preferences()
    merged = {**defaults, **prefs}
    return jsonify(merged)


# ── MCP Setup for AI Agents ───────────────────────────────────────────────────

def _get_savant_mcp_entries():
    """Return the 4 Savant MCP server entries with current ports."""
    ports = _get_mcp_ports()
    return {
        f"savant-{name}": {"url": f"http://127.0.0.1:{port}/sse"}
        for name, port in ports.items()
    }


# Stdio MCP servers to configure alongside Savant SSE servers.
# command values use the binary name; the setup function resolves full paths.
_STDIO_MCP_SERVERS = {
    "gitlab": {"command": "gitlab-mcp", "args": []},
    "atlassian": {"command": "mcp-atlassian", "args": []},
}

# Map provider names to their config file paths and formats
_AGENT_CONFIG_MAP = {
    "copilot": {
        "config_path": os.path.join(os.path.expanduser("~"), ".copilot", "mcp-config.json"),
        "format": "json",
        "key": "mcpServers",
        "entry_extras": {"type": "sse", "tools": ["*"], "headers": {}},
        "label": "Copilot CLI",
    },
    "claude": {
        "config_path": os.path.join(
            os.path.expanduser("~"), "Library", "Application Support",
            "Claude", "claude_desktop_config.json"
        ),
        "format": "json",
        "key": "mcpServers",
        "entry_extras": {"type": "sse", "tools": ["*"]},
        "label": "Claude Desktop",
    },
    "gemini": {
        "config_path": os.path.join(os.path.expanduser("~"), ".gemini", "settings.json"),
        "format": "json",
        "key": "mcpServers",
        "entry_extras": {"type": "sse", "trust": True},
        "label": "Gemini CLI",
    },
    "codex": {
        "config_path": os.path.join(os.path.expanduser("~"), ".codex", "config.toml"),
        "format": "toml",
        "label": "Codex CLI",
    },
    "hermes": {
        "config_path": os.path.join(os.path.expanduser("~"), ".hermes", "config.yaml"),
        "format": "yaml",
        "key": "mcp_servers",
        "label": "Hermes Agent",
    },
}


def _check_mcp_configured(provider):
    """Check if Savant MCP servers are already configured for a provider.
    Returns (is_configured: bool, config_exists: bool)."""
    cfg = _AGENT_CONFIG_MAP.get(provider)
    if not cfg:
        return False, False
    config_path = cfg["config_path"]
    if not os.path.exists(config_path):
        return False, False

    # All server names that should be present
    required = [f"savant-{n}" for n in _get_mcp_ports()]
    for name, sdef in _STDIO_MCP_SERVERS.items():
        if shutil.which(sdef["command"]):
            required.append(name)

    try:
        fmt = cfg["format"]
        if fmt == "json":
            with open(config_path, "r") as f:
                data = json.load(f)
            servers = data.get(cfg["key"], {})
            return all(n in servers for n in required), True
        elif fmt == "yaml":
            with open(config_path, "r") as f:
                raw = f.read()
            return all(n in raw for n in required), True
        elif fmt == "toml":
            with open(config_path, "r") as f:
                raw = f.read()
            return all(n in raw for n in required), True
    except Exception:
        pass
    return False, True


def _setup_mcp_for_provider(provider):
    """Configure Savant MCP servers for a single AI agent provider.
    Returns dict with status: 'configured', 'already_configured', 'skipped', or 'error'."""
    cfg = _AGENT_CONFIG_MAP.get(provider)
    if not cfg:
        return {"provider": provider, "status": "skipped", "reason": "unknown provider"}

    config_path = cfg["config_path"]
    if not os.path.exists(config_path):
        return {"provider": provider, "status": "skipped", "reason": "config file not found",
                "path": config_path, "label": cfg["label"]}

    is_configured, _ = _check_mcp_configured(provider)
    if is_configured:
        result = {"provider": provider, "status": "already_configured",
                  "label": cfg["label"], "path": config_path}
        # Even if MCP config is already set, Hermes may still need SSE patches
        if provider == "hermes":
            sse_check = _check_hermes_sse_support()
            if not sse_check.get("mcp_tool_sse") or not sse_check.get("mcp_config_sse"):
                sse_result = _patch_hermes_sse_support()
                result["sse_patch"] = sse_result
            else:
                result["sse_patch"] = {"all_good": True, "patches_applied": [], "errors": []}
            result["skill_install"] = _install_hermes_savant_skills()
        _write_agent_soul(provider)
        return result

    try:
        entries = _get_savant_mcp_entries()
        fmt = cfg["format"]

        if fmt == "json":
            with open(config_path, "r") as f:
                data = json.load(f)
            servers = data.get(cfg["key"], {})
            extras = cfg.get("entry_extras", {})
            for name, entry in entries.items():
                if name not in servers:
                    servers[name] = {**entry, **extras}
            # Add stdio servers (gitlab, atlassian) if binaries are installed
            for name, sdef in _STDIO_MCP_SERVERS.items():
                if name not in servers:
                    cmd_path = shutil.which(sdef["command"])
                    if cmd_path:
                        servers[name] = {
                            "type": "stdio",
                            "command": sdef["command"],
                            "args": sdef["args"],
                            "tools": ["*"],
                        }
            data[cfg["key"]] = servers
            with open(config_path, "w") as f:
                json.dump(data, f, indent=2)
                f.write("\n")

        elif fmt == "yaml":
            with open(config_path, "r") as f:
                raw = f.read()
            # Use simple YAML append — find mcp_servers key or add it
            yaml_key = cfg["key"]
            ports = _get_mcp_ports()
            if f"{yaml_key}:" not in raw:
                # Add mcp_servers section at end
                raw = raw.rstrip() + f"\n{yaml_key}:\n"
            # Add each missing SSE server entry
            for name, port in ports.items():
                server_name = f"savant-{name}"
                if server_name not in raw:
                    indent = "  "
                    entry = f"{indent}{server_name}:\n{indent}  url: http://127.0.0.1:{port}/sse\n{indent}  timeout: 120\n"
                    idx = raw.find(f"{yaml_key}:")
                    if idx != -1:
                        end_of_line = raw.index("\n", idx) + 1
                        raw = raw[:end_of_line] + entry + raw[end_of_line:]
            # Add each missing stdio server entry
            for name, sdef in _STDIO_MCP_SERVERS.items():
                if name not in raw:
                    cmd_path = shutil.which(sdef["command"])
                    if cmd_path:
                        indent = "  "
                        entry = f"{indent}{name}:\n{indent}  command: {cmd_path}\n{indent}  args: []\n{indent}  timeout: 120\n"
                        idx = raw.find(f"{yaml_key}:")
                        if idx != -1:
                            end_of_line = raw.index("\n", idx) + 1
                            raw = raw[:end_of_line] + entry + raw[end_of_line:]
            with open(config_path, "w") as f:
                f.write(raw)

        elif fmt == "toml":
            with open(config_path, "r") as f:
                raw = f.read()
            # Find python for stdio command
            python_cmd = _find_python_for_mcp()
            savant_dir = os.path.dirname(os.path.abspath(__file__))
            stdio_path = os.path.join(savant_dir, "mcp", "stdio.py")
            updated = raw
            for name in _get_mcp_ports():
                section_header = f'[mcp_servers."savant-{name}"]'
                if section_header in raw:
                    continue
                entry = f'\n{section_header}\ntype = "stdio"\ncommand = "{python_cmd}"\nargs = ["{stdio_path}", "{name}"]\n'
                updated += entry
            if updated != raw:
                with open(config_path, "w") as f:
                    f.write(updated)
            # Add stdio servers (gitlab, atlassian) to TOML
            raw2 = updated
            for name, sdef in _STDIO_MCP_SERVERS.items():
                section_header = f'[mcp_servers."{name}"]'
                if section_header in raw2:
                    continue
                cmd_path = shutil.which(sdef["command"])
                if not cmd_path:
                    continue
                entry = f'\n{section_header}\ntype = "stdio"\ncommand = "{cmd_path}"\nargs = []\n'
                raw2 += entry
            if raw2 != updated:
                with open(config_path, "w") as f:
                    f.write(raw2)

        result = {"provider": provider, "status": "configured",
                  "label": cfg["label"], "path": config_path}

        # For Hermes, also patch SSE transport support into hermes-agent
        if provider == "hermes":
            sse_result = _patch_hermes_sse_support()
            result["sse_patch"] = sse_result
            if sse_result["patches_applied"]:
                logger.info(f"Hermes SSE patches applied: {sse_result['patches_applied']}")
            elif sse_result["all_good"]:
                logger.info("Hermes SSE support already present")
            if sse_result["errors"]:
                logger.warning(f"Hermes SSE patch errors: {sse_result['errors']}")

            # Install/update the Savant skill for Hermes
            result["skill_install"] = _install_hermes_savant_skills()

        _write_agent_soul(provider)
        return result
    except Exception as e:
        logger.error(f"MCP setup failed for {provider}: {e}")
        return {"provider": provider, "status": "error", "error": str(e),
                "label": cfg["label"]}


def _find_python_for_mcp():
    """Find a Python interpreter that has the mcp package installed."""
    import subprocess as _sp
    candidates = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3",
                  "/usr/bin/python3", "python3"]
    for p in candidates:
        try:
            _sp.check_output([p, "-c", "import mcp"], stderr=_sp.DEVNULL, timeout=5)
            return p
        except Exception:
            continue
    return "python3"


# ---------------------------------------------------------------------------
# Hermes SSE support patching
# ---------------------------------------------------------------------------
# When Hermes is enabled, we check if the hermes-agent code supports SSE
# transport (needed for Savant MCP servers). If not, we patch two files:
#   1. tools/mcp_tool.py  — _MCP_SSE_AVAILABLE flag, _is_sse(), _run_sse(), routing
#   2. hermes_cli/mcp_config.py — SSE display label in `hermes mcp test`
# ---------------------------------------------------------------------------

_HERMES_AGENT_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "hermes-agent")
_MCP_TOOL_PATH = os.path.join(_HERMES_AGENT_DIR, "tools", "mcp_tool.py")
_MCP_CONFIG_PATH = os.path.join(_HERMES_AGENT_DIR, "hermes_cli", "mcp_config.py")


def _check_hermes_sse_support():
    """Check if hermes-agent has SSE transport support.
    Returns dict with check results for each file."""
    result = {"mcp_tool_sse": False, "mcp_config_sse": False,
              "mcp_tool_exists": False, "mcp_config_exists": False}

    if os.path.isfile(_MCP_TOOL_PATH):
        result["mcp_tool_exists"] = True
        try:
            with open(_MCP_TOOL_PATH, "r") as f:
                content = f.read()
            # All 4 markers must be present for full SSE support
            result["mcp_tool_sse"] = all(marker in content for marker in [
                "_MCP_SSE_AVAILABLE",
                "def _is_sse(self)",
                "def _run_sse(self",
                "from mcp.client.sse import sse_client",
            ])
        except Exception:
            pass

    if os.path.isfile(_MCP_CONFIG_PATH):
        result["mcp_config_exists"] = True
        try:
            with open(_MCP_CONFIG_PATH, "r") as f:
                content = f.read()
            result["mcp_config_sse"] = 'is_sse' in content and '"SSE"' in content
        except Exception:
            pass

    return result


def _patch_hermes_sse_support():
    """Patch hermes-agent files to add SSE transport support.
    Returns dict with patch results."""
    import shutil as _shutil

    checks = _check_hermes_sse_support()
    patches_applied = []
    errors = []

    # --- Patch 1: mcp_tool.py ---
    if checks["mcp_tool_exists"] and not checks["mcp_tool_sse"]:
        try:
            path = _MCP_TOOL_PATH
            _shutil.copy2(path, path + ".bak")

            with open(path, "r") as f:
                content = f.read()

            modified = False

            # 1a. Add _MCP_SSE_AVAILABLE flag and sse_client import
            if "_MCP_SSE_AVAILABLE" not in content:
                old = "_MCP_HTTP_AVAILABLE = False\n_MCP_SAMPLING_TYPES = False"
                new = "_MCP_HTTP_AVAILABLE = False\n_MCP_SSE_AVAILABLE = False\n_MCP_SAMPLING_TYPES = False"
                if old in content:
                    content = content.replace(old, new)
                    modified = True

                # Add sse_client import block after streamable_http import
                old_import = ("    try:\n"
                              "        from mcp.client.streamable_http import streamablehttp_client\n"
                              "        _MCP_HTTP_AVAILABLE = True\n"
                              "    except ImportError:\n"
                              "        _MCP_HTTP_AVAILABLE = False\n")
                new_import = (old_import +
                              "    try:\n"
                              "        from mcp.client.sse import sse_client\n"
                              "        _MCP_SSE_AVAILABLE = True\n"
                              "    except ImportError:\n"
                              "        _MCP_SSE_AVAILABLE = False\n")
                if old_import in content and "from mcp.client.sse" not in content:
                    content = content.replace(old_import, new_import)
                    modified = True

            # 1b. Add _is_sse() method after _auth_type or _refresh_lock
            if "def _is_sse(self)" not in content:
                # Find _is_http and insert _is_sse before it
                is_http_marker = "    def _is_http(self)"
                if is_http_marker in content:
                    is_sse_method = (
                        '    def _is_sse(self) -> bool:\n'
                        '        """Check if this server uses legacy SSE transport.\n'
                        '\n'
                        '        Detected by explicit ``transport: sse`` in config, or by a URL\n'
                        '        path ending in ``/sse``.\n'
                        '        """\n'
                        '        if not self._config:\n'
                        '            return False\n'
                        '        transport = (self._config.get("transport") or "").lower().strip()\n'
                        '        if transport == "sse":\n'
                        '            return True\n'
                        '        url = self._config.get("url", "")\n'
                        '        if url and url.rstrip("/").endswith("/sse"):\n'
                        '            return True\n'
                        '        return False\n'
                        '\n'
                    )
                    content = content.replace(is_http_marker, is_sse_method + is_http_marker)
                    modified = True

            # 1c. Update _is_http to exclude SSE URLs
            old_is_http = '        return "url" in self._config\n'
            new_is_http = '        return "url" in self._config and not self._is_sse()\n'
            if old_is_http in content and "not self._is_sse()" not in content:
                content = content.replace(old_is_http, new_is_http, 1)
                modified = True

            # 1d. Add _run_sse() method before _discover_tools
            if "def _run_sse(self" not in content:
                discover_marker = "    async def _discover_tools(self):"
                if discover_marker in content:
                    run_sse_method = (
                        '    async def _run_sse(self, config: dict):\n'
                        '        """Run the server using legacy SSE transport.\n'
                        '\n'
                        '        Used for MCP servers that expose a ``GET /sse`` endpoint returning\n'
                        '        an event stream (older MCP protocol, still common in many servers).\n'
                        '        """\n'
                        '        if not _MCP_SSE_AVAILABLE:\n'
                        '            raise ImportError(\n'
                        '                f"MCP server \'{self.name}\' requires SSE transport but "\n'
                        '                "mcp.client.sse is not available. "\n'
                        '                "Upgrade the mcp package to get SSE support."\n'
                        '            )\n'
                        '\n'
                        '        url = config["url"]\n'
                        '        headers = dict(config.get("headers") or {})\n'
                        '        connect_timeout = config.get("connect_timeout", _DEFAULT_CONNECT_TIMEOUT)\n'
                        '\n'
                        '        sampling_kwargs = self._sampling.session_kwargs() if self._sampling else {}\n'
                        '        if _MCP_NOTIFICATION_TYPES and _MCP_MESSAGE_HANDLER_SUPPORTED:\n'
                        '            sampling_kwargs["message_handler"] = self._make_message_handler()\n'
                        '\n'
                        '        sse_kwargs: dict = {\n'
                        '            "timeout": float(connect_timeout),\n'
                        '            "sse_read_timeout": 300.0,\n'
                        '        }\n'
                        '        if headers:\n'
                        '            sse_kwargs["headers"] = headers\n'
                        '\n'
                        '        async with sse_client(url, **sse_kwargs) as (read_stream, write_stream):\n'
                        '            async with ClientSession(read_stream, write_stream, **sampling_kwargs) as session:\n'
                        '                await session.initialize()\n'
                        '                self.session = session\n'
                        '                await self._discover_tools()\n'
                        '                self._ready.set()\n'
                        '                await self._shutdown_event.wait()\n'
                        '\n'
                    )
                    content = content.replace(discover_marker, run_sse_method + discover_marker)
                    modified = True

            # 1e. Update run() routing: SSE -> HTTP -> stdio
            old_routing = "                if self._is_http():"
            new_routing = ("                if self._is_sse():\n"
                          "                    await self._run_sse(config)\n"
                          "                elif self._is_http():")
            if old_routing in content and "self._is_sse()" not in content:
                content = content.replace(old_routing, new_routing, 1)
                modified = True

            if modified:
                with open(path, "w") as f:
                    f.write(content)
                patches_applied.append("mcp_tool.py (SSE transport support)")
                logger.info("Patched hermes mcp_tool.py with SSE support")
            else:
                # All individual checks passed but full check failed — partial state
                patches_applied.append("mcp_tool.py (already partially patched)")

        except Exception as e:
            errors.append(f"mcp_tool.py: {e}")
            logger.error(f"Failed to patch hermes mcp_tool.py: {e}")

    # --- Patch 2: mcp_config.py ---
    if checks["mcp_config_exists"] and not checks["mcp_config_sse"]:
        try:
            path = _MCP_CONFIG_PATH
            _shutil.copy2(path, path + ".bak")

            with open(path, "r") as f:
                content = f.read()

            modified = False

            # Find the transport display block and add SSE detection
            old_display = ('    if "url" in cfg:\n'
                          '        url = cfg["url"]\n'
                          '        _info(f"Transport: HTTP')
            new_display = ('    if "url" in cfg:\n'
                          '        url = cfg["url"]\n'
                          '        is_sse = (cfg.get("transport") or "").lower().strip() == "sse" '
                          'or url.rstrip("/").endswith("/sse")\n'
                          '        transport_label = "SSE" if is_sse else "HTTP"\n'
                          '        _info(f"Transport: {transport_label}')
            if old_display in content:
                content = content.replace(old_display, new_display, 1)
                modified = True

            if modified:
                with open(path, "w") as f:
                    f.write(content)
                patches_applied.append("mcp_config.py (SSE display label)")
                logger.info("Patched hermes mcp_config.py with SSE display label")
        except Exception as e:
            errors.append(f"mcp_config.py: {e}")
            logger.error(f"Failed to patch hermes mcp_config.py: {e}")

    return {
        "patches_applied": patches_applied,
        "errors": errors,
        "checks": checks,
        "all_good": checks.get("mcp_tool_sse", False) and checks.get("mcp_config_sse", False),
    }


# ---------------------------------------------------------------------------
# Hermes Savant skills installation
# ---------------------------------------------------------------------------
# When Hermes is enabled, install/update Savant skills so the agent has
# up-to-date local guidance for platform usage and common workflows.
# Sources live in:
#   - savant/hermes_skill/SKILL.md (platform)
#   - savant/hermes_skills/<skill>/SKILL.md (additional skills)
# and are copied to ~/.hermes/skills/savant/<skill>/SKILL.md.
# ---------------------------------------------------------------------------

_HERMES_SKILL_BASE = os.path.dirname(os.path.abspath(__file__))
_HERMES_SAVANT_SKILLS = {
    # Directory names are non-prefixed; the savant/ category provides the namespace.
    # Hermes resolves these as "savant/platform", "savant/gitlab-mr-review", etc.
    "platform": os.path.join(_HERMES_SKILL_BASE, "hermes_skill", "SKILL.md"),
    "gitlab-mr-review": os.path.join(_HERMES_SKILL_BASE, "hermes_skills", "gitlab-mr-review", "SKILL.md"),
    "session-provider": os.path.join(_HERMES_SKILL_BASE, "hermes_skills", "session-provider", "SKILL.md"),
    "test-runner": os.path.join(_HERMES_SKILL_BASE, "hermes_skills", "test-runner", "SKILL.md"),
}


def _install_hermes_savant_skills():
    """Install or update Savant skills into ~/.hermes/skills/savant.
    Returns dict with per-skill installation results."""
    import shutil as _shutil

    base_dst = os.path.join(os.path.expanduser("~"), ".hermes", "skills", "savant")
    per_skill = {}
    installed_count = 0
    current_count = 0
    error_count = 0

    for skill_name, src_path in _HERMES_SAVANT_SKILLS.items():
        dst_dir = os.path.join(base_dst, skill_name)
        dst_path = os.path.join(dst_dir, "SKILL.md")

        if not os.path.isfile(src_path):
            per_skill[skill_name] = {
                "installed": False,
                "status": "missing_source",
                "source": src_path,
                "path": dst_path,
            }
            error_count += 1
            continue

        # Check if already up-to-date (compare contents)
        if os.path.isfile(dst_path):
            try:
                with open(src_path, "r") as f:
                    src_content = f.read()
                with open(dst_path, "r") as f:
                    dst_content = f.read()
                if src_content == dst_content:
                    per_skill[skill_name] = {
                        "installed": True,
                        "status": "already_current",
                        "source": src_path,
                        "path": dst_path,
                    }
                    current_count += 1
                    continue
            except Exception:
                pass  # Fall through to copy

        try:
            os.makedirs(dst_dir, exist_ok=True)
            _shutil.copy2(src_path, dst_path)
            logger.info(f"Installed Savant skill '{skill_name}' to {dst_path}")
            per_skill[skill_name] = {
                "installed": True,
                "status": "installed",
                "source": src_path,
                "path": dst_path,
            }
            installed_count += 1
        except Exception as e:
            logger.error(f"Failed to install Savant skill '{skill_name}': {e}")
            per_skill[skill_name] = {
                "installed": False,
                "status": "error",
                "error": str(e),
                "source": src_path,
                "path": dst_path,
            }
            error_count += 1

    # Ensure the Hermes soul is also updated/created
    _write_agent_soul("hermes")

    total = len(_HERMES_SAVANT_SKILLS)
    overall_status = "error" if error_count == total else (
        "partial" if error_count > 0 else (
            "already_current" if current_count == total else "installed"
        )
    )

    return {
        "installed": error_count < total,
        "status": overall_status,
        "summary": {
            "total": total,
            "installed": installed_count,
            "already_current": current_count,
            "errors": error_count,
        },
        "skills": per_skill,
    }


def _generate_agent_soul(provider):
    """Generate the 'soul.md' content for a specific AI agent."""
    label = _AGENT_CONFIG_MAP.get(provider, {}).get("label", provider.capitalize())
    # Session-id file paths differ per provider
    # Hermes: .hermes/{session-id}/files/
    # Copilot: .copilot/{session-id}/files/
    # etc.
    session_files_dir = f".{provider}/{{session-id}}/files/"

    # Identify the correct agent directory for "get session id from file system" instruction
    if provider == "hermes":
        meta_info = "Find current session ID from ~/.hermes/.savant-meta/"
    elif provider == "copilot":
        meta_info = "Find current session ID from ~/.copilot/session-state/"
    elif provider == "claude":
        meta_info = "Find current session ID from ~/.claude/"
    elif provider == "gemini":
        meta_info = "Find current session ID from ~/.gemini/"
    elif provider == "codex":
        meta_info = "Find current session ID from ~/.codex/.savant-meta/"
    else:
        meta_info = f"Find current session ID from ~/.{provider}/"

    soul_content = f"""# `soul.md` - {label} Persona & SOP

## 1. Identity & Mission
You are an orchestrator and autonomous engineer specializing in cross-project execution within the **Savant Ecosystem**. Your mission is to maintain perfect continuity across diverse projects by leveraging the Savant tool suite. You treat the codebase not just as files, but as a living knowledge graph and a series of managed tasks.

## 2. The Savant Stack (Mandatory Tool Protocol)
You must **never** access the Savant SQLite database (`savant.db`) directly. All interactions with the ecosystem must flow through the Model Context Protocol (MCP) servers:

*   **`savant-mcp-workspace`**: Your primary interface for state. Use this to identify your current workspace, manage the task lifecycle, and record session notes.
*   **`savant-context`**: Your RAG (Retrieval-Augmented Generation) engine. Use `code_search` for implementation details and `memory_bank_search` for architectural intent and project history.
*   **`savant-knowledge`**: Your long-term memory. Search the knowledge graph to understand business domains and stack dependencies. You are responsible for **maintaining** this graph by storing new insights as "staged" nodes and committing them upon task completion.
*   **`savant-abilities`**: Your behavioral configuration. Before starting any significant task, you **must** call `resolve_abilities` to fetch the specific persona, rules, and style guides relevant to the current project/repo.

## 3. Standard Operating Procedures (SOP)

### Phase 1: Context Initialization
1.  **Detect Session**: {meta_info}
2.  **Identify Workspace**: Call `get_current_workspace()` to orient yourself.
3.  **Resolve Abilities**: Use `resolve_abilities()` with the current `repo_id` to align with local engineering standards.

### Phase 2: Execution & Record Keeping
*   **Notes**: Every meaningful decision, architectural pivot, or discovered blocker must be recorded using `create_session_note`.
*   **Task Management**:
    *   Break complex Directives into discrete tasks using `create_task`.
    *   For interdependent work, use `add_task_dependency` to link tasks.
    *   Keep task statuses (`todo`, `in-progress`, `done`) updated in real-time.
*   **Documentation & Files**:
    *   Create "Session Files" for deep-dive explanations, complex logic maps, or temporary scratchpads.
    *   **Storage Path**: All session files must be stored in: `{session_files_dir}`

### Phase 3: Knowledge Synthesis
*   As you learn about a new service, library, or domain logic, use `savant-knowledge:store()` to create a staged node.
*   Before closing a session, call `commit_workspace()` to move your staged insights into the permanent knowledge graph.

## 4. Technical Constraints & Directory Structure
*   **Agent Directory**: `~/.{provider}/` is your local state directory.
*   **Permissions**: You have full authority to create directories and files within your state directory, but you must respect `.gitignore` for the rest of the project.
*   **Integrity**: Ensure every `create_task` call has a descriptive title and is linked to the correct `workspace_id`.

## 5. Tone & Professionalism
*   **Seniority**: You communicate with high signal-to-noise. Your notes are technical, precise, and devoid of fluff.
*   **Proactivity**: If you detect a missing dependency in a task, link it. If you discover a "gotcha" in the code, add it to the Knowledge Graph immediately.
*   **Accountability**: Your session notes are the "black box" of the development process—ensure they are thorough enough for another agent or human to resume your work without friction.
"""
    return soul_content


def _write_agent_soul(provider):
    """Write the 'soul.md' to the agent's directory."""
    soul_content = _generate_agent_soul(provider)

    # Determine target directory
    if provider == "hermes":
        target_dir = HERMES_DIR
    elif provider == "claude":
        target_dir = CLAUDE_DIR
    elif provider == "gemini":
        target_dir = GEMINI_DIR
    elif provider == "codex":
        target_dir = CODEX_DIR
    elif provider == "copilot":
        target_dir = os.path.dirname(SESSION_DIR)
    else:
        target_dir = os.path.expanduser(f"~/.{provider}")

    os.makedirs(target_dir, exist_ok=True)
    soul_path = os.path.join(target_dir, "soul.md")

    # Check if already present and "somewhat similar"
    if os.path.isfile(soul_path):
        try:
            with open(soul_path, "r") as f:
                existing_content = f.read()
            # If it already looks like a Savant soul file, don't overwrite it
            # this allows users to customize their soul.md without us stomping on it
            if "Savant Ecosystem" in existing_content and "# `soul.md`" in existing_content:
                logger.info(f"Skipping soul.md update for {provider}: file exists and is similar")
                return soul_path
        except Exception as e:
            logger.warning(f"Error checking existing soul.md for {provider}: {e}")

    try:
        with open(soul_path, "w") as f:
            f.write(soul_content)
        logger.info(f"Updated soul.md for {provider} at {soul_path}")
        return soul_path
    except Exception as e:
        logger.error(f"Failed to write soul.md for {provider}: {e}")
        return None


@app.route("/api/setup-mcp", methods=["POST"])
def api_setup_mcp():
    """Configure Savant MCP servers for specified AI agent providers.

    Body: {"providers": ["copilot", "claude", ...]}
    If providers is omitted, uses enabled_providers from preferences.
    Set "force": true to reconfigure even if already set up.
    """
    data = request.get_json(force=True) if request.data else {}
    providers = data.get("providers")
    force = data.get("force", False)

    if not providers:
        prefs = _read_preferences()
        defaults = _default_preferences()
        providers = prefs.get("enabled_providers", defaults["enabled_providers"])

    results = []
    for provider in providers:
        if force:
            # Force reconfigure — temporarily remove existing entries then re-setup
            cfg = _AGENT_CONFIG_MAP.get(provider)
            if not cfg:
                results.append({"provider": provider, "status": "skipped", "reason": "unknown provider"})
                continue
            if not os.path.exists(cfg["config_path"]):
                results.append({"provider": provider, "status": "skipped",
                                "reason": "config file not found", "path": cfg["config_path"],
                                "label": cfg["label"]})
                continue
        result = _setup_mcp_for_provider(provider)
        results.append(result)

    configured = [r for r in results if r["status"] == "configured"]
    already = [r for r in results if r["status"] == "already_configured"]
    skipped = [r for r in results if r["status"] == "skipped"]
    errors = [r for r in results if r["status"] == "error"]

    return jsonify({
        "results": results,
        "summary": {
            "configured": len(configured),
            "already_configured": len(already),
            "skipped": len(skipped),
            "errors": len(errors),
        }
    })


@app.route("/api/check-mcp", methods=["GET"])
def api_check_mcp():
    """Check MCP configuration status for all known agents."""
    results = {}
    for provider, cfg in _AGENT_CONFIG_MAP.items():
        is_configured, config_exists = _check_mcp_configured(provider)
        results[provider] = {
            "label": cfg["label"],
            "config_exists": config_exists,
            "savant_configured": is_configured,
            "path": cfg["config_path"],
        }
    return jsonify(results)


# ── System Info Registry ─────────────────────────────────────────────────────
# MCP port map — defaults match Electron's DEFAULT_*_MCP_PORT constants.
# Electron calls POST /api/system/ports after resolving available ports.
_system_ports = {
    "workspace":  int(os.environ.get("SAVANT_MCP_PORT", "8091")),
    "abilities":  int(os.environ.get("SAVANT_ABILITIES_MCP_PORT", "8092")),
    "context":    int(os.environ.get("SAVANT_CONTEXT_MCP_PORT", "8093")),
    "knowledge":  int(os.environ.get("SAVANT_KNOWLEDGE_MCP_PORT", "8094")),
}


def _get_mcp_ports():
    """Return current MCP port mapping."""
    return dict(_system_ports)


@app.route("/api/system/ports", methods=["POST"])
def api_system_ports_update():
    """Electron pushes resolved MCP ports after startup."""
    data = request.get_json(silent=True) or {}
    updated = []
    for name in _system_ports:
        if name in data:
            _system_ports[name] = int(data[name])
            updated.append(name)
    return jsonify({"updated": updated, "ports": _get_mcp_ports()})


@app.route("/api/system/info", methods=["GET"])
def api_system_info():
    """Return system status: ports, directories, components, health."""
    import sys
    import platform
    import urllib.request
    import urllib.error
    import sqlite3

    flask_port = int(os.environ.get("FLASK_PORT", "8090"))
    savant_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = str(get_server_db_path())

    # Probe each MCP server
    mcp_status = {}
    ports = _get_mcp_ports()
    for name, port in ports.items():
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/sse", method="GET")
            resp = urllib.request.urlopen(req, timeout=2)
            resp.close()
            mcp_status[name] = {"port": port, "status": "ok"}
        except Exception as e:
            mcp_status[name] = {"port": port, "status": "offline", "error": str(e)}

    # DB status
    db_ok = False
    db_size = None
    try:
        client = get_sqlite()
        db_ok = client.health_check()
    except Exception:
        pass
    if os.path.exists(db_path):
        db_size = os.path.getsize(db_path)

    # Loaded blueprints
    blueprints = sorted(app.blueprints.keys())

    # Git / worktree info — prefer build-info.json (baked at build time),
    # fall back to live git commands (works in dev, not in packaged app)
    import subprocess as _sp
    build_info = {}
    build_info_path = os.path.join(savant_dir, "build-info.json")
    if os.path.isfile(build_info_path):
        try:
            import json as _json2
            with open(build_info_path) as f:
                build_info = _json2.load(f)
        except Exception:
            pass

    # Normalize worktree to just the directory name (not full path)
    if build_info.get("worktree"):
        build_info["worktree"] = os.path.basename(build_info["worktree"])

    if not build_info.get("branch") or build_info.get("branch") == "unknown":
        try:
            _git_dir = os.path.dirname(savant_dir)  # repo root (one level up from savant/)
            branch = _sp.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=_git_dir, stderr=_sp.DEVNULL, timeout=3
            ).decode().strip()
            commit = _sp.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=_git_dir, stderr=_sp.DEVNULL, timeout=3
            ).decode().strip()
            # Detect if running from a worktree (git commondir != git-dir)
            git_dir = _sp.check_output(
                ["git", "rev-parse", "--git-dir"],
                cwd=_git_dir, stderr=_sp.DEVNULL, timeout=3
            ).decode().strip()
            common_dir = _sp.check_output(
                ["git", "rev-parse", "--git-common-dir"],
                cwd=_git_dir, stderr=_sp.DEVNULL, timeout=3
            ).decode().strip()
            worktree = os.path.basename(_git_dir) if os.path.realpath(git_dir) != os.path.realpath(common_dir) else None
            build_info = {
                "branch": branch,
                "commit": commit,
                "worktree": worktree,
            }
        except Exception:
            if not build_info:
                build_info = {"branch": "unknown", "commit": "unknown", "worktree": None}

    # Read version from build-info.json first, then package.json
    pkg_version = build_info.get("version", "unknown")
    if pkg_version == "unknown":
        pkg_path = os.path.join(os.path.dirname(savant_dir), "package.json")
        try:
            import json as _json
            with open(pkg_path) as f:
                pkg_version = _json.load(f).get("version", "unknown")
        except Exception:
            pass

    return jsonify({
        "version": pkg_version,
        "build": build_info,
        "flask": {
            "port": flask_port,
            "status": "ok",
            "pid": os.getpid(),
        },
        "mcp_servers": mcp_status,
        "database": {
            "path": db_path,
            "status": "healthy" if db_ok else "unhealthy",
            "size_bytes": db_size,
        },
        "directories": {
            "savant_app": savant_dir,
            "data_dir": str(get_server_data_dir()),
            "abilities_dir": str(get_server_abilities_base_dir()),
        },
        "environment": {
            "python": sys.version.split()[0],
            "platform": f"{platform.system()} {platform.machine()}",
        },
        "blueprints": blueprints,
    })


# SQLITE ENDPOINTS — Workspace, Task, MR, and Jira management
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/health/live", methods=["GET"])
def health_live():
    return jsonify({"status": "ok", "service": "savant-server"}), 200


@app.route("/health/ready", methods=["GET"])
def health_ready():
    client = get_sqlite()
    if client.health_check():
        return jsonify({"status": "ready"}), 200
    return jsonify({"status": "not_ready"}), 503


@app.route("/api/db/health", methods=["GET"])
def api_db_health():
    """Check SQLite health"""
    client = get_sqlite()
    if client.health_check():
        return jsonify({"status": "healthy", "connected": True, "engine": "sqlite"})
    return jsonify({"status": "unhealthy", "connected": False, "engine": "sqlite"}), 503


@app.route("/api/mcp/health/<name>", methods=["GET"])
def api_mcp_health(name):
    """Probe an MCP SSE server to check if it's running."""
    ports = _get_mcp_ports()
    port = ports.get(name)
    if not port:
        return jsonify({"status": "unknown", "error": "Unknown MCP: " + name}), 404
    import urllib.request, urllib.error
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/sse", method="GET")
        resp = urllib.request.urlopen(req, timeout=3)
        resp.close()
        return jsonify({"status": "ok", "name": name, "port": port})
    except urllib.error.URLError as e:
        return jsonify({"status": "offline", "name": name, "port": port, "error": str(e.reason)}), 503
    except Exception as e:
        return jsonify({"status": "offline", "name": name, "port": port, "error": str(e)}), 503


@app.route("/api/mcp/health", methods=["GET"])
def api_mcp_health_all():
    """Check health of all MCP servers for status bar display."""
    ports = _get_mcp_ports()
    results = {}
    
    import urllib.request, urllib.error
    for name, port in ports.items():
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/sse", method="GET")
            resp = urllib.request.urlopen(req, timeout=2)
            resp.close()
            results[name] = True
        except Exception:
            results[name] = False
    
    # Status bar specifically looks for 'workspace' and 'abilities' keys
    return jsonify(results)


# ── Notification Endpoints ───────────────────────────────────────────────────

@app.route("/api/notifications", methods=["GET"])
def api_notifications_list():
    """Get recent notifications with optional filters"""
    try:
        limit = request.args.get("limit", 50, type=int)
        since_id = request.args.get("since", None, type=str)
        unread_only = request.args.get("unread", "false").lower() == "true"
        workspace_id = request.args.get("workspace_id", None, type=str)
        session_id = request.args.get("session_id", None, type=str)
        
        if unread_only:
            notifications = NotificationDB.list_unread(limit=limit)
        elif workspace_id:
            notifications = NotificationDB.list_by_workspace(workspace_id, limit=limit)
        elif session_id:
            notifications = NotificationDB.list_by_session(session_id, limit=limit)
        else:
            notifications = NotificationDB.list_recent(limit=limit, since_id=since_id)
        
        return jsonify(notifications)
    except Exception as e:
        logger.error(f"Error listing notifications: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/notifications/<notification_id>/read", methods=["POST"])
def api_notifications_mark_read(notification_id):
    """Mark a notification as read"""
    try:
        success = NotificationDB.mark_as_read(notification_id)
        if success:
            return jsonify({"notification_id": notification_id, "read": True})
        return jsonify({"error": "Notification not found"}), 404
    except Exception as e:
        logger.error(f"Error marking notification as read: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/notifications/read-all", methods=["POST"])
def api_notifications_mark_all_read():
    """Mark all notifications as read"""
    try:
        count = NotificationDB.mark_all_as_read()
        return jsonify({"marked_read": count})
    except Exception as e:
        logger.error(f"Error marking all notifications as read: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/notifications/unread/count", methods=["GET"])
def api_notifications_unread_count():
    """Get count of unread notifications"""
    try:
        count = NotificationDB.count_unread()
        return jsonify({"count": count})
    except Exception as e:
        logger.error(f"Error counting unread notifications: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/notifications/<notification_id>", methods=["DELETE"])
def api_notifications_delete(notification_id):
    """Delete a notification"""
    try:
        success = NotificationDB.delete(notification_id)
        if success:
            return jsonify({"deleted": notification_id})
        return jsonify({"error": "Notification not found"}), 404
    except Exception as e:
        logger.error(f"Error deleting notification: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/session/<session_id>/workspace", methods=["POST"])
def api_session_workspace_set(session_id):
    """Assign a session to a workspace. Works for copilot sessions."""
    data = request.get_json(force=True)
    ws_id = data.get("workspace_id")  # None to unassign

    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404

    meta = read_session_meta(full)
    meta["workspace"] = ws_id
    write_session_meta(full, meta)

    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['workspace'] = ws_id
                    break
    if ws_id:
        _emit_event("session_assigned", f"Session assigned to workspace", {"session_id": session_id, "workspace_id": ws_id})
    return jsonify({"id": session_id, "workspace": ws_id})


# ── Daily Tasks (SQLite-backed) ─────────────────────────────────────────────

_tasks_lock = threading.RLock()   # still used for ended_days + task-history (file-based)

def _ended_days_path():
    return os.path.join(META_DIR, "ended_days.json")

def _preferences_path():
    return os.path.join(META_DIR, "preferences.json")

def _read_preferences():
    try:
        conn = get_connection()
        row = conn.execute("SELECT value FROM meta WHERE key = 'preferences'").fetchone()
        if row:
            return json.loads(row["value"])
    except Exception:
        pass
    # Fallback: read from JSON file if it exists (pre-migration)
    try:
        with open(_preferences_path(), "r") as f:
            prefs = json.load(f)
            _write_preferences(prefs)
            return prefs
    except Exception:
        return {}

def _write_preferences(prefs):
    try:
        conn = get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("preferences", json.dumps(prefs)),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Error writing preferences: {e}")

def _default_preferences():
    return {
        "name": "",
        "work_week": [1, 2, 3, 4, 5],
        "enabled_providers": ["copilot", "claude", "codex", "gemini"],
        "theme": "dark",
    }

def _next_working_day(from_date_str):
    prefs = _read_preferences()
    defaults = _default_preferences()
    work_week = prefs.get("work_week", defaults["work_week"])
    if not work_week:
        work_week = defaults["work_week"]
    d = datetime.strptime(from_date_str, "%Y-%m-%d")
    ended = set(_read_ended_days())
    for _ in range(90):
        d += timedelta(days=1)
        iso_day = d.isoweekday()
        candidate = d.strftime("%Y-%m-%d")
        if iso_day in work_week and candidate not in ended:
            return candidate
    d = datetime.strptime(from_date_str, "%Y-%m-%d") + timedelta(days=1)
    return d.strftime("%Y-%m-%d")

def _prev_working_day(from_date_str):
    prefs = _read_preferences()
    defaults = _default_preferences()
    work_week = prefs.get("work_week", defaults["work_week"])
    if not work_week:
        work_week = defaults["work_week"]
    d = datetime.strptime(from_date_str, "%Y-%m-%d")
    ended = set(_read_ended_days())
    for _ in range(90):
        d -= timedelta(days=1)
        iso_day = d.isoweekday()
        candidate = d.strftime("%Y-%m-%d")
        if iso_day in work_week and candidate not in ended:
            return candidate
    return None

def _read_ended_days():
    """Read ended days from SQLite meta table, with JSON file fallback for migration."""
    try:
        conn = get_connection()
        row = conn.execute("SELECT value FROM meta WHERE key = 'ended_days'").fetchone()
        if row:
            return json.loads(row["value"])
    except Exception:
        pass
    # Fallback: read from JSON file if it exists (pre-migration)
    try:
        with open(_ended_days_path(), "r") as f:
            days = json.load(f)
            # Migrate to SQLite
            _write_ended_days(days)
            return days
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"[ERROR] ended_days read failed: {e}", flush=True)
        return []

def _write_ended_days(days):
    try:
        conn = get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("ended_days", json.dumps(sorted(set(days)))),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Error writing ended_days: {e}")

def _task_history_path():
    return os.path.join(META_DIR, "task-history.json")

def _read_task_history():
    try:
        conn = get_connection()
        row = conn.execute("SELECT value FROM meta WHERE key = 'task_history'").fetchone()
        if row:
            return json.loads(row["value"])
    except Exception:
        pass
    # Fallback: read from JSON file if it exists (pre-migration)
    try:
        with open(_task_history_path(), "r") as f:
            history = json.load(f)
            _write_task_history(history)
            return history
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"[ERROR] task-history read failed: {e}", flush=True)
        return []

def _write_task_history(history):
    try:
        conn = get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("task_history", json.dumps(history)),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Error writing task_history: {e}")

def _log_task_event(task_id, event_type, detail=None):
    history = _read_task_history()
    history.append({
        "task_id": task_id,
        "event": event_type,
        "detail": detail,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    _write_task_history(history)

# ── Legacy file helpers (kept only for migration) ────────────────────────

def _tasks_dir():
    return os.path.join(META_DIR, "tasks")

def _task_day_path(date_str):
    return os.path.join(_tasks_dir(), f"{date_str}.json")

def _read_tasks_for_day_files(date_str):
    """Read tasks from a legacy per-day JSON file (migration only)."""
    with _tasks_lock:
        path = _task_day_path(date_str)
        try:
            with open(path, "r") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except FileNotFoundError:
            return []

def _list_task_date_files():
    """List dates that have legacy JSON task files."""
    d = _tasks_dir()
    if not os.path.isdir(d):
        return []
    dates = []
    for fn in os.listdir(d):
        if fn.endswith(".json") and not fn.endswith(".tmp"):
            dates.append(fn[:-5])
    return sorted(dates)

# ── Auto-close past days ─────────────────────────────────────────────────

def _auto_close_past_days(today=None):
    """Auto-close past work days: move incomplete tasks forward via SQLite."""
    if not today:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ended = set(_read_ended_days())
    task_dates = [d for d in TaskDB.list_dates() if d < today and d not in ended]
    if not task_dates:
        return
    new_ended = list(ended)
    for from_date in task_dates:
        to_date = _next_working_day(from_date)
        TaskDB.move_incomplete_tasks(from_date, to_date)
        new_ended.append(from_date)
    _write_ended_days(new_ended)

# ── Task API routes (SQLite-backed) ───────────────────────────────────────

def _normalize_task(t):
    if t and "task_id" in t and "id" not in t:
        t["id"] = t["task_id"]
    return t

@app.route("/api/tasks/reorder", methods=["POST"])
def api_tasks_reorder():
    data = request.get_json(force=True)
    order = data.get("order", [])
    date = data.get("date")
    if not order:
        return jsonify({"error": "order required"}), 400
    if not date:
        return jsonify({"error": "date required"}), 400
    TaskDB.reorder(date, order)
    return jsonify({"ok": True})

@app.route("/api/tasks", methods=["GET"])
def api_tasks_list():
    client_today = request.args.get("today")
    _auto_close_past_days(client_today)
    date_filter = request.args.get("date")
    ws_filter = request.args.get("workspace_id")
    if date_filter:
        tasks = TaskDB.list_by_date(date_filter)
        if ws_filter:
            tasks = [t for t in tasks if t.get("workspace_id") == ws_filter]
    elif ws_filter:
        tasks = TaskDB.list_all(workspace_id=ws_filter)
    else:
        tasks = TaskDB.list_all()

    for t in tasks:
        _normalize_task(t)

    return jsonify(tasks)

@app.route("/api/tasks", methods=["POST"])
def api_tasks_create():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title required"}), 400
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    task_date = data.get("date") or today
    ended = _read_ended_days()
    if task_date in ended:
        task_date = _next_working_day(task_date)
    now_iso = datetime.now(timezone.utc).isoformat()
    initial_status = data.get("status", "todo")
    existing = TaskDB.list_by_date(task_date)
    max_order = max((t.get("order", 0) for t in existing), default=-1)
    task = {
        "task_id": _unique_ts_id(),
        "title": title,
        "description": (data.get("description") or "").strip(),
        "status": initial_status,
        "priority": data.get("priority", "medium"),
        "date": task_date,
        "order": max_order + 1,
        "session_id": data.get("session_id"),
        "workspace_id": data.get("workspace_id"),
        "copied_from": data.get("copied_from"),
        "depends_on": data.get("depends_on", []),
        "started_at": now_iso if initial_status == "in-progress" else None,
        "completed_at": now_iso if initial_status == "done" else None,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    task = TaskDB.create(task)
    _log_task_event(task["task_id"], "created", {
        "title": task["title"], "description": task["description"],
        "status": initial_status, "priority": task["priority"],
        "date": task["date"], "session_id": task.get("session_id"),
        "workspace_id": task.get("workspace_id"),
    })
    _emit_event("task_created", f"Task created: {title}", {"task_id": task["task_id"], "workspace_id": task.get("workspace_id")})
    return jsonify(_normalize_task(task))

@app.route("/api/tasks/<task_id>", methods=["PUT"])
def api_tasks_update(task_id):
    data = request.get_json(force=True)
    ended = _read_ended_days()
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    old_date = task.get("date")
    if old_date in ended:
        return jsonify({"error": "Day has been ended. Reopen it first."}), 403
    old_status = task.get("status")
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {}
    for key in ("title", "description", "status", "priority", "date", "session_id", "workspace_id", "order"):
        if key in data:
            updates[key] = data[key]
    new_status = data.get("status")
    if new_status == "in-progress" and not task.get("started_at"):
        updates["started_at"] = now_iso
    if new_status == "done" and not task.get("completed_at"):
        updates["completed_at"] = now_iso
    if new_status and new_status != "done" and old_status == "done":
        updates["completed_at"] = None
    updated = TaskDB.update(task_id, updates)
    if not updated:
        return jsonify({"error": "Task not found"}), 404
    if new_status and new_status != old_status:
        _log_task_event(task_id, "status_change", {"from": old_status, "to": new_status})
        _emit_event("task_updated", f"Task '{updated.get('title','')}' -> {new_status}", {"task_id": task_id, "status": new_status})
    elif data.get("title") or data.get("description"):
        _log_task_event(task_id, "updated", {
            k: data[k] for k in ("title", "description", "priority", "date", "workspace_id", "session_id") if k in data
        })
    return jsonify(_normalize_task(updated))

@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def api_tasks_delete(task_id):
    ended = _read_ended_days()
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    if task.get("date") in ended:
        return jsonify({"error": "Day has been ended. Reopen it first."}), 403
    TaskDB.delete(task_id)
    _log_task_event(task_id, "deleted")
    return jsonify({"deleted": task_id})

# ── Task Dependencies ────────────────────────────────────────────────────

@app.route("/api/tasks/<task_id>/deps", methods=["GET"])
def api_task_deps_list(task_id):
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task.get("depends_on", []))

@app.route("/api/tasks/<task_id>/deps", methods=["POST"])
def api_task_deps_add(task_id):
    data = request.get_json(force=True)
    dep_id = data.get("depends_on")
    if not dep_id:
        return jsonify({"error": "depends_on required"}), 400
    if dep_id == task_id:
        return jsonify({"error": "Task cannot depend on itself"}), 400
    task = TaskDB.get_by_id(task_id)
    dep_task = TaskDB.get_by_id(dep_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    if not dep_task:
        return jsonify({"error": "Dependency task not found"}), 404
    if task.get("workspace_id") != dep_task.get("workspace_id"):
        return jsonify({"error": "Dependencies must be within the same workspace"}), 400
    deps = task.get("depends_on", [])
    if dep_id in deps:
        return jsonify({"error": "Dependency already exists"}), 409
    all_tasks = TaskDB.list_all(workspace_id=task.get("workspace_id"))
    all_map = {(t.get("id") or t.get("task_id")): t for t in all_tasks if (t.get("id") or t.get("task_id"))}
    visited = set()
    stack = [dep_id]
    while stack:
        cur = stack.pop()
        if cur == task_id:
            return jsonify({"error": "Circular dependency detected"}), 400
        if cur in visited:
            continue
        visited.add(cur)
        cur_task = all_map.get(cur)
        if cur_task:
            stack.extend(cur_task.get("depends_on", []))
    TaskDB.add_dependency(task_id, dep_id)
    _log_task_event(task_id, "dep_added", {"depends_on": dep_id})
    updated = TaskDB.get_by_id(task_id)
    return jsonify(updated)

@app.route("/api/tasks/<task_id>/deps/<dep_id>", methods=["DELETE"])
def api_task_deps_remove(task_id, dep_id):
    task = TaskDB.get_by_id(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    deps = task.get("depends_on", [])
    if dep_id not in deps:
        return jsonify({"error": "Dependency not found"}), 404
    TaskDB.remove_dependency(task_id, dep_id)
    _log_task_event(task_id, "dep_removed", {"depends_on": dep_id})
    updated = TaskDB.get_by_id(task_id)
    return jsonify(updated)

@app.route("/api/tasks/graph", methods=["GET"])
def api_tasks_graph():
    ws_id = request.args.get("workspace_id")
    if not ws_id:
        return jsonify({"error": "workspace_id required"}), 400
    ws_tasks = TaskDB.list_all(workspace_id=ws_id)
    ws_ids = {t["task_id"] for t in ws_tasks}
    nodes = []
    for t in ws_tasks:
        nodes.append({
            "id": t["task_id"],
            "title": t.get("title", ""),
            "description": t.get("description", ""),
            "status": t.get("status", "todo"),
            "priority": t.get("priority", "medium"),
            "date": t.get("date", ""),
            "created_at": t.get("created_at", ""),
            "depends_on": [d for d in t.get("depends_on", []) if d in ws_ids],
        })
    edges = []
    for n in nodes:
        for dep in n["depends_on"]:
            edges.append({"from": n["id"], "to": dep})
    return jsonify({"nodes": nodes, "edges": edges})

@app.route("/api/tasks/end-day", methods=["POST"])
def api_tasks_end_day():
    data = request.get_json(force=True)
    from_date = data.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    to_date = _next_working_day(from_date)
    moved = TaskDB.move_incomplete_tasks(from_date, to_date)
    ended = _read_ended_days()
    ended.append(from_date)
    _write_ended_days(ended)
    return jsonify({"moved": moved, "from": from_date, "to": to_date})

@app.route("/api/tasks/unend-day", methods=["POST"])
def api_tasks_unend_day():
    data = request.get_json(force=True)
    day = data.get("date")
    if not day:
        return jsonify({"error": "date required"}), 400
    ended = _read_ended_days()
    ended = [d for d in ended if d != day]
    _write_ended_days(ended)
    return jsonify({"reopened": day})

@app.route("/api/tasks/ended-days", methods=["GET"])
def api_tasks_ended_days():
    client_today = request.args.get("today")
    _auto_close_past_days(client_today)
    return jsonify(_read_ended_days())

@app.route("/api/tasks/adjacent-days", methods=["GET"])
def api_tasks_adjacent_days():
    date = request.args.get("date")
    if not date:
        return jsonify({"error": "date required"}), 400
    prev_day = _prev_working_day(date)
    next_day = _next_working_day(date)
    return jsonify({"prev": prev_day, "next": next_day})

@app.route("/api/tasks/stats", methods=["GET"])
def api_tasks_stats():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    counts = TaskDB.count_by_date_status(today)
    return jsonify({
        "total": sum(counts.values()),
        "todo": counts.get("todo", 0),
        "in_progress": counts.get("in-progress", 0),
        "done": counts.get("done", 0),
        "blocked": counts.get("blocked", 0),
    })

@app.route("/api/tasks/<task_id>/history", methods=["GET"])
def api_task_history(task_id):
    history = _read_task_history()
    return jsonify([e for e in history if e.get("task_id") == task_id])


MCP_CONFIG = os.environ.get(
    "MCP_CONFIG", os.path.expanduser("~/.copilot/mcp-config.json")
)


def mask_secret(val):
    if not val or len(val) < 8:
        return "****"
    return val[:4] + "…" + val[-4:]


@app.route("/api/mcp")
def api_mcp():
    config_path = MCP_CONFIG
    if not os.path.isfile(config_path):
        return jsonify({"servers": [], "error": "MCP config not found"})

    try:
        with open(config_path, "r") as f:
            raw = json.load(f)
    except Exception as e:
        return jsonify({"servers": [], "error": str(e)})

    # Discover actual tools used per MCP server from events
    mcp_prefixes = {name: name + "-" for name in raw.get("mcpServers", {})}
    discovered_tools = {name: set() for name in raw.get("mcpServers", {})}

    for entry in os.listdir(SESSION_DIR):
        events_file = os.path.join(SESSION_DIR, entry, "events.jsonl")
        if not os.path.isfile(events_file):
            continue
        try:
            with open(events_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if '"tool.execution_start"' not in line:
                        continue
                    try:
                        ev = json.loads(line)
                        if ev.get("type") != "tool.execution_start":
                            continue
                        tool_name = ev.get("data", {}).get("toolName", "")
                        for server_name, prefix in mcp_prefixes.items():
                            if tool_name.startswith(prefix):
                                short = tool_name[len(prefix):]
                                discovered_tools[server_name].add(short)
                                break
                    except json.JSONDecodeError:
                        continue
        except Exception:
            continue

    servers = []
    for name, cfg in raw.get("mcpServers", {}).items():
        env = cfg.get("env", {})
        safe_env = {}
        for k, v in env.items():
            if re.search(r"token|key|secret|password|api.key", k, re.IGNORECASE):
                safe_env[k] = mask_secret(v)
            else:
                safe_env[k] = v

        servers.append({
            "name": name,
            "type": cfg.get("type", "unknown"),
            "command": cfg.get("command", ""),
            "args": cfg.get("args", []),
            "tools": sorted(discovered_tools.get(name, set())),
            "tools_config": cfg.get("tools", []),
            "env": safe_env,
        })

    return jsonify({"servers": servers})


def _build_copilot_usage():
    """Build copilot usage data."""
    model_totals = Counter()
    tool_totals = Counter()
    total_turns = 0
    total_messages = 0
    total_tool_calls = 0
    total_events = 0
    sessions_by_day = Counter()
    tools_by_day = Counter()
    messages_by_day = Counter()
    turns_by_day = Counter()
    session_durations = []  # in minutes

    for entry in os.listdir(SESSION_DIR):
        session_path = os.path.join(SESSION_DIR, entry)
        events_file = os.path.join(session_path, "events.jsonl")
        if not os.path.isfile(events_file):
            continue

        first_ts = None
        last_ts = None
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

                    total_events += 1
                    etype = ev.get("type", "")
                    etime = ev.get("timestamp", "")
                    day = etime[:10] if etime else None

                    if first_ts is None and etime:
                        first_ts = etime
                    if etime:
                        last_ts = etime

                    if etype == "session.start" and day:
                        sessions_by_day[day] += 1

                    elif etype == "user.message":
                        total_messages += 1
                        if day:
                            messages_by_day[day] += 1

                    elif etype == "assistant.turn_start":
                        total_turns += 1
                        if day:
                            turns_by_day[day] += 1

                    elif etype == "tool.execution_start":
                        total_tool_calls += 1
                        tool_name = ev.get("data", {}).get("toolName", "unknown")
                        tool_totals[tool_name] += 1
                        if day:
                            tools_by_day[day] += 1

                    elif etype == "tool.execution_complete":
                        model = ev.get("data", {}).get("model", "")
                        if model:
                            model_totals[model] += 1

        except Exception:
            continue

        if first_ts and last_ts:
            t1 = parse_timestamp(first_ts)
            t2 = parse_timestamp(last_ts)
            if t1 and t2:
                dur = (t2 - t1).total_seconds() / 60.0
                session_durations.append(dur)

    # Build sorted day lists (last 14 days)
    all_days = sorted(set(list(sessions_by_day.keys()) + list(tools_by_day.keys()) + list(messages_by_day.keys())))
    daily = []
    for d in all_days[-14:]:
        daily.append({
            "date": d,
            "sessions": sessions_by_day.get(d, 0),
            "messages": messages_by_day.get(d, 0),
            "turns": turns_by_day.get(d, 0),
            "tools": tools_by_day.get(d, 0),
        })

    # Efficiency metrics
    avg_tools_per_turn = round(total_tool_calls / max(total_turns, 1), 1)
    avg_turns_per_msg = round(total_turns / max(total_messages, 1), 1)
    total_hours = round(sum(session_durations) / 60.0, 1)
    avg_session_min = round(sum(session_durations) / max(len(session_durations), 1), 0)

    return {
        "models": [{"name": m, "calls": c} for m, c in model_totals.most_common()],
        "tools": [{"name": t, "calls": c} for t, c in tool_totals.most_common(25)],
        "daily": daily,
        "totals": {
            "sessions": len(os.listdir(SESSION_DIR)),
            "messages": total_messages,
            "turns": total_turns,
            "tool_calls": total_tool_calls,
            "events": total_events,
            "total_hours": total_hours,
            "avg_session_minutes": avg_session_min,
            "avg_tools_per_turn": avg_tools_per_turn,
            "avg_turns_per_message": avg_turns_per_msg,
        },
    }


def _build_codex_usage():
    """Build Codex usage data from session logs."""
    tool_totals = Counter()
    total_messages = 0
    total_turns = 0
    total_tool_calls = 0
    total_events = 0
    session_durations = []

    sessions = codex_get_all_sessions()
    for s in sessions:
        total_messages += s.get("message_count", 0)
        total_turns += s.get("turn_count", 0)
        total_tool_calls += sum((s.get("tool_call_counts") or {}).values())
        total_events += s.get("event_count", 0)
        for name, count in (s.get("tool_call_counts") or {}).items():
            tool_totals[name] += count
        try:
            t1 = datetime.fromisoformat(s.get("created_at")) if s.get("created_at") else None
            t2 = datetime.fromisoformat(s.get("updated_at")) if s.get("updated_at") else None
            if t1 and t2:
                session_durations.append((t2 - t1).total_seconds() / 60)
        except Exception:
            pass

    avg_tools_per_turn = round(total_tool_calls / max(total_turns, 1), 1)
    avg_turns_per_msg = round(total_turns / max(total_messages, 1), 1)
    total_hours = round(sum(session_durations) / 60.0, 1)
    avg_session_min = round(sum(session_durations) / max(len(session_durations), 1), 0)

    return {
        "models": [],
        "tools": [{"name": t, "calls": c} for t, c in tool_totals.most_common(25)],
        "daily": [],
        "totals": {
            "sessions": len(sessions),
            "messages": total_messages,
            "turns": total_turns,
            "tool_calls": total_tool_calls,
            "events": total_events,
            "total_hours": total_hours,
            "avg_session_minutes": avg_session_min,
            "avg_tools_per_turn": avg_tools_per_turn,
            "avg_turns_per_message": avg_turns_per_msg,
        },
    }


@app.route("/api/usage")
def api_usage():
    with _bg_lock:
        data = _bg_cache.get('copilot_usage')
    if data is None:
        return jsonify({"models": [], "tools": [], "daily": [], "totals": {}, "loading": True})
    return jsonify(data)


@app.route("/api/session/<session_id>/convert-prompt")
def api_session_convert_prompt(session_id):
    """Generate a handoff prompt from a Copilot session."""
    full = os.path.join(SESSION_DIR, session_id)
    if not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    info = get_session_info(session_id, full, include_tree=True)
    # Get conversation stats for file lists
    try:
        conv_resp = api_session_conversation(session_id)
        conv_data = conv_resp.get_json() if hasattr(conv_resp, 'get_json') else {}
        conv_stats = conv_data.get("stats", {})
    except Exception:
        conv_stats = {}
    prompt = build_convert_prompt(info, conv_stats, provider="copilot")
    return jsonify({"prompt": prompt, "session_id": session_id, "char_count": len(prompt)})


@app.route("/api/codex/session/<session_id>/convert-prompt")
def api_codex_session_convert_prompt(session_id):
    info = codex_get_session_info(session_id, include_tree=True)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    try:
        conv_resp = api_codex_session_conversation(session_id)
        conv_data = conv_resp.get_json() if hasattr(conv_resp, 'get_json') else {}
        conv_stats = conv_data.get("stats", {})
    except Exception:
        conv_stats = {}
    prompt = build_convert_prompt(info, conv_stats, provider="codex")
    return jsonify({"prompt": prompt, "session_id": session_id, "char_count": len(prompt)})


@app.route("/api/session/<session_id>/conversation")
def api_session_conversation(session_id):
    """Return full parsed conversation for a session."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404

    events_file = os.path.join(full, "events.jsonl")
    if not os.path.isfile(events_file):
        return jsonify({"conversation": [], "stats": {}})

    try:
        conversation, tool_map, stats = _parse_conversation_events(events_file)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    _finalize_conversation_stats(stats)
    return jsonify({"conversation": conversation, "tools": tool_map, "stats": stats})


@app.route("/api/codex/session/<session_id>/conversation")
def api_codex_session_conversation(session_id):
    conversation, tool_map, stats = codex_parse_conversation(session_id)
    if not conversation and not tool_map and not codex_find_session_jsonl(session_id):
        return jsonify({"error": "Session not found"}), 404
    return jsonify({"conversation": conversation, "tools": tool_map, "stats": stats})


def _new_conversation_stats():
    """Create a fresh stats accumulator."""
    return {
        "user_messages": 0, "assistant_messages": 0, "assistant_chars": 0,
        "tool_calls": 0, "tool_successes": 0, "tool_failures": 0,
        "reasoning_count": 0, "files_created": [], "files_edited": [],
    }


def _process_assistant_message(data, ts, stats, tool_map, pending_tool_args):
    """Parse an assistant.message event → conversation entry + side-effects on stats/tool_map."""
    content = data.get("content", "")
    tool_requests = data.get("toolRequests", [])
    reasoning = data.get("reasoningText", "")

    if content.strip():
        stats["assistant_messages"] += 1
        stats["assistant_chars"] += len(content)
    if reasoning:
        stats["reasoning_count"] += 1

    entry = {
        "type": "assistant_message", "timestamp": ts,
        "content": content, "reasoning": reasoning[:2000] if reasoning else "",
        "tool_requests": [],
    }

    for tr in tool_requests:
        tool_name = tr.get("name", "unknown")
        call_id = tr.get("id", "") or ""
        args = tr.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {"raw": args[:500]}
        safe_args = {}
        for k, v in (args if isinstance(args, dict) else {}).items():
            sv = str(v)
            safe_args[k] = sv[:1000] if len(sv) > 1000 else v
        entry["tool_requests"].append({"call_id": call_id, "tool_name": tool_name, "arguments": safe_args})
        if call_id:
            tool_map[call_id] = {"name": tool_name, "args": safe_args, "start_ts": None, "end_ts": None, "result": None, "success": None, "model": None}
        else:
            pending_tool_args.append((tool_name, safe_args))
        # Track file changes
        if tool_name == "create" and isinstance(args, dict):
            path = args.get("path", "")
            if path:
                stats["files_created"].append(path)
        elif tool_name == "edit" and isinstance(args, dict):
            path = args.get("path", "")
            if path and path not in stats["files_edited"]:
                stats["files_edited"].append(path)

    return entry


def _process_tool_execution(etype, data, ts, stats, tool_map, pending_tool_args):
    """Handle tool.execution_start and tool.execution_complete events."""
    call_id = data.get("toolCallId", "")

    if etype == "tool.execution_start":
        stats["tool_calls"] += 1
        tool_name = data.get("toolName", "unknown")
        matched_args = {}
        for pi, (pname, pargs) in enumerate(pending_tool_args):
            if pname == tool_name:
                matched_args = pargs
                pending_tool_args.pop(pi)
                break
        if call_id not in tool_map:
            tool_map[call_id] = {"name": tool_name, "args": matched_args, "start_ts": ts, "end_ts": None, "result": None, "success": None, "model": None}
        else:
            tool_map[call_id]["start_ts"] = ts
            if matched_args and not tool_map[call_id].get("args"):
                tool_map[call_id]["args"] = matched_args
        return {"type": "tool_start", "timestamp": ts, "call_id": call_id, "tool_name": tool_name}

    else:  # tool.execution_complete
        success = data.get("success", False)
        model = data.get("model", "")
        result = data.get("result", {})
        if success:
            stats["tool_successes"] += 1
        else:
            stats["tool_failures"] += 1
        result_content = ""
        if isinstance(result, dict):
            result_content = str(result.get("content", ""))[:3000]
        elif isinstance(result, str):
            result_content = result[:3000]
        if call_id not in tool_map:
            tool_map[call_id] = {"name": data.get("toolName", "unknown"), "args": {}, "start_ts": None, "end_ts": ts, "result": result_content, "success": success, "model": model}
        else:
            tool_map[call_id].update({"end_ts": ts, "result": result_content, "success": success, "model": model})
        return {"type": "tool_complete", "timestamp": ts, "call_id": call_id, "success": success, "model": model, "result": result_content}


def _parse_conversation_events(events_file):
    """Parse events.jsonl → (conversation, tool_map, stats)."""
    conversation = []
    tool_map = {}
    pending_tool_args = []
    stats = _new_conversation_stats()

    with open(events_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue

            etype = ev.get("type", "")
            data = ev.get("data", {})
            ts = ev.get("timestamp", "")

            if etype == "session.start":
                conversation.append({"type": "session_start", "timestamp": ts, "version": data.get("copilotVersion", ""), "context": data.get("context", {})})
            elif etype == "user.message":
                stats["user_messages"] += 1
                conversation.append({"type": "user_message", "timestamp": ts, "content": data.get("content", ""), "attachments": data.get("attachments", [])})
            elif etype == "assistant.message":
                conversation.append(_process_assistant_message(data, ts, stats, tool_map, pending_tool_args))
            elif etype in ("tool.execution_start", "tool.execution_complete"):
                conversation.append(_process_tool_execution(etype, data, ts, stats, tool_map, pending_tool_args))
            elif etype == "assistant.turn_start":
                conversation.append({"type": "turn_start", "timestamp": ts, "turn_id": data.get("turnId", "")})
            elif etype == "assistant.turn_end":
                conversation.append({"type": "turn_end", "timestamp": ts, "turn_id": data.get("turnId", "")})
            elif etype == "abort":
                conversation.append({"type": "abort", "timestamp": ts})

    return conversation, tool_map, stats


def _finalize_conversation_stats(stats):
    """Compute derived stats (averages, rates, truncation)."""
    stats["avg_response_length"] = round(stats["assistant_chars"] / max(stats["assistant_messages"], 1))
    stats["tool_success_rate"] = round(stats["tool_successes"] / max(stats["tool_calls"], 1) * 100, 1)
    stats["files_created"] = stats["files_created"][:50]
    stats["files_edited"] = stats["files_edited"][:50]


@app.route("/api/search")
def api_search():
    """Cross-session full-text search across conversations."""
    query = request.args.get("q", "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"results": [], "error": "Query too short"})

    results = []
    limit = int(request.args.get("limit", 50))

    for entry in os.listdir(SESSION_DIR):
        session_path = os.path.join(SESSION_DIR, entry)
        events_file = os.path.join(session_path, "events.jsonl")
        if not os.path.isfile(events_file):
            continue

        ws = read_workspace(session_path)
        project = ws.get("cwd", "").split("/")[-1] if ws.get("cwd") else ""
        meta = read_session_meta(session_path)
        # Collect both nickname and summary/intent separately
        nickname = meta.get("nickname") or ""
        orig_name = ""
        with _bg_lock:
            for prov in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
                for s in (_bg_cache.get(prov) or []):
                    if s.get("id") == entry:
                        if not nickname:
                            nickname = s.get("nickname") or ""
                        orig_name = s.get("summary") or s.get("last_intent") or ""
                        break
                if nickname or orig_name:
                    break
        if not orig_name:
            orig_name = ws.get("summary", "")

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

                    etype = ev.get("type", "")
                    data = ev.get("data", {})
                    ts = ev.get("timestamp", "")
                    content = ""
                    msg_type = ""

                    if etype == "user.message":
                        content = data.get("content", "")
                        msg_type = "user"
                    elif etype == "assistant.message":
                        content = data.get("content", "")
                        msg_type = "assistant"

                    if content and query in content.lower():
                        # Find match position for snippet
                        idx = content.lower().index(query)
                        start = max(0, idx - 80)
                        end = min(len(content), idx + len(query) + 80)
                        snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")

                        results.append({
                            "session_id": entry,
                            "session_name": nickname or orig_name,
                            "session_nickname": nickname,
                            "session_orig_name": orig_name,
                            "project": project,
                            "branch": ws.get("branch", ""),
                            "timestamp": ts,
                            "type": msg_type,
                            "snippet": snippet,
                            "query_pos": idx,
                        })

                        if len(results) >= limit:
                            break
        except Exception:
            continue

        if len(results) >= limit:
            break

    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    # Search notes in session metadata
    note_results = []
    for entry in os.listdir(SESSION_DIR):
        session_path = os.path.join(SESSION_DIR, entry)
        if not os.path.isdir(session_path):
            continue
        meta = read_session_meta(session_path)
        notes = meta.get("notes", [])
        ws = read_workspace(session_path)
        project = ws.get("cwd", "").split("/")[-1] if ws.get("cwd") else ""
        n_nick = meta.get("nickname") or ""
        n_orig = ""
        with _bg_lock:
            for prov in ("copilot_sessions", "claude_sessions", "codex_sessions", "gemini_sessions", "hermes_sessions"):
                for s in (_bg_cache.get(prov) or []):
                    if s.get("id") == entry:
                        if not n_nick:
                            n_nick = s.get("nickname") or ""
                        n_orig = s.get("summary") or s.get("last_intent") or ""
                        break
                if n_nick or n_orig:
                    break
        if not n_orig:
            n_orig = ws.get("summary", "")
        for note in notes:
            text = note.get("text", "")
            if query in text.lower():
                idx = text.lower().index(query)
                start = max(0, idx - 80)
                end = min(len(text), idx + len(query) + 80)
                snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
                note_results.append({
                    "session_id": entry,
                    "session_name": n_nick or n_orig,
                    "session_nickname": n_nick,
                    "session_orig_name": n_orig,
                    "project": project,
                    "timestamp": note.get("timestamp", ""),
                    "snippet": snippet,
                })
    note_results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"results": results[:limit], "note_results": note_results[:limit], "query": query})


# --- Project Files (metadata only, no external file access) ---


@app.route("/api/session/<session_id>/project-files")
def api_session_project_files(session_id):
    """Extract files created/edited during a session from events."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404

    events_file = os.path.join(full, "events.jsonl")
    if not os.path.exists(events_file):
        return jsonify({"files": [], "cwd": ""})

    # Get session cwd
    cwd = ""
    ws_file = os.path.join(full, "workspace.yaml")
    try:
        with open(ws_file, "r") as f:
            ws = yaml.safe_load(f) or {}
            cwd = ws.get("cwd", "")
    except Exception:
        pass

    files_seen = {}  # path -> {action, count, timestamps}

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

    except Exception:
        pass

    file_list = []
    for fpath, info in files_seen.items():
        info["name"] = os.path.basename(fpath)
        info["relative"] = (
            os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
        )
        file_list.append(info)

    file_list.sort(key=lambda x: x.get("last_seen", ""), reverse=True)
    return jsonify({"files": file_list, "cwd": cwd})


@app.route("/api/session/<session_id>/git-changes")
def api_session_git_changes(session_id):
    """Extract git commands, commits, file changes from session events."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404

    events_file = os.path.join(full, "events.jsonl")
    if not os.path.isfile(events_file):
        return jsonify({"commits": [], "file_changes": [], "git_commands": []})

    # Parse events for git activity
    tool_starts = {}  # toolCallId -> {toolName, arguments, timestamp}
    tool_results = {}  # toolCallId -> {result, timestamp, success}
    commits = []
    file_changes = []  # {type: create|edit, path, timestamp}
    git_commands = []  # {command, timestamp, result}

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

                etype = ev.get("type", "")
                data = ev.get("data", {})
                ts = ev.get("timestamp", "")

                if etype == "tool.execution_start":
                    tool_name = data.get("toolName", "")
                    args = data.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {}
                    call_id = data.get("toolCallId", "")
                    tool_starts[call_id] = {"name": tool_name, "args": args, "ts": ts}

                    # Track file creates/edits
                    if tool_name == "create" and isinstance(args, dict) and args.get("path"):
                        file_changes.append({"type": "create", "path": args["path"], "timestamp": ts})
                    elif tool_name == "edit" and isinstance(args, dict) and args.get("path"):
                        file_changes.append({"type": "edit", "path": args["path"], "timestamp": ts})

                elif etype == "tool.execution_complete":
                    call_id = data.get("toolCallId", "")
                    result = data.get("result", {})
                    result_content = ""
                    if isinstance(result, dict):
                        result_content = str(result.get("content", ""))
                    elif isinstance(result, str):
                        result_content = result
                    tool_results[call_id] = {"result": result_content, "ts": ts, "success": data.get("success", False)}

        # Now match git bash commands with their results
        import re as _re
        git_cmd_pattern = _re.compile(r'\bgit\s+(--no-pager\s+)?(commit|push|pull|add|diff|status|checkout|switch|log|merge|rebase|stash|reset|branch|tag|fetch|clone|remote)')
        for call_id, start in tool_starts.items():
            if start["name"] != "bash":
                continue
            cmd = start["args"].get("command", "")
            if not cmd or not git_cmd_pattern.search(cmd):
                continue

            result_info = tool_results.get(call_id, {})
            result_text = result_info.get("result", "")

            # Classify git commands
            is_commit = "git" in cmd and "commit" in cmd
            is_push = "git" in cmd and "push" in cmd
            is_diff = "git" in cmd and "diff" in cmd
            is_status = "git" in cmd and "status" in cmd
            is_add = "git" in cmd and "add " in cmd
            is_checkout = "git" in cmd and ("checkout" in cmd or "switch" in cmd)

            entry = {
                "command": cmd[:500],
                "timestamp": start["ts"],
                "result": result_text[:3000],
                "type": "commit" if is_commit else "push" if is_push else "diff" if is_diff else "status" if is_status else "add" if is_add else "checkout" if is_checkout else "other",
            }
            git_commands.append(entry)

            # Extract commit info from result
            if is_commit and result_text:
                match = _re.search(r'\[(\S+)\s+([a-f0-9]+)\]\s+(.*?)(?:\n|$)', result_text)
                if match:
                    branch = match.group(1)
                    sha = match.group(2)
                    message = match.group(3)
                    # Parse files changed stats
                    files_match = _re.search(r'(\d+)\s+files?\s+changed', result_text)
                    ins_match = _re.search(r'(\d+)\s+insertions?', result_text)
                    del_match = _re.search(r'(\d+)\s+deletions?', result_text)
                    commits.append({
                        "sha": sha,
                        "branch": branch,
                        "message": message,
                        "timestamp": start["ts"],
                        "files_changed": int(files_match.group(1)) if files_match else 0,
                        "insertions": int(ins_match.group(1)) if ins_match else 0,
                        "deletions": int(del_match.group(1)) if del_match else 0,
                    })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Deduplicate file changes (same path) but keep all occurrences for timeline
    # Summarize unique files
    unique_files = {}
    for fc in file_changes:
        p = fc["path"]
        if p not in unique_files:
            unique_files[p] = {"path": p, "creates": 0, "edits": 0, "first_seen": fc["timestamp"], "last_seen": fc["timestamp"]}
        if fc["type"] == "create":
            unique_files[p]["creates"] += 1
        else:
            unique_files[p]["edits"] += 1
        unique_files[p]["last_seen"] = fc["timestamp"]

    return jsonify({
        "commits": commits,
        "file_changes": file_changes,
        "file_summary": sorted(unique_files.values(), key=lambda x: x["last_seen"], reverse=True),
        "git_commands": git_commands,
    })


@app.route("/session/<session_id>")
def session_detail(session_id):
    return jsonify({
        "error": "UI moved to savant-app client renderer",
        "mode": "copilot",
        "session_id": session_id,
    }), 410


# ═══════════════════════════════════════════════════════════════════════════════
# CLAUDE CODE BACKEND — parsers & API routes
# ═══════════════════════════════════════════════════════════════════════════════


CLAUDE_GIT_CMD_RE = re.compile(
    r"\bgit\s+(--no-pager\s+)?"
    r"(commit|push|pull|add|diff|status|checkout|switch|log|merge|rebase"
    r"|stash|reset|branch|tag|fetch|clone|remote)"
)


# ───────────────────────────────────────────────────────────────────────────
# Low-level helpers
# ───────────────────────────────────────────────────────────────────────────

def claude_decode_project_dir(dirname):
    """Convert Claude's encoded project dir name back to a path."""
    if dirname.startswith("-"):
        return "/" + dirname[1:].replace("-", "/")
    return dirname


def claude_extract_project_name(project_path):
    """Last component of a project path."""
    if not project_path:
        return "unknown"
    return project_path.rstrip("/").split("/")[-1]


def claude_parse_timestamp(ts):
    """Parse an ISO-8601 timestamp string → datetime (UTC) or None."""
    if not ts:
        return None
    try:
        ts = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def claude_safe_read_jsonl(path):
    """Read a JSONL file, return [] on any error."""
    entries = []
    try:
        with open(path, "rb") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    pass
    except Exception:
        pass
    return entries


def claude_safe_read_json(path):
    """Read a JSON file, return {} on any error."""
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


# ───────────────────────────────────────────────────────────────────────────
# Metadata store  (star / nickname — lives in META_DIR, not CLAUDE_DIR)
# ───────────────────────────────────────────────────────────────────────────

def claude_meta_path():
    return os.path.join(META_DIR, "claude-meta.json")


def claude_load_all_meta():
    os.makedirs(META_DIR, exist_ok=True)
    return claude_safe_read_json(claude_meta_path()) or {}


def claude_save_all_meta(data):
    os.makedirs(META_DIR, exist_ok=True)
    with open(claude_meta_path(), "w") as f:
        json.dump(data, f, indent=2)


def claude_read_session_meta(session_id):
    return claude_load_all_meta().get(session_id, {})


def claude_write_session_meta(session_id, meta):
    all_meta = claude_load_all_meta()
    all_meta[session_id] = meta
    claude_save_all_meta(all_meta)


# ───────────────────────────────────────────────────────────────────────────
# Codex metadata store (META_DIR + CODEX_META_DIR for MCP)
# ───────────────────────────────────────────────────────────────────────────

def codex_meta_path():
    return os.path.join(META_DIR, "codex-meta.json")


def codex_sessions_dir():
    return os.path.join(CODEX_DIR, "sessions")


def codex_workspace_meta_dir():
    return os.path.join(CODEX_DIR, ".savant-meta")


def codex_load_all_meta():
    os.makedirs(META_DIR, exist_ok=True)
    return claude_safe_read_json(codex_meta_path()) or {}


def codex_save_all_meta(data):
    os.makedirs(META_DIR, exist_ok=True)
    with open(codex_meta_path(), "w") as f:
        json.dump(data, f, indent=2)


def codex_read_session_meta(session_id):
    return codex_load_all_meta().get(session_id, {})


def codex_write_session_meta(session_id, meta):
    all_meta = codex_load_all_meta()
    all_meta[session_id] = meta
    codex_save_all_meta(all_meta)


def codex_write_workspace_meta(session_id, workspace_id):
    meta_dir = codex_workspace_meta_dir()
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, f"{session_id}.json")
    if workspace_id is None:
        try:
            if os.path.exists(meta_path):
                os.remove(meta_path)
        except Exception:
            pass
        return
    with open(meta_path, "w") as f:
        json.dump({"workspace": workspace_id}, f)


# ───────────────────────────────────────────────────────────────────────────
# Claude data loaders
# ───────────────────────────────────────────────────────────────────────────

def claude_load_sessions_index(project_dir_path):
    """Load sessions-index.json for a project directory."""
    idx_path = os.path.join(project_dir_path, "sessions-index.json")
    data = claude_safe_read_json(idx_path)
    return data.get("entries", []) if data else []


def claude_load_history():
    """Load history.jsonl — the master prompt log."""
    return claude_safe_read_jsonl(os.path.join(CLAUDE_DIR, "history.jsonl"))


def claude_load_stats_cache():
    """Load stats-cache.json for daily activity data."""
    return claude_safe_read_json(os.path.join(CLAUDE_DIR, "stats-cache.json"))


def claude_find_session_jsonl(session_id):
    """Return the filesystem path to a session's JSONL file (or None).
    Checks session-level JSONL first, then falls back to subagent dir."""
    # 1) Session-level JSONL
    pattern = os.path.join(CLAUDE_DIR, "projects", "*", f"{session_id}.jsonl")
    matches = glob.glob(pattern)
    if matches:
        return matches[0]
    # 2) Subagent JSONL(s) — return the directory marker
    pattern2 = os.path.join(CLAUDE_DIR, "projects", "*", session_id, "subagents")
    matches2 = glob.glob(pattern2)
    for m in matches2:
        if os.path.isdir(m) and any(f.endswith(".jsonl") for f in os.listdir(m)):
            return m  # returns the subagents dir
    return None


def claude_load_session_jsonl(session_id):
    """Load all lines from a session's JSONL. Merges subagent JSONLs if needed."""
    path = claude_find_session_jsonl(session_id)
    if not path:
        return []
    if path.endswith(".jsonl"):
        return claude_safe_read_jsonl(path)
    # path is a subagents directory — merge all JSONL files sorted by first timestamp
    all_messages = []
    for fname in sorted(os.listdir(path)):
        if fname.endswith(".jsonl"):
            all_messages.extend(claude_safe_read_jsonl(os.path.join(path, fname)))
    # Sort by timestamp for chronological order
    all_messages.sort(key=lambda m: m.get("timestamp", ""))
    return all_messages


def claude_find_session_dir(session_id):
    """Return the session artifact directory (tool-results, etc.) or None."""
    pattern = os.path.join(CLAUDE_DIR, "projects", "*", session_id)
    matches = glob.glob(pattern)
    for m in matches:
        if os.path.isdir(m):
            return m
    return None


def claude_find_session_project_dir(session_id):
    """Return the project directory that contains this session."""
    pattern = os.path.join(CLAUDE_DIR, "projects", "*", f"{session_id}.jsonl")
    matches = glob.glob(pattern)
    if matches:
        return os.path.dirname(matches[0])
    pattern2 = os.path.join(CLAUDE_DIR, "projects", "*", session_id)
    matches2 = glob.glob(pattern2)
    for m in matches2:
        if os.path.isdir(m):
            return os.path.dirname(m)
    return None


def claude_remove_from_sessions_index(session_id):
    """Remove a session entry from its project's sessions-index.json.

    First tries to locate the project dir via JSONL/dir on disk (fast path).
    Falls back to scanning ALL sessions-index.json files so entries are
    still removed even when the JSONL was already deleted.
    """
    # Fast path: find project dir from disk artifacts
    project_dir = claude_find_session_project_dir(session_id)
    if project_dir:
        _remove_from_index_file(os.path.join(project_dir, "sessions-index.json"), session_id)
        return

    # Fallback: scan every sessions-index.json in case disk files are gone
    projects_dir = os.path.join(CLAUDE_DIR, "projects")
    if not os.path.isdir(projects_dir):
        return
    for name in os.listdir(projects_dir):
        idx_path = os.path.join(projects_dir, name, "sessions-index.json")
        if os.path.isfile(idx_path):
            _remove_from_index_file(idx_path, session_id)


def _remove_from_index_file(idx_path, session_id):
    """Remove a session entry from a single sessions-index.json file."""
    try:
        with open(idx_path, "r") as f:
            idx_data = json.load(f)
        entries = idx_data.get("entries", [])
        filtered = [e for e in entries if e.get("sessionId") != session_id]
        if len(filtered) < len(entries):
            idx_data["entries"] = filtered
            with open(idx_path, "w") as f:
                json.dump(idx_data, f, indent=2)
    except Exception:
        pass


# ───────────────────────────────────────────────────────────────────────────
# Session status derivation
# ───────────────────────────────────────────────────────────────────────────

def claude_compute_status(modified_str):
    """Derive status from the session's last-modified timestamp."""
    ref = claude_parse_timestamp(modified_str)
    if not ref:
        return "UNKNOWN"
    now = datetime.now(timezone.utc)
    age_minutes = (now - ref).total_seconds() / 60.0
    if age_minutes < 2:
        return "ACTIVE"
    elif age_minutes < 30:
        return "IDLE"
    else:
        return "DORMANT"


# ───────────────────────────────────────────────────────────────────────────
# Conversation parsing  (Claude JSONL → structured conversation)
# ───────────────────────────────────────────────────────────────────────────

def claude_parse_content_blocks(content):
    """Parse message content (string or list of blocks).
    Returns (text, tool_calls, tool_results).
    """
    text_parts = []
    tool_calls = []
    tool_results = []

    if isinstance(content, str):
        return content, [], []

    if not isinstance(content, list):
        return str(content), [], []

    for block in content:
        if isinstance(block, str):
            text_parts.append(block)
        elif isinstance(block, dict):
            btype = block.get("type", "")
            if btype == "text":
                text_parts.append(block.get("text", ""))
            elif btype == "tool_use":
                inp = block.get("input", {})
                safe_inp = {}
                for k, v in (inp if isinstance(inp, dict) else {}).items():
                    sv = str(v)
                    safe_inp[k] = sv[:1000] if len(sv) > 1000 else v
                tool_calls.append({
                    "call_id": block.get("id", ""),
                    "tool_name": block.get("name", ""),
                    "arguments": safe_inp,
                })
            elif btype == "tool_result":
                tr_content = block.get("content", "")
                if isinstance(tr_content, list):
                    tr_text = " ".join(
                        b.get("text", "") if isinstance(b, dict) else str(b)
                        for b in tr_content
                    )
                elif isinstance(tr_content, str):
                    tr_text = tr_content
                else:
                    tr_text = str(tr_content)
                tool_results.append({
                    "tool_use_id": block.get("tool_use_id", ""),
                    "is_error": block.get("is_error", False),
                    "content": tr_text[:3000],
                })

    return "\n".join(text_parts), tool_calls, tool_results


def claude_parse_full_conversation(raw_messages):
    """Parse raw JSONL messages into a rich conversation list + stats."""
    conversation = []
    stats = {
        "user_messages": 0,
        "assistant_messages": 0,
        "assistant_chars": 0,
        "tool_calls": 0,
        "tool_successes": 0,
        "tool_failures": 0,
        "files_created": [],
        "files_edited": [],
    }
    tool_map = {}

    for msg in raw_messages:
        msg_type = msg.get("type", "")

        if msg_type in ("file-history-snapshot", "progress", "queue-operation", "system"):
            continue

        if msg_type == "summary":
            conversation.append({
                "type": "summary",
                "timestamp": msg.get("timestamp", ""),
                "content": msg.get("summary", ""),
            })
            continue

        if msg_type not in ("user", "assistant"):
            continue

        message = msg.get("message", {})
        role = message.get("role", msg_type)
        content = message.get("content", "")
        model = message.get("model", "")
        timestamp = msg.get("timestamp", "")

        text, tc_list, tr_list = claude_parse_content_blocks(content)

        if role == "user":
            stats["user_messages"] += 1
            entry = {
                "type": "user_message",
                "timestamp": timestamp,
                "content": text,
            }
            if tr_list:
                entry["tool_results"] = tr_list
                for tr in tr_list:
                    stats["tool_calls"] += 1
                    if tr.get("is_error"):
                        stats["tool_failures"] += 1
                    else:
                        stats["tool_successes"] += 1
                    tid = tr.get("tool_use_id", "")
                    if tid in tool_map:
                        tool_map[tid]["result"] = tr["content"]
                        tool_map[tid]["success"] = not tr.get("is_error", False)
            conversation.append(entry)

        elif role == "assistant":
            stats["assistant_messages"] += 1
            stats["assistant_chars"] += len(text)

            entry = {
                "type": "assistant_message",
                "timestamp": timestamp,
                "content": text,
                "model": model,
                "tool_requests": [],
            }

            for tc in tc_list:
                stats["tool_calls"] += 1
                entry["tool_requests"].append(tc)
                tool_map[tc["call_id"]] = {
                    "name": tc["tool_name"],
                    "args": tc["arguments"],
                    "start_ts": timestamp,
                    "result": None,
                    "success": None,
                    "model": model,
                }
                args = tc.get("arguments", {})
                tname = tc.get("tool_name", "")
                fpath = args.get("path", args.get("file_path", ""))
                if tname in ("Write", "create") and fpath:
                    if fpath not in stats["files_created"]:
                        stats["files_created"].append(fpath)
                elif tname in ("Edit", "edit") and fpath:
                    if fpath not in stats["files_edited"]:
                        stats["files_edited"].append(fpath)

            conversation.append(entry)

    stats["avg_response_length"] = round(
        stats["assistant_chars"] / max(stats["assistant_messages"], 1)
    )
    stats["tool_success_rate"] = round(
        stats["tool_successes"] / max(stats["tool_calls"], 1) * 100, 1
    )
    stats["files_created"] = stats["files_created"][:50]
    stats["files_edited"] = stats["files_edited"][:50]

    return conversation, tool_map, stats


# ───────────────────────────────────────────────────────────────────────────
# Session-level analytics (extracted from JSONL)
# ───────────────────────────────────────────────────────────────────────────

def claude_read_events_summary(raw_messages):
    """Compute event summary from Claude JSONL data for card parity."""
    event_count = len(raw_messages)
    user_messages = []
    tools_used = set()
    models_seen = set()
    tool_call_counts = Counter()
    model_call_counts = Counter()
    turn_count = 0
    message_count = 0
    first_event_time = None
    last_event_time = None
    last_event_type = None
    event_timestamps = []
    active_tools = []

    for msg in raw_messages:
        msg_type = msg.get("type", "")
        ts = msg.get("timestamp", "")
        if ts:
            if first_event_time is None:
                first_event_time = ts
            last_event_time = ts
            event_timestamps.append(ts)

        last_event_type = msg_type

        if msg_type == "user":
            message_count += 1
            content = msg.get("message", {}).get("content", "")
            text = content if isinstance(content, str) else ""
            if isinstance(content, list):
                text = " ".join(
                    b.get("text", "") if isinstance(b, dict) and b.get("type") == "text"
                    else (b if isinstance(b, str) else "")
                    for b in content
                )
            user_messages.append({"content": text[:200], "timestamp": ts})

        elif msg_type == "assistant":
            turn_count += 1
            message = msg.get("message", {})
            model = message.get("model", "")
            if model:
                models_seen.add(model)
                model_call_counts[model] += 1
            content = message.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_name = block.get("name", "unknown")
                        tools_used.add(tool_name)
                        tool_call_counts[tool_name] += 1

    # Activity buckets (24 segments across session lifetime)
    activity_buckets = []
    parsed_ts = [claude_parse_timestamp(t) for t in event_timestamps]
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

    return {
        "event_count": event_count,
        "last_event_type": last_event_type,
        "last_event_time": last_event_time,
        "first_event_time": first_event_time,
        "user_messages": user_messages[-5:],
        "tools_used": sorted(tools_used),
        "models": sorted(models_seen),
        "model_call_counts": dict(model_call_counts),
        "tool_call_counts": dict(tool_call_counts),
        "turn_count": turn_count,
        "message_count": message_count,
        "activity_buckets": activity_buckets,
        "active_tools": active_tools,
    }


# ───────────────────────────────────────────────────────────────────────────
# Session file tree  (artifacts inside projects/*/<session-id>/)
# ───────────────────────────────────────────────────────────────────────────

def claude_list_session_tree(session_id):
    """List files inside the session artifact directory."""
    session_dir = claude_find_session_dir(session_id)
    result = {"files": [], "total_size": 0}
    if not session_dir or not os.path.isdir(session_dir):
        return result

    for root, _dirs, files in os.walk(session_dir):
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, session_dir)
            try:
                size = os.path.getsize(fp)
            except OSError:
                size = 0
            try:
                mtime = datetime.fromtimestamp(
                    os.path.getmtime(fp), tz=timezone.utc
                ).isoformat()
            except Exception:
                mtime = ""
            result["files"].append({
                "name": f,
                "path": rel,
                "size": size,
                "mtime": mtime,
            })
            result["total_size"] += size

    return result


# ───────────────────────────────────────────────────────────────────────────
# Card cache — sidecar file in META_DIR for lightweight list loads
# ───────────────────────────────────────────────────────────────────────────

def _claude_card_cache_path():
    return os.path.join(META_DIR, "claude-card-cache.json")


def _claude_load_card_cache():
    os.makedirs(META_DIR, exist_ok=True)
    return claude_safe_read_json(_claude_card_cache_path()) or {}


def _claude_save_card_cache(cache):
    os.makedirs(META_DIR, exist_ok=True)
    with open(_claude_card_cache_path(), "w") as f:
        json.dump(cache, f)


def _claude_get_card_data(session_id):
    """Get card-level analytics for a session, using cache when possible."""
    cache = _claude_load_card_cache()

    jsonl_path = claude_find_session_jsonl(session_id)
    if not jsonl_path:
        return {}

    try:
        if os.path.isdir(jsonl_path):
            # subagents dir — use newest file mtime
            mtime = max(
                (os.path.getmtime(os.path.join(jsonl_path, f))
                 for f in os.listdir(jsonl_path) if f.endswith(".jsonl")),
                default=0,
            )
        else:
            mtime = os.path.getmtime(jsonl_path)
    except OSError:
        mtime = 0
    cache_key = f"{session_id}:{mtime}"

    if cache_key in cache:
        return cache[cache_key]

    # Evict any stale entries for this session_id
    stale_keys = [k for k in cache if k.startswith(f"{session_id}:")]
    for k in stale_keys:
        del cache[k]

    raw = claude_load_session_jsonl(session_id)
    summary = claude_read_events_summary(raw)
    cache[cache_key] = summary
    _claude_save_card_cache(cache)
    return summary


# ───────────────────────────────────────────────────────────────────────────
# Aggregated session info
# ───────────────────────────────────────────────────────────────────────────

def _extract_user_msg(card, max_len=120):
    """Extract first user message content from card data."""
    um = card.get("user_messages", [])
    if not um:
        return ""
    first = um[0]
    if isinstance(first, dict):
        return first.get("content", "")[:max_len]
    if isinstance(first, str):
        return first[:max_len]
    return ""


def claude_get_all_sessions():
    """Gather sessions from all project sessions-index files."""
    projects_dir = os.path.join(CLAUDE_DIR, "projects")
    if not os.path.isdir(projects_dir):
        return []

    sessions = []
    for project_dir in os.listdir(projects_dir):
        full_path = os.path.join(projects_dir, project_dir)
        if not os.path.isdir(full_path):
            continue

        entries = claude_load_sessions_index(full_path)
        for entry in entries:
            project_path = entry.get("projectPath", claude_decode_project_dir(project_dir))
            project_name = claude_extract_project_name(project_path)
            session_id = entry.get("sessionId", "")
            modified = entry.get("modified", "")
            created = entry.get("created", "")

            jsonl_file = claude_find_session_jsonl(session_id)
            has_conversation = jsonl_file is not None

            # Skip ghost entries: index entry exists but JSONL was deleted
            if not has_conversation:
                session_dir = claude_find_session_dir(session_id)
                if not session_dir:
                    continue  # no files on disk — stale index entry

            session_dir = claude_find_session_dir(session_id)
            disk_size = get_dir_size(session_dir) if session_dir else 0
            if jsonl_file:
                try:
                    if os.path.isdir(jsonl_file):
                        disk_size += get_dir_size(jsonl_file)
                    else:
                        disk_size += os.path.getsize(jsonl_file)
                except OSError:
                    pass

            meta = claude_read_session_meta(session_id)
            status = claude_compute_status(modified)

            # Lightweight card data from sidecar cache
            card = _claude_get_card_data(session_id)

            sessions.append({
                "id": session_id,
                "project": project_name,
                "project_path": project_path,
                "cwd": project_path,
                "summary": entry.get("summary", ""),
                "nickname": meta.get("nickname", ""),
                "starred": meta.get("starred", False),
                "archived": meta.get("archived", False),
                "workspace": meta.get("workspace"),
                "first_prompt": entry.get("firstPrompt", ""),
                "message_count": entry.get("messageCount", 0),
                "created_at": created,
                "updated_at": modified,
                "branch": entry.get("gitBranch", ""),
                "git_branch": entry.get("gitBranch", ""),
                "is_sidechain": entry.get("isSidechain", False),
                "has_conversation": has_conversation,
                "status": status,
                "disk_size": disk_size,
                "resume_command": f"cd {project_path} && claude --resume {session_id}",
                "session_path": container_to_host_path(session_dir) if session_dir else "",
                "event_count": card.get("event_count", 0),
                "tools_used": card.get("tools_used", []),
                "models": card.get("models", []),
                "model_call_counts": card.get("model_call_counts", {}),
                "tool_call_counts": card.get("tool_call_counts", {}),
                "turn_count": card.get("turn_count", 0),
                "activity_buckets": card.get("activity_buckets", []),
                "user_messages": card.get("user_messages", []),
                "active_tools": card.get("active_tools", []),
                "last_event_type": card.get("last_event_type"),
                "last_event_time": card.get("last_event_time"),
                "first_event_time": card.get("first_event_time"),
                "notes": meta.get("notes", []),
            })

    # ── Discover orphan sessions (have subagent data but no index entry) ──
    indexed_ids = {s["id"] for s in sessions}
    for project_dir in os.listdir(projects_dir):
        full_path = os.path.join(projects_dir, project_dir)
        if not os.path.isdir(full_path):
            continue
        for item in os.listdir(full_path):
            item_path = os.path.join(full_path, item)
            if item in indexed_ids or not os.path.isdir(item_path):
                continue
            sub_dir = os.path.join(item_path, "subagents")
            if not os.path.isdir(sub_dir):
                continue
            jsonls = [f for f in os.listdir(sub_dir) if f.endswith(".jsonl")]
            if not jsonls:
                continue
            # Orphan session with data
            session_id = item
            project_path = claude_decode_project_dir(project_dir)
            project_name = claude_extract_project_name(project_path)
            meta = claude_read_session_meta(session_id)
            card = _claude_get_card_data(session_id)
            try:
                mtime = max(os.path.getmtime(os.path.join(sub_dir, f)) for f in jsonls)
                modified = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
            except Exception:
                modified = ""
            disk_size = get_dir_size(item_path)
            sessions.append({
                "id": session_id,
                "project": project_name,
                "project_path": project_path,
                "cwd": project_path,
                "summary": _extract_user_msg(card, 120),
                "nickname": meta.get("nickname", ""),
                "starred": meta.get("starred", False),
                "archived": meta.get("archived", False),
                "workspace": meta.get("workspace"),
                "first_prompt": _extract_user_msg(card, 200),
                "message_count": card.get("event_count", 0),
                "created_at": modified,
                "updated_at": modified,
                "branch": "",
                "git_branch": "",
                "is_sidechain": False,
                "has_conversation": True,
                "status": claude_compute_status(modified),
                "disk_size": disk_size,
                "resume_command": f"cd {project_path} && claude --resume {session_id}",
                "session_path": container_to_host_path(item_path),
                "event_count": card.get("event_count", 0),
                "tools_used": card.get("tools_used", []),
                "models": card.get("models", []),
                "model_call_counts": card.get("model_call_counts", {}),
                "tool_call_counts": card.get("tool_call_counts", {}),
                "turn_count": card.get("turn_count", 0),
                "activity_buckets": card.get("activity_buckets", []),
                "user_messages": card.get("user_messages", []),
                "active_tools": card.get("active_tools", []),
                "last_event_type": card.get("last_event_type"),
                "last_event_time": card.get("last_event_time"),
                "first_event_time": card.get("first_event_time"),
                "notes": meta.get("notes", []),
            })
            indexed_ids.add(session_id)

    sessions.sort(key=lambda s: str(s.get("updated_at") or s.get("created_at") or ""), reverse=True)
    return sessions


def claude_get_session_detail(session_id):
    """Full session info including file tree and event summary (lazy-loaded)."""
    # Build base session from index without card cache
    projects_dir = os.path.join(CLAUDE_DIR, "projects")
    session = None
    if os.path.isdir(projects_dir):
        for project_dir in os.listdir(projects_dir):
            full_path = os.path.join(projects_dir, project_dir)
            if not os.path.isdir(full_path):
                continue
            entries = claude_load_sessions_index(full_path)
            for entry in entries:
                if entry.get("sessionId") == session_id:
                    project_path = entry.get("projectPath", claude_decode_project_dir(project_dir))
                    project_name = claude_extract_project_name(project_path)
                    modified = entry.get("modified", "")
                    created = entry.get("created", "")
                    jsonl_file = claude_find_session_jsonl(session_id)
                    has_conversation = jsonl_file is not None
                    session_dir = claude_find_session_dir(session_id)
                    disk_size = get_dir_size(session_dir) if session_dir else 0
                    if jsonl_file:
                        try:
                            if os.path.isdir(jsonl_file):
                                disk_size += get_dir_size(jsonl_file)
                            else:
                                disk_size += os.path.getsize(jsonl_file)
                        except OSError:
                            pass
                    meta = claude_read_session_meta(session_id)
                    status = claude_compute_status(modified)
                    session = {
                        "id": session_id,
                        "project": project_name,
                        "project_path": project_path,
                        "cwd": project_path,
                        "summary": entry.get("summary", ""),
                        "nickname": meta.get("nickname", ""),
                        "starred": meta.get("starred", False),
                        "archived": meta.get("archived", False),
                        "workspace": meta.get("workspace"),
                        "first_prompt": entry.get("firstPrompt", ""),
                        "message_count": entry.get("messageCount", 0),
                        "created_at": created,
                        "updated_at": modified,
                        "branch": entry.get("gitBranch", ""),
                        "git_branch": entry.get("gitBranch", ""),
                        "is_sidechain": entry.get("isSidechain", False),
                        "has_conversation": has_conversation,
                        "status": status,
                        "disk_size": disk_size,
                        "resume_command": f"cd {project_path} && claude --resume {session_id}",
                        "session_path": container_to_host_path(session_dir) if session_dir else "",
                    }
                    break
            if session:
                break

    if not session:
        # Try orphan session (has subagent dir but no index entry)
        session_dir = claude_find_session_dir(session_id)
        if session_dir:
            project_dir_name = os.path.basename(os.path.dirname(session_dir))
            project_path = claude_decode_project_dir(project_dir_name)
            project_name = claude_extract_project_name(project_path)
            sub_dir = os.path.join(session_dir, "subagents")
            if os.path.isdir(sub_dir):
                jsonls = [f for f in os.listdir(sub_dir) if f.endswith(".jsonl")]
                if jsonls:
                    try:
                        mtime = max(os.path.getmtime(os.path.join(sub_dir, f)) for f in jsonls)
                        modified = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                    except Exception:
                        modified = ""
                    meta = claude_read_session_meta(session_id)
                    disk_size = get_dir_size(session_dir)
                    session = {
                        "id": session_id,
                        "project": project_name,
                        "project_path": project_path,
                        "cwd": project_path,
                        "summary": "",
                        "nickname": meta.get("nickname", ""),
                        "starred": meta.get("starred", False),
                        "archived": meta.get("archived", False),
                        "workspace": meta.get("workspace"),
                        "first_prompt": "",
                        "message_count": 0,
                        "created_at": modified,
                        "updated_at": modified,
                        "branch": "",
                        "git_branch": "",
                        "is_sidechain": False,
                        "has_conversation": True,
                        "status": claude_compute_status(modified),
                        "disk_size": disk_size,
                        "resume_command": f"cd {project_path} && claude --resume {session_id}",
                        "session_path": container_to_host_path(session_dir),
                    }

    if not session:
        return None

    # Load JSONL for full event summary
    raw = claude_load_session_jsonl(session_id)
    events = claude_read_events_summary(raw) if raw else {
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
        "activity_buckets": [],
        "active_tools": [],
    }

    tree = claude_list_session_tree(session_id)

    session.update({
        "event_count": events["event_count"],
        "last_event_type": events["last_event_type"],
        "last_event_time": events["last_event_time"],
        "first_event_time": events["first_event_time"],
        "user_messages": events["user_messages"],
        "tools_used": events["tools_used"],
        "models": events["models"],
        "model_call_counts": events["model_call_counts"],
        "tool_call_counts": events["tool_call_counts"],
        "turn_count": events["turn_count"],
        "activity_buckets": events["activity_buckets"],
        "active_tools": events.get("active_tools", []),
        "tree": tree,
        "file_count": len(tree["files"]),
    })
    return session


# ───────────────────────────────────────────────────────────────────────────
# Claude API routes
# ───────────────────────────────────────────────────────────────────────────

# ── Gemini CLI detection & parsing ──────────────────────────────────────────

def _gemini_read_session_meta(session_id: str) -> dict:
    """Read Savant metadata for a Gemini session."""
    meta_dir = os.path.join(GEMINI_DIR, ".savant-meta")
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return {"workspace": None, "starred": False, "archived": False}
    try:
        with open(meta_path) as f:
            return json.load(f)
    except Exception:
        return {"workspace": None, "starred": False, "archived": False}

def _gemini_write_session_meta(session_id: str, meta: dict):
    """Write Savant metadata for a Gemini session."""
    meta_dir = os.path.join(GEMINI_DIR, ".savant-meta")
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, f"{session_id}.json")
    try:
        with open(meta_path, "w") as f:
            json.dump(meta, f)
    except Exception as e:
        logger.error(f"Error writing Gemini meta {session_id}: {e}")

def _gemini_read_workspace(session_id: str) -> str | None:
    """Read workspace assignment from savant meta for a Gemini session."""
    return _gemini_read_session_meta(session_id).get("workspace")

def _gemini_parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _gemini_extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
            elif item:
                parts.append(str(item))
        return "\n".join(parts).strip()
    if content is None:
        return ""
    return str(content)


def _gemini_tool_calls(msg: dict) -> list:
    tool_calls = msg.get("toolCalls")
    if isinstance(tool_calls, list):
        return [tc for tc in tool_calls if isinstance(tc, dict)]
    return []


def _gemini_message_project_path(data: dict, project_map: dict) -> str:
    project_hash = data.get("projectHash")
    pinfo = project_map.get(project_hash, {})
    project_path = pinfo.get("path", data.get("projectPath", ""))
    if project_path:
        return project_path
    directories = data.get("directories")
    if isinstance(directories, list):
        for item in directories:
            if isinstance(item, str) and item.startswith("/"):
                return item
            if isinstance(item, dict):
                for key in ("path", "cwd", "directory"):
                    value = item.get(key)
                    if isinstance(value, str) and value.startswith("/"):
                        return value
    return ""


def _gemini_scan_candidates():
    if not os.path.isdir(GEMINI_CHATS_DIR):
        return []

    candidates = []
    for root, _, files in os.walk(GEMINI_CHATS_DIR):
        for filename in files:
            if not filename.endswith(".json"):
                continue
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, GEMINI_CHATS_DIR)
            candidates.append({
                "path": full_path,
                "filename": filename,
                "rel_path": rel_path,
                "is_root": os.path.dirname(full_path) == os.path.realpath(GEMINI_CHATS_DIR),
                "artifact_dir_name": None if root == GEMINI_CHATS_DIR else os.path.basename(root),
            })
    return candidates


def _gemini_build_project_map():
    project_map = {}
    projects_file = os.path.join(GEMINI_DIR, "projects.json")
    if not os.path.isfile(projects_file):
        return project_map
    try:
        with open(projects_file) as f:
            pdata = json.load(f)
        projects = pdata.get("projects", {})
        for path, name in projects.items():
            phash = hashlib.sha256(path.encode("utf-8")).hexdigest()
            project_map[phash] = {"path": path, "name": name}
    except Exception:
        pass
    return project_map


def _gemini_candidate_key(data: dict, candidate: dict) -> str | None:
    session_id = data.get("sessionId")
    artifact_dir = candidate.get("artifact_dir_name") or ""
    if candidate.get("is_root") and session_id:
        return session_id
    if artifact_dir and re.fullmatch(r"[0-9a-fA-F-]{36}", artifact_dir):
        return artifact_dir
    if session_id:
        return session_id
    return None


def _gemini_prefer_candidate(current: dict | None, candidate_info: dict) -> dict:
    if current is None:
        return candidate_info
    if candidate_info["candidate"].get("is_root") and not current["candidate"].get("is_root"):
        return candidate_info
    if current["candidate"].get("is_root") and not candidate_info["candidate"].get("is_root"):
        return current
    current_dt = _gemini_parse_timestamp(current["data"].get("lastUpdated") or current["data"].get("startTime"))
    cand_dt = _gemini_parse_timestamp(candidate_info["data"].get("lastUpdated") or candidate_info["data"].get("startTime"))
    if cand_dt and (not current_dt or cand_dt > current_dt):
        return candidate_info
    return current


def _gemini_collect_sessions():
    project_map = _gemini_build_project_map()
    sessions = {}

    for candidate in _gemini_scan_candidates():
        try:
            with open(candidate["path"], "r") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Error parsing Gemini session {candidate['rel_path']}: {e}")
            continue

        if not isinstance(data, dict):
            continue

        key = _gemini_candidate_key(data, candidate)
        if not key:
            continue

        record = {"data": data, "candidate": candidate}
        sessions[key] = _gemini_prefer_candidate(sessions.get(key), record)

    collected = []
    for session_id, record in sessions.items():
        data = record["data"]
        candidate = record["candidate"]
        messages = data.get("messages", [])
        project_path = _gemini_message_project_path(data, project_map)
        project_name = ""
        if project_path:
            project_name = os.path.basename(project_path.rstrip("/"))
        project_hash = data.get("projectHash")
        if project_hash in project_map:
            project_name = project_map[project_hash].get("name") or project_name

        summary = ""
        summary_field = data.get("summary")
        if isinstance(summary_field, str) and summary_field.strip():
            summary = summary_field.strip()
        user_msgs = []
        tool_count = 0
        last_tool_names = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            text = _gemini_extract_text(msg.get("content"))
            if msg.get("type") == "user" and text:
                user_msgs.append({"timestamp": msg.get("timestamp"), "content": text})
                if not summary:
                    summary = text[:140]
            for tc in _gemini_tool_calls(msg):
                tool_count += 1
                tname = tc.get("displayName") or tc.get("name")
                if tname:
                    last_tool_names.append(str(tname))

        if not summary:
            summary = "Gemini Session"

        last_updated = data.get("lastUpdated")
        start_time = data.get("startTime")
        meta = _gemini_read_session_meta(session_id)
        artifact_dir = os.path.join(GEMINI_CHATS_DIR, session_id)
        status = "COMPLETED"
        is_open = False
        lu_dt = _gemini_parse_timestamp(last_updated or start_time)
        if lu_dt and (datetime.now(timezone.utc) - lu_dt).total_seconds() < 3600:
            status = "RUNNING"
            is_open = True

        collected.append({
            "id": session_id,
            "provider": "gemini",
            "project": project_name,
            "project_path": project_path,
            "cwd": project_path,
            "summary": summary,
            "modified": last_updated or start_time,
            "created": start_time,
            "updated_at": last_updated or start_time,
            "created_at": start_time,
            "path": candidate["path"],
            "session_path": candidate["path"],
            "message_count": len(messages) if isinstance(messages, list) else 0,
            "turn_count": sum(1 for msg in messages if isinstance(msg, dict) and msg.get("type") == "user"),
            "user_messages": user_msgs[:3],
            "workspace": meta.get("workspace"),
            "starred": meta.get("starred"),
            "archived": meta.get("archived"),
            "nickname": meta.get("nickname", ""),
            "status": status,
            "is_open": is_open,
            "resume_command": f"cd {project_path} && gemini --resume {session_id}" if project_path else f"gemini --resume {session_id}",
            "tools_used": sorted(set(last_tool_names))[:8],
            "tool_call_count": tool_count,
            "artifact_dir": artifact_dir if os.path.isdir(artifact_dir) else "",
            "file_count": sum(
                1
                for root, _, files in os.walk(artifact_dir)
                for _ in files
            ) if os.path.isdir(artifact_dir) else 0,
        })
    collected.sort(key=lambda x: x.get("modified", ""), reverse=True)
    return collected


def _gemini_find_session(session_id: str):
    all_sessions = _bg_cache.get("gemini_sessions") or []
    info = next((s for s in all_sessions if s["id"] == session_id), None)
    if info and os.path.isfile(info.get("path", "")):
        return info
    for session in _gemini_collect_sessions():
        if session["id"] == session_id:
            return session
    return None


def _gemini_load_session_json(session_id: str):
    info = _gemini_find_session(session_id)
    if not info:
        return None, None
    try:
        with open(info["path"], "r") as f:
            data = json.load(f)
        return info, data
    except Exception as e:
        logger.error(f"Error reading Gemini detail {session_id}: {e}")
        return info, None

def gemini_get_all_sessions():
    """Gather Gemini sessions from ~/.gemini/tmp/savant-app/chats/."""
    return _gemini_collect_sessions()

def gemini_get_session_detail(session_id):
    """Read full Gemini session JSON and return info/detail structure."""
    info, data = _gemini_load_session_json(session_id)
    if not info or not data:
        return None
    messages = data.get("messages", [])
    last_updated = data.get("lastUpdated")
    start_time = data.get("startTime")
    lu_dt = _gemini_parse_timestamp(last_updated)
    status = "RUNNING" if lu_dt and (datetime.now(timezone.utc) - lu_dt).total_seconds() < 600 else "COMPLETED"
    project_map = _gemini_build_project_map()
    project_path = info.get("project_path") or _gemini_message_project_path(data, project_map)
    active_tools = []
    for msg in reversed(messages if isinstance(messages, list) else []):
        for tc in _gemini_tool_calls(msg):
            if tc.get("status") not in ("success", "error"):
                active_tools.append({
                    "id": tc.get("id"),
                    "name": tc.get("displayName") or tc.get("name") or "Tool",
                })
        if active_tools:
            break
    return {
        "id": session_id,
        "provider": "gemini",
        "summary": info.get("nickname") or info.get("summary", "Gemini Session"),
        "nickname": info.get("nickname", ""),
        "status": status,
        "modified": last_updated or start_time,
        "created": start_time,
        "workspace_id": _gemini_read_workspace(session_id),
        "message_count": len(messages) if isinstance(messages, list) else 0,
        "project_path": project_path,
        "cwd": project_path,
        "resume_command": f"cd {project_path} && gemini --resume {session_id}" if project_path else f"gemini --resume {session_id}",
        "active_tools": active_tools,
        "session_path": info.get("path"),
        "artifact_dir": info.get("artifact_dir", ""),
        "file_count": info.get("file_count", 0),
    }

def gemini_parse_full_conversation(session_id):
    """Parse messages from Gemini session JSON into UI-friendly conversation."""
    _, data = _gemini_load_session_json(session_id)
    if not data:
        return [], {}, {}
    messages = data.get("messages", [])
    conversation = []
    tool_map = {}
    stats = {"user_messages": 0, "assistant_messages": 0, "tool_calls": 0}

    for msg in messages if isinstance(messages, list) else []:
        if not isinstance(msg, dict):
            continue
        m_type = msg.get("type")
        entry = {
            "type": "assistant" if m_type == "gemini" else m_type,
            "content": _gemini_extract_text(msg.get("content")),
            "timestamp": msg.get("timestamp"),
            "thoughts": msg.get("thoughts", []),
        }

        if m_type == "user":
            stats["user_messages"] += 1
        elif m_type == "gemini":
            stats["assistant_messages"] += 1

        tool_calls = _gemini_tool_calls(msg)
        if tool_calls:
            entry["tool_calls"] = tool_calls
            stats["tool_calls"] += len(tool_calls)
            for tc in tool_calls:
                tc_id = tc.get("id")
                if tc_id:
                    tool_map[tc_id] = tc

        conversation.append(entry)
    return conversation, tool_map, stats

@app.route("/api/gemini/sessions")
def api_gemini_sessions():
    with _bg_lock:
        all_sessions = _bg_cache.get('gemini_sessions')
    
    if all_sessions is None:
        # First-time load: trigger a manual scan to avoid waiting 30s
        all_sessions = gemini_get_all_sessions()
        with _bg_lock:
            _bg_cache['gemini_sessions'] = all_sessions
    
    # Simple pagination
    limit = safe_limit(request.args.get("limit", 20, type=int), 100)
    offset = max(0, request.args.get("offset", 0, type=int) or 0)
    
    paginated = all_sessions[offset : offset + limit]
    return jsonify({
        "sessions": paginated,
        "total": len(all_sessions),
        "has_more": len(all_sessions) > (offset + limit)
    })

@app.route("/api/gemini/session/<session_id>")
def api_gemini_session_detail(session_id):
    info = gemini_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(info)

@app.route("/api/gemini/session/<session_id>/convert-prompt")
def api_gemini_convert_prompt(session_id):
    """Generate a handoff prompt from a Gemini session."""
    info = gemini_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    # Get conversation stats
    try:
        _, _, stats = gemini_parse_full_conversation(session_id)
    except Exception:
        stats = {}
    prompt = build_convert_prompt(info, stats, provider="gemini")
    return jsonify({"prompt": prompt, "session_id": session_id, "char_count": len(prompt)})

@app.route("/api/gemini/session/<session_id>/conversation")
def api_gemini_session_conversation(session_id):
    """Full parsed conversation with stats for Gemini."""
    conversation, tool_map, stats = gemini_parse_full_conversation(session_id)
    return jsonify({
        "conversation": conversation,
        "tools": tool_map,
        "stats": stats,
    })

@app.route("/api/gemini/session/<session_id>/workspace", methods=["POST"])
def api_gemini_session_workspace(session_id):
    if not _gemini_find_session(session_id):
        return jsonify({"error": "Not a Gemini session"}), 404
    data = request.get_json(force=True)
    ws_id = data.get("workspace_id")
    meta = _gemini_read_session_meta(session_id)
    meta["workspace"] = ws_id
    _gemini_write_session_meta(session_id, meta)
    # Update cache
    with _bg_lock:
        if _bg_cache.get('gemini_sessions') is not None:
            for s in _bg_cache['gemini_sessions']:
                if s['id'] == session_id:
                    s['workspace'] = ws_id
                    break
    if ws_id:
        _emit_event("session_assigned", f"Gemini session assigned to workspace", {"session_id": session_id, "workspace_id": ws_id})
    return jsonify({"id": session_id, "workspace": ws_id, "workspace_id": ws_id})

@app.route("/api/gemini/session/<session_id>/star", methods=["POST"])
def api_gemini_session_star(session_id):
    if not _gemini_find_session(session_id):
        return jsonify({"error": "Not a Gemini session"}), 404
    meta = _gemini_read_session_meta(session_id)
    meta["starred"] = not meta.get("starred", False)
    _gemini_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('gemini_sessions') is not None:
            for s in _bg_cache['gemini_sessions']:
                if s['id'] == session_id:
                    s['starred'] = meta["starred"]
                    break
    return jsonify({"id": session_id, "starred": meta["starred"]})

@app.route("/api/gemini/session/<session_id>/archive", methods=["POST"])
def api_gemini_session_archive(session_id):
    if not _gemini_find_session(session_id):
        return jsonify({"error": "Not a Gemini session"}), 404
    meta = _gemini_read_session_meta(session_id)
    meta["archived"] = not meta.get("archived", False)
    _gemini_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('gemini_sessions') is not None:
            for s in _bg_cache['gemini_sessions']:
                if s['id'] == session_id:
                    s['archived'] = meta["archived"]
                    break
    return jsonify({"id": session_id, "archived": meta["archived"]})


@app.route("/api/gemini/session/<session_id>/rename", methods=["POST"])
def api_gemini_session_rename(session_id):
    if not _gemini_find_session(session_id):
        return jsonify({"error": "Not a Gemini session"}), 404
    data = request.get_json(force=True)
    nickname = (data.get("nickname") or "").strip()
    meta = _gemini_read_session_meta(session_id)
    if nickname:
        meta["nickname"] = nickname
    else:
        meta.pop("nickname", None)
    _gemini_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get("gemini_sessions") is not None:
            for s in _bg_cache["gemini_sessions"]:
                if s["id"] == session_id:
                    s["nickname"] = nickname
                    if nickname:
                        s["summary"] = nickname
                    break
    return jsonify({"id": session_id, "nickname": nickname})

@app.route("/api/gemini/session/<session_id>/notes", methods=["GET"])
def api_gemini_session_notes_get(session_id):
    try:
        # Get notes from SQLite for this gemini session
        full_session_id = f"gemini_{session_id}"
        notes_list = NoteDB.list_by_session(full_session_id)
        notes = [
            {
                "text": n.get("text", ""),
                "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
            }
            for n in notes_list
        ]
        return jsonify({"notes": notes})
    except Exception as e:
        logger.error(f"Error getting gemini session notes: {e}")
        return jsonify({"error": "Failed to get notes"}), 500

@app.route("/api/gemini/session/<session_id>/notes", methods=["POST"])
def api_gemini_session_notes_post(session_id):
    try:
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Note text required"}), 400
        import uuid
        note_id = f"note_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        full_session_id = f"gemini_{session_id}"
        NoteDB.create({
            "note_id": note_id,
            "session_id": full_session_id,
            "workspace_id": "",
            "text": text,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        notes_list = NoteDB.list_by_session(full_session_id)
        _emit_event("note_created", f"Note added to gemini session", {"session_id": session_id})
        return jsonify({"id": session_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})
    except Exception as e:
        logger.error(f"Error creating gemini session note: {e}")
        return jsonify({"error": "Failed to create note"}), 500

@app.route("/api/gemini/session/<session_id>/notes", methods=["DELETE"])
def api_gemini_session_notes_delete(session_id):
    try:
        data = request.get_json(force=True)
        idx = data.get("index")
        if idx is None:
            return jsonify({"error": "index required"}), 400
        full_session_id = f"gemini_{session_id}"
        notes_list = NoteDB.list_by_session(full_session_id)
        if idx < 0 or idx >= len(notes_list):
            return jsonify({"error": "index out of range"}), 400
        note_id = notes_list[idx].get("note_id")
        if note_id:
            NoteDB.delete(note_id)
        return jsonify({"id": session_id, "deleted": True})
    except Exception as e:
        logger.error(f"Error deleting gemini session note: {e}")
        return jsonify({"error": "Failed to delete note"}), 500

@app.route("/api/gemini/session/<session_id>/file")
def api_gemini_session_file(session_id):
    """Read a file from a Gemini session artifact directory."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return jsonify({"error": "Invalid path"}), 400
    info = _gemini_find_session(session_id)
    session_dir = info.get("artifact_dir") if info else ""
    if not os.path.isdir(session_dir):
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
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

@app.route("/api/gemini/session/<session_id>/file/raw")
def api_gemini_session_file_raw(session_id):
    """Serve a Gemini session file raw."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return "Invalid path", 400
    info = _gemini_find_session(session_id)
    session_dir = info.get("artifact_dir") if info else ""
    if not os.path.isdir(session_dir):
        return "Session not found", 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return "File not found", 404
    return send_file(full)

@app.route("/api/gemini/session/<session_id>/file", methods=["PUT"])
def api_gemini_session_file_write(session_id):
    """Write content to a Gemini session file."""
    data = request.get_json(force=True)
    rel_path = data.get("path", "")
    content = data.get("content")
    if not rel_path or ".." in rel_path or content is None:
        return jsonify({"error": "Invalid path or missing content"}), 400
    info = _gemini_find_session(session_id)
    session_dir = info.get("artifact_dir") if info else ""
    if not os.path.isdir(session_dir):
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "w") as f:
            f.write(content)
        return jsonify({"ok": True, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/gemini/session/<session_id>/project-files")
def api_gemini_session_project_files(session_id):
    info, data = _gemini_load_session_json(session_id)
    if not info or not data:
        return jsonify({"error": "Session not found"}), 404

    cwd = info.get("cwd") or data.get("projectPath") or ""
    files_seen = {}
    for msg in data.get("messages", []) if isinstance(data.get("messages"), list) else []:
        if not isinstance(msg, dict):
            continue
        ts = msg.get("timestamp", "")
        for tc in _gemini_tool_calls(msg):
            args = tc.get("args") if isinstance(tc.get("args"), dict) else {}
            fpath = args.get("path") or args.get("file_path") or args.get("target_file")
            if not fpath and tc.get("name") == "run_shell_command":
                continue
            if not fpath or "/.gemini/" in fpath or "/.claude/" in fpath or "/.codex/" in fpath or "/.copilot/" in fpath:
                continue

            tool_name = (tc.get("name") or "").lower()
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
    for fpath, item in files_seen.items():
        item["name"] = os.path.basename(fpath)
        item["relative"] = os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
        file_list.append(item)
    file_list.sort(key=lambda x: x.get("last_seen", ""), reverse=True)
    return jsonify({"files": file_list, "cwd": cwd})


@app.route("/api/gemini/session/<session_id>/git-changes")
def api_gemini_session_git_changes(session_id):
    _, data = _gemini_load_session_json(session_id)
    if not data:
        return jsonify({"error": "Session not found"}), 404

    commits = []
    file_changes = []
    git_commands = []

    for msg in data.get("messages", []) if isinstance(data.get("messages"), list) else []:
        if not isinstance(msg, dict):
            continue
        ts = msg.get("timestamp", "")
        for tc in _gemini_tool_calls(msg):
            name = tc.get("name") or ""
            args = tc.get("args") if isinstance(tc.get("args"), dict) else {}
            result_display = tc.get("resultDisplay") or ""
            description = tc.get("description") or ""
            command = ""
            if name == "run_shell_command":
                command = (args.get("command") or "").strip()
            elif "git " in description:
                command = description.strip()
            if command and "git " in command:
                git_commands.append({
                    "command": command,
                    "timestamp": ts,
                    "result": result_display,
                })
                fpath = args.get("path") or args.get("file_path")
                if fpath:
                    file_changes.append({"type": "edit", "path": fpath, "timestamp": ts})
                commit_match = re.search(r"\[([^\s]+)\s+([0-9a-f]{7,40})\]\s+(.+)", result_display)
                if commit_match:
                    commits.append({
                        "branch": commit_match.group(1),
                        "sha": commit_match.group(2),
                        "message": commit_match.group(3).strip(),
                        "timestamp": ts,
                        "files_changed": 0,
                        "insertions": 0,
                        "deletions": 0,
                    })

    unique_files = {}
    for fc in file_changes:
        path = fc["path"]
        if path not in unique_files:
            unique_files[path] = {"path": path, "creates": 0, "edits": 0, "first_seen": fc["timestamp"], "last_seen": fc["timestamp"]}
        if fc["type"] == "create":
            unique_files[path]["creates"] += 1
        else:
            unique_files[path]["edits"] += 1
        unique_files[path]["last_seen"] = fc["timestamp"]

    return jsonify({
        "commits": commits,
        "file_changes": file_changes,
        "file_summary": sorted(unique_files.values(), key=lambda x: x["last_seen"], reverse=True),
        "git_commands": git_commands,
    })


@app.route("/api/gemini/session/<session_id>", methods=["DELETE"])
def api_gemini_session_delete(session_id):
    info = _gemini_find_session(session_id)
    if info and os.path.isfile(info.get("path", "")):
        try:
            os.remove(info["path"])
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    artifact_dir = info.get("artifact_dir") if info else ""
    if artifact_dir and os.path.isdir(artifact_dir):
        try:
            shutil.rmtree(artifact_dir)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    with _bg_lock:
        if _bg_cache.get("gemini_sessions") is not None:
            _bg_cache["gemini_sessions"] = [s for s in _bg_cache["gemini_sessions"] if s["id"] != session_id]
    meta_path = os.path.join(GEMINI_DIR, ".savant-meta", f"{session_id}.json")
    if os.path.isfile(meta_path):
        try:
            os.remove(meta_path)
        except Exception:
            pass
    return jsonify({"deleted": session_id})


@app.route("/api/gemini/sessions/bulk-delete", methods=["POST"])
def api_gemini_bulk_delete():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No session IDs provided"}), 400
    deleted = []
    errors = []
    for sid in ids:
        sid = str(sid)
        info = _gemini_find_session(sid)
        ok = False
        if info and os.path.isfile(info.get("path", "")):
            try:
                os.remove(info["path"])
                ok = True
            except Exception as e:
                errors.append({"id": sid, "error": str(e)})
        artifact_dir = info.get("artifact_dir") if info else ""
        if artifact_dir and os.path.isdir(artifact_dir):
            try:
                shutil.rmtree(artifact_dir)
                ok = True
            except Exception as e:
                errors.append({"id": sid, "error": str(e)})
        meta_path = os.path.join(GEMINI_DIR, ".savant-meta", f"{sid}.json")
        if os.path.isfile(meta_path):
            try:
                os.remove(meta_path)
            except Exception:
                pass
        if ok or not info:
            deleted.append(sid)
    if deleted:
        deleted_set = set(deleted)
        with _bg_lock:
            if _bg_cache.get("gemini_sessions") is not None:
                _bg_cache["gemini_sessions"] = [s for s in _bg_cache["gemini_sessions"] if s["id"] not in deleted_set]
    return jsonify({"deleted": deleted, "errors": errors})


@app.route("/api/gemini/search")
def api_gemini_search():
    query = request.args.get("q", "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"results": [], "error": "Query too short"})
    limit = int(request.args.get("limit", 50))
    results = []
    for session in gemini_get_all_sessions():
        _, data = _gemini_load_session_json(session["id"])
        if not data:
            continue
        for msg in data.get("messages", []) if isinstance(data.get("messages"), list) else []:
            if not isinstance(msg, dict):
                continue
            text = _gemini_extract_text(msg.get("content"))
            if not text:
                continue
            lower = text.lower()
            if query not in lower:
                continue
            idx = lower.index(query)
            start = max(0, idx - 80)
            results.append({
                "session_id": session["id"],
                "summary": session.get("nickname") or session.get("summary") or "Gemini Session",
                "provider": "gemini",
                "timestamp": msg.get("timestamp", ""),
                "content": text[start:start + 200],
            })
            if len(results) >= limit:
                break
        if len(results) >= limit:
            break
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"results": results})

@app.route("/api/claude/sessions")
def api_claude_sessions():
    with _bg_lock:
        all_sessions = _bg_cache.get('claude_sessions')
    if all_sessions is None:
        return jsonify({"sessions": [], "total": 0, "has_more": False, "loading": True})
    total = len(all_sessions)
    limit = request.args.get("limit", 30, type=int)
    offset = request.args.get("offset", 0, type=int)
    page = all_sessions[offset:offset + limit]
    return jsonify({"sessions": page, "total": total, "has_more": offset + limit < total})


@app.route("/api/claude/session/<session_id>")
def api_claude_session_detail(session_id):
    info = claude_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(info)


@app.route("/api/claude/session/<session_id>/convert-prompt")
def api_claude_convert_prompt(session_id):
    """Generate a handoff prompt from a Claude session."""
    info = claude_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    # Get conversation stats for file lists
    try:
        conv_resp = api_claude_session_conversation(session_id)
        conv_data = conv_resp.get_json() if hasattr(conv_resp, 'get_json') else {}
        conv_stats = conv_data.get("stats", {})
    except Exception:
        conv_stats = {}
    prompt = build_convert_prompt(info, conv_stats, provider="claude")
    return jsonify({"prompt": prompt, "session_id": session_id, "char_count": len(prompt)})


@app.route("/api/claude/session/<session_id>/conversation")
def api_claude_session_conversation(session_id):
    """Full parsed conversation with stats."""
    raw = claude_load_session_jsonl(session_id)
    if not raw:
        return jsonify({"conversation": [], "tools": {}, "stats": {}})

    conversation, tool_map, stats = claude_parse_full_conversation(raw)
    return jsonify({
        "conversation": conversation,
        "tools": tool_map,
        "stats": stats,
    })


@app.route("/api/claude/session/<session_id>/file")
def api_claude_session_file(session_id):
    """Read a file from a Claude session artifact directory."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return jsonify({"error": "Invalid path"}), 400
    session_dir = claude_find_session_dir(session_id)
    if not session_dir:
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
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


@app.route("/api/claude/session/<session_id>/file/raw")
def api_claude_session_file_raw(session_id):
    """Serve a Claude session file raw."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return "Invalid path", 400
    session_dir = claude_find_session_dir(session_id)
    if not session_dir:
        return "Session not found", 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return "File not found", 404
    return send_file(full)


@app.route("/api/claude/session/<session_id>/file", methods=["PUT"])
def api_claude_session_file_write(session_id):
    """Write content to a Claude session file."""
    data = request.get_json(force=True)
    rel_path = data.get("path", "")
    content = data.get("content")
    if not rel_path or ".." in rel_path or content is None:
        return jsonify({"error": "Invalid path or missing content"}), 400
    session_dir = claude_find_session_dir(session_id)
    if not session_dir:
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "w") as f:
            f.write(content)
        return jsonify({"ok": True, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



def api_claude_session_project_files(session_id):
    """Extract files created/edited/read during a session from JSONL."""
    raw = claude_load_session_jsonl(session_id)
    if not raw:
        return jsonify({"files": [], "cwd": ""})

    cwd = ""
    for msg in raw:
        if msg.get("cwd"):
            cwd = msg["cwd"]
            break

    files_seen = {}

    for msg in raw:
        msg_type = msg.get("type", "")
        if msg_type != "assistant":
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
            if not fpath:
                if tool_name in ("Bash", "bash") and inp.get("command", ""):
                    continue
                continue

            if "/.claude/" in fpath or "/.copilot/" in fpath:
                continue

            action = "view"
            if tool_name in ("Write", "create"):
                action = "create"
            elif tool_name in ("Edit", "edit"):
                action = "edit"
            elif tool_name in ("Read", "view"):
                action = "view"
            else:
                action = tool_name.lower()

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
            if action in ("create", "edit"):
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


@app.route("/api/claude/session/<session_id>/git-changes")
def api_claude_session_git_changes(session_id):
    """Extract git commands, commits, file changes from JSONL conversation."""
    raw = claude_load_session_jsonl(session_id)
    if not raw:
        return jsonify({"commits": [], "file_changes": [], "git_commands": [], "file_summary": []})

    tool_calls_by_id = {}
    tool_results_by_id = {}
    file_changes = []

    for msg in raw:
        msg_type = msg.get("type", "")
        content = msg.get("message", {}).get("content", "")
        ts = msg.get("timestamp", "")

        if not isinstance(content, list):
            continue

        for block in content:
            if not isinstance(block, dict):
                continue

            if msg_type == "assistant" and block.get("type") == "tool_use":
                call_id = block.get("id", "")
                tool_name = block.get("name", "")
                inp = block.get("input", {}) if isinstance(block.get("input"), dict) else {}
                tool_calls_by_id[call_id] = {"name": tool_name, "args": inp, "ts": ts}

                fpath = inp.get("path", inp.get("file_path", ""))
                if tool_name in ("Write", "create") and fpath:
                    file_changes.append({"type": "create", "path": fpath, "timestamp": ts})
                elif tool_name in ("Edit", "edit") and fpath:
                    file_changes.append({"type": "edit", "path": fpath, "timestamp": ts})

            elif msg_type == "user" and block.get("type") == "tool_result":
                tid = block.get("tool_use_id", "")
                tr_content = block.get("content", "")
                if isinstance(tr_content, list):
                    tr_content = " ".join(
                        b.get("text", "") if isinstance(b, dict) else str(b)
                        for b in tr_content
                    )
                tool_results_by_id[tid] = {
                    "content": str(tr_content)[:5000],
                    "is_error": block.get("is_error", False),
                    "ts": ts,
                }

    commits = []
    git_commands = []

    for call_id, info in tool_calls_by_id.items():
        if info["name"] not in ("Bash", "bash"):
            continue
        cmd = info["args"].get("command", "")
        if not cmd or not CLAUDE_GIT_CMD_RE.search(cmd):
            continue

        result_info = tool_results_by_id.get(call_id, {})
        result_text = result_info.get("content", "")

        is_commit = "commit" in cmd
        is_push = "push" in cmd
        is_diff = "diff" in cmd
        is_status = "status" in cmd
        is_add = "add " in cmd
        is_checkout = "checkout" in cmd or "switch" in cmd

        cmd_type = (
            "commit" if is_commit else
            "push" if is_push else
            "diff" if is_diff else
            "status" if is_status else
            "add" if is_add else
            "checkout" if is_checkout else
            "other"
        )

        git_commands.append({
            "command": cmd[:500],
            "timestamp": info["ts"],
            "result": result_text[:3000],
            "type": cmd_type,
        })

        if is_commit and result_text:
            match = re.search(r"\[(\S+)\s+([a-f0-9]+)\]\s+(.*?)(?:\n|$)", result_text)
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
                    "timestamp": info["ts"],
                    "files_changed": int(files_match.group(1)) if files_match else 0,
                    "insertions": int(ins_match.group(1)) if ins_match else 0,
                    "deletions": int(del_match.group(1)) if del_match else 0,
                })

    unique_files = {}
    for fc in file_changes:
        p = fc["path"]
        if p not in unique_files:
            unique_files[p] = {"path": p, "creates": 0, "edits": 0, "first_seen": fc["timestamp"], "last_seen": fc["timestamp"]}
        if fc["type"] == "create":
            unique_files[p]["creates"] += 1
        else:
            unique_files[p]["edits"] += 1
        unique_files[p]["last_seen"] = fc["timestamp"]

    return jsonify({
        "commits": commits,
        "file_changes": file_changes,
        "file_summary": sorted(unique_files.values(), key=lambda x: x["last_seen"], reverse=True),
        "git_commands": git_commands,
    })


@app.route("/api/claude/session/<session_id>/rename", methods=["POST"])
def api_claude_session_rename(session_id):
    data = request.get_json(force=True)
    nickname = (data.get("nickname") or "").strip()
    meta = claude_read_session_meta(session_id)
    if nickname:
        meta["nickname"] = nickname
    else:
        meta.pop("nickname", None)
    claude_write_session_meta(session_id, meta)
    # Sync nickname to Claude's sessions-index.json so Claude sees the rename
    try:
        project_dir = claude_find_session_project_dir(session_id)
        if project_dir:
            idx_path = os.path.join(project_dir, "sessions-index.json")
            if os.path.isfile(idx_path):
                with open(idx_path, "r") as f:
                    idx_data = json.load(f)
                entries = idx_data.get("entries", [])
                for entry in entries:
                    if entry.get("sessionId") == session_id:
                        if nickname:
                            entry["summary"] = nickname
                        break
                with open(idx_path, "w") as f:
                    json.dump(idx_data, f, indent=2)
    except Exception:
        pass
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['nickname'] = nickname
                    if nickname:
                        s['summary'] = nickname
                    break
    return jsonify({"id": session_id, "nickname": nickname})


@app.route("/api/claude/session/<session_id>/star", methods=["POST"])
def api_claude_session_star(session_id):
    meta = claude_read_session_meta(session_id)
    meta["starred"] = not meta.get("starred", False)
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['starred'] = meta["starred"]
                    break
    return jsonify({"id": session_id, "starred": meta["starred"]})


@app.route("/api/claude/session/<session_id>/archive", methods=["POST"])
def api_claude_session_archive(session_id):
    meta = claude_read_session_meta(session_id)
    meta["archived"] = not meta.get("archived", False)
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['archived'] = meta["archived"]
                    break
    return jsonify({"id": session_id, "archived": meta["archived"]})


@app.route("/api/claude/session/<session_id>/workspace", methods=["POST"])
def api_claude_session_workspace(session_id):
    # Verify this is actually a Claude session before accepting assignment
    if not claude_find_session_jsonl(session_id) and not claude_find_session_dir(session_id):
        return jsonify({"error": "Not a Claude session"}), 404
    data = request.get_json(force=True)
    ws_id = data.get("workspace_id")
    meta = claude_read_session_meta(session_id)
    meta["workspace"] = ws_id
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['workspace'] = ws_id
                    break
    if ws_id:
        _emit_event("session_assigned", f"Claude session assigned to workspace", {"session_id": session_id, "workspace_id": ws_id})
    return jsonify({"id": session_id, "workspace": ws_id})


@app.route("/api/claude/session/<session_id>/notes", methods=["GET"])
def api_claude_session_notes_get(session_id):
    try:
        # Get notes from SQLite for this claude session
        # Prefix session_id with "claude_" to distinguish from copilot sessions
        full_session_id = f"claude_{session_id}"
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
        print(f"Error getting claude session notes: {e}", flush=True)
        return jsonify({"error": "Failed to get notes"}), 500


@app.route("/api/claude/session/<session_id>/notes", methods=["POST"])
def api_claude_session_notes_post(session_id):
    try:
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Note text required"}), 400
        
        # Create note in SQLite
        import uuid
        note_id = f"note_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        full_session_id = f"claude_{session_id}"
        
        NoteDB.create({
            "note_id": note_id,
            "session_id": full_session_id,
            "workspace_id": "",
            "text": text,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        
        # Get all notes for this session
        notes_list = NoteDB.list_by_session(full_session_id)
        
        _emit_event("note_created", f"Note added to claude session", {"session_id": session_id})
        return jsonify({"id": session_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})
    except Exception as e:
        print(f"Error creating claude session note: {e}", flush=True)
        return jsonify({"error": "Failed to create note"}), 500


@app.route("/api/claude/session/<session_id>/notes", methods=["DELETE"])
def api_claude_session_notes_delete(session_id):
    try:
        data = request.get_json(force=True)
        idx = data.get("index")
        if idx is None:
            return jsonify({"error": "index required"}), 400
        
        # Get all notes for this claude session from SQLite
        full_session_id = f"claude_{session_id}"
        notes_list = NoteDB.list_by_session(full_session_id)
        
        if idx < 0 or idx >= len(notes_list):
            return jsonify({"error": "Invalid index"}), 400
        
        # Delete the note at this index
        note_to_delete = notes_list[idx]
        NoteDB.delete(note_to_delete.get("note_id"))
        
        # Get updated notes list
        updated_notes = NoteDB.list_by_session(full_session_id)
        
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
        print(f"Error deleting claude session note: {e}", flush=True)
        return jsonify({"error": "Failed to delete note"}), 500


# ── Claude MR CRUD ───────────────────────────────────────────────────────

@app.route("/api/claude/session/<session_id>/mr", methods=["GET"])
def api_claude_session_mr_get(session_id):
    meta = claude_read_session_meta(session_id)
    mrs = meta.get("mrs", [])
    return jsonify(mrs)


@app.route("/api/claude/session/<session_id>/mr", methods=["POST"])
def api_claude_session_mr_post(session_id):
    data = request.get_json(force=True)
    mr_id = data.get("id") or str(int(time.time() * 1000))
    mr_data = {
        "id": mr_id,
        "url": (data.get("url") or "").strip(),
        "status": (data.get("status") or "").strip(),
        "jira": (data.get("jira") or "").strip(),
        "role": (data.get("role") or "").strip(),
    }
    meta = claude_read_session_meta(session_id)
    mrs = meta.get("mrs", [])
    found = False
    for i, mr in enumerate(mrs):
        if mr.get("id") == mr_id:
            mrs[i] = mr_data
            found = True
            break
    if not found:
        mrs.append(mr_data)
    meta["mrs"] = mrs
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = mrs
                    break
    return jsonify({"id": session_id, "mrs": mrs})


@app.route("/api/claude/session/<session_id>/mr/<mr_id>", methods=["DELETE"])
def api_claude_session_mr_delete(session_id, mr_id):
    meta = claude_read_session_meta(session_id)
    mrs = [mr for mr in meta.get("mrs", []) if mr.get("id") != mr_id]
    meta["mrs"] = mrs
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = mrs
                    break
    return jsonify({"id": session_id, "deleted": True})


@app.route("/api/claude/session/<session_id>", methods=["DELETE"])
def api_claude_session_delete(session_id):
    deleted_files = []
    errors = []
    # Remove from sessions-index.json BEFORE deleting files (lookup needs them)
    claude_remove_from_sessions_index(session_id)
    # Delete session JSONL
    jsonl_path = claude_find_session_jsonl(session_id)
    if jsonl_path:
        try:
            if os.path.isdir(jsonl_path):
                shutil.rmtree(jsonl_path)
            else:
                os.remove(jsonl_path)
            deleted_files.append(jsonl_path)
        except Exception as e:
            errors.append(str(e))
    # Delete session artifact directory
    session_dir = claude_find_session_dir(session_id)
    if session_dir and os.path.isdir(session_dir):
        try:
            shutil.rmtree(session_dir)
            deleted_files.append(session_dir)
        except Exception as e:
            errors.append(str(e))
    if errors and not deleted_files:
        return jsonify({"error": "; ".join(errors)}), 500
    # Always purge from cache even if nothing was on disk
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            _bg_cache['claude_sessions'] = [s for s in _bg_cache['claude_sessions'] if s['id'] != session_id]
    return jsonify({"deleted": session_id})


@app.route("/api/claude/sessions/bulk-delete", methods=["POST"])
def api_claude_bulk_delete():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No session IDs provided"}), 400
    deleted = []
    errors = []
    for sid in ids:
        sid = str(sid)
        ok = False
        # Remove from sessions-index.json BEFORE deleting files (lookup needs them)
        claude_remove_from_sessions_index(sid)
        jsonl_path = claude_find_session_jsonl(sid)
        if jsonl_path:
            try:
                if os.path.isdir(jsonl_path):
                    shutil.rmtree(jsonl_path)
                else:
                    os.remove(jsonl_path)
                ok = True
            except Exception as e:
                errors.append({"id": sid, "error": str(e)})
        session_dir = claude_find_session_dir(sid)
        if session_dir and os.path.isdir(session_dir):
            try:
                shutil.rmtree(session_dir)
                ok = True
            except Exception as e:
                errors.append({"id": sid, "error": str(e)})
        if ok:
            deleted.append(sid)
        elif not any(e.get("id") == sid for e in errors):
            # No files on disk but no errors — treat as successfully gone
            deleted.append(sid)
    if deleted:
        with _bg_lock:
            if _bg_cache.get('claude_sessions') is not None:
                deleted_set = set(deleted)
                _bg_cache['claude_sessions'] = [s for s in _bg_cache['claude_sessions'] if s['id'] not in deleted_set]
    return jsonify({"deleted": deleted, "errors": errors})


@app.route("/api/claude/search")
def api_claude_search():
    """Search across Claude session JSONL files and history for text matches."""
    query = request.args.get("q", "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"results": [], "error": "Query too short"})

    limit = int(request.args.get("limit", 50))
    results = []

    sessions = claude_get_all_sessions()
    matched_sessions = []
    for s in sessions:
        searchable = " ".join([
            s.get("first_prompt", ""),
            s.get("summary", ""),
            s.get("project", ""),
            s.get("git_branch", ""),
            s.get("nickname", ""),
        ]).lower()
        if query in searchable:
            matched_sessions.append(s)

    projects_dir = os.path.join(CLAUDE_DIR, "projects")
    if os.path.isdir(projects_dir):
        for project_dir in os.listdir(projects_dir):
            project_path = os.path.join(projects_dir, project_dir)
            if not os.path.isdir(project_path):
                continue
            for fname in os.listdir(project_path):
                if not fname.endswith(".jsonl"):
                    continue
                session_id = fname[:-6]
                jsonl_path = os.path.join(project_path, fname)

                session_meta_item = next((s for s in sessions if s["id"] == session_id), {})
                project = session_meta_item.get("project", claude_extract_project_name(
                    claude_decode_project_dir(project_dir)
                ))
                meta = claude_read_session_meta(session_id)

                try:
                    with open(jsonl_path, "rb") as f:
                        for line in f:
                            try:
                                msg = json.loads(line)
                            except Exception:
                                continue
                            msg_type = msg.get("type", "")
                            if msg_type not in ("user", "assistant"):
                                continue

                            content = msg.get("message", {}).get("content", "")
                            text = ""
                            if isinstance(content, str):
                                text = content
                            elif isinstance(content, list):
                                text = " ".join(
                                    b.get("text", "") if isinstance(b, dict) and b.get("type") == "text"
                                    else (b if isinstance(b, str) else "")
                                    for b in content
                                )

                            if not text or query not in text.lower():
                                continue

                            idx = text.lower().index(query)
                            start = max(0, idx - 80)
                            end = min(len(text), idx + len(query) + 80)
                            snippet = (
                                ("..." if start > 0 else "")
                                + text[start:end]
                                + ("..." if end < len(text) else "")
                            )

                            results.append({
                                "session_id": session_id,
                                "session_name": meta.get("nickname") or session_meta_item.get("summary", ""),
                                "project": project,
                                "branch": session_meta_item.get("branch", ""),
                                "timestamp": msg.get("timestamp", ""),
                                "type": msg_type,
                                "snippet": snippet,
                                "query_pos": idx,
                            })

                            if len(results) >= limit:
                                break
                except Exception:
                    continue

                if len(results) >= limit:
                    break
            if len(results) >= limit:
                break

    history = claude_load_history()
    matched_history = []
    for h in history:
        if query in h.get("display", "").lower() or query in h.get("project", "").lower():
            matched_history.append({
                "prompt": h.get("display", ""),
                "project": h.get("project", ""),
                "project_name": claude_extract_project_name(h.get("project", "")),
                "timestamp": h.get("timestamp", 0),
            })
    matched_history.sort(key=lambda h: h.get("timestamp", 0), reverse=True)

    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({
        "results": results[:limit],
        "sessions": matched_sessions[:20],
        "history": matched_history[:30],
        "query": query,
    })


def _build_claude_usage():
    """Build claude usage data."""
    model_totals = Counter()
    tool_totals = Counter()
    total_turns = 0
    total_messages = 0
    total_tool_calls = 0
    total_events = 0
    sessions_by_day = Counter()
    tools_by_day = Counter()
    messages_by_day = Counter()
    turns_by_day = Counter()
    session_durations = []

    stats_cache = claude_load_stats_cache()
    daily_from_cache = stats_cache.get("dailyActivity", [])

    projects_dir = os.path.join(CLAUDE_DIR, "projects")
    session_count = 0

    if os.path.isdir(projects_dir):
        for project_dir in os.listdir(projects_dir):
            project_path = os.path.join(projects_dir, project_dir)
            if not os.path.isdir(project_path):
                continue

            for fname in os.listdir(project_path):
                if not fname.endswith(".jsonl"):
                    continue
                session_count += 1
                jsonl_path = os.path.join(project_path, fname)

                first_ts = None
                last_ts = None

                try:
                    with open(jsonl_path, "rb") as f:
                        for line in f:
                            try:
                                msg = json.loads(line)
                            except Exception:
                                continue

                            total_events += 1
                            msg_type = msg.get("type", "")
                            ts = msg.get("timestamp", "")
                            day = ts[:10] if ts and len(ts) >= 10 else None

                            if first_ts is None and ts:
                                first_ts = ts
                            if ts:
                                last_ts = ts

                            if msg_type == "user":
                                total_messages += 1
                                if day:
                                    messages_by_day[day] += 1

                            elif msg_type == "assistant":
                                total_turns += 1
                                if day:
                                    turns_by_day[day] += 1
                                message = msg.get("message", {})
                                model = message.get("model", "")
                                if model:
                                    model_totals[model] += 1
                                content = message.get("content", "")
                                if isinstance(content, list):
                                    for block in content:
                                        if isinstance(block, dict) and block.get("type") == "tool_use":
                                            total_tool_calls += 1
                                            tool_name = block.get("name", "unknown")
                                            tool_totals[tool_name] += 1
                                            if day:
                                                tools_by_day[day] += 1
                except Exception:
                    continue

                if first_ts and last_ts:
                    t1 = claude_parse_timestamp(first_ts)
                    t2 = claude_parse_timestamp(last_ts)
                    if t1 and t2:
                        dur = (t2 - t1).total_seconds() / 60.0
                        session_durations.append(dur)

                if first_ts:
                    day = first_ts[:10] if len(first_ts) >= 10 else None
                    if day:
                        sessions_by_day[day] += 1

    all_days = sorted(set(
        list(sessions_by_day.keys()) +
        list(tools_by_day.keys()) +
        list(messages_by_day.keys())
    ))
    daily = []
    for d in all_days[-14:]:
        daily.append({
            "date": d,
            "sessions": sessions_by_day.get(d, 0),
            "messages": messages_by_day.get(d, 0),
            "turns": turns_by_day.get(d, 0),
            "tools": tools_by_day.get(d, 0),
        })

    if not daily and daily_from_cache:
        for entry in daily_from_cache[-14:]:
            daily.append({
                "date": entry.get("date", ""),
                "sessions": entry.get("sessionCount", 0),
                "messages": entry.get("messageCount", 0),
                "turns": 0,
                "tools": entry.get("toolCallCount", 0),
            })

    avg_tools_per_turn = round(total_tool_calls / max(total_turns, 1), 1)
    avg_turns_per_msg = round(total_turns / max(total_messages, 1), 1)
    total_hours = round(sum(session_durations) / 60.0, 1)
    avg_session_min = round(sum(session_durations) / max(len(session_durations), 1), 0)

    return {
        "models": [{"name": m, "calls": c} for m, c in model_totals.most_common()],
        "tools": [{"name": t, "calls": c} for t, c in tool_totals.most_common(25)],
        "daily": daily,
        "totals": {
            "sessions": session_count,
            "messages": total_messages,
            "turns": total_turns,
            "tool_calls": total_tool_calls,
            "events": total_events,
            "total_hours": total_hours,
            "avg_session_minutes": avg_session_min,
            "avg_tools_per_turn": avg_tools_per_turn,
            "avg_turns_per_message": avg_turns_per_msg,
        },
    }


def _build_gemini_usage():
    """Build Gemini usage data from chat JSONs."""
    model_totals = Counter()
    tool_totals = Counter()
    total_turns = 0
    total_messages = 0
    total_tool_calls = 0
    total_events = 0
    daily_stats = {} # day -> {sessions, messages, tools}
    
    if not os.path.isdir(GEMINI_CHATS_DIR):
        return {"models": [], "tools": [], "daily": [], "totals": {}, "loading": False}

    for filename in os.listdir(GEMINI_CHATS_DIR):
        if not filename.endswith(".json") or not filename.startswith("session-"):
            continue
        
        full_path = os.path.join(GEMINI_CHATS_DIR, filename)
        try:
            with open(full_path, 'r') as f:
                data = json.load(f)
            
            messages = data.get("messages", [])
            start_time = data.get("startTime")
            day = start_time[:10] if start_time and len(start_time) >= 10 else None
            
            if day:
                if day not in daily_stats:
                    daily_stats[day] = {"day": day, "sessions": 0, "messages": 0, "tools": 0}
                daily_stats[day]["sessions"] += 1
            
            for msg in messages:
                total_events += 1
                m_type = msg.get("type")
                if m_type == "user":
                    total_messages += 1
                    if day: daily_stats[day]["messages"] += 1
                elif m_type == "gemini":
                    total_turns += 1
                    model = msg.get("model", "unknown")
                    model_totals[model] += 1
                    
                    if msg.get("toolCalls"):
                        tcalls = msg["toolCalls"]
                        total_tool_calls += len(tcalls)
                        if day: daily_stats[day]["tools"] += len(tcalls)
                        for tc in tcalls:
                            t_name = tc.get("function", {}).get("name", "unknown")
                            tool_totals[t_name] += 1
        except Exception:
            continue

    # Format for UI
    models_list = [{"name": m, "count": c} for m, c in model_totals.items()]
    tools_list = [{"name": t, "count": c} for t, c in tool_totals.items()]
    daily_list = sorted(daily_stats.values(), key=lambda x: x["day"])
    
    return {
        "models": models_list,
        "tools": tools_list,
        "daily": daily_list,
        "totals": {
            "sessions": len([f for f in os.listdir(GEMINI_CHATS_DIR) if f.startswith("session-")]),
            "messages": total_messages,
            "turns": total_turns,
            "tool_calls": total_tool_calls,
            "events": total_events,
        }
    }


@app.route("/api/gemini/usage")
def api_gemini_usage():
    with _bg_lock:
        data = _bg_cache.get('gemini_usage')
    if data is None:
        return jsonify({"models": [], "tools": [], "daily": [], "totals": {}, "loading": True})
    return jsonify(data)


@app.route("/gemini/session/<session_id>")
def gemini_session_detail_page(session_id):
    return jsonify({
        "error": "UI moved to savant-app client renderer",
        "mode": "gemini",
        "session_id": session_id,
    }), 410


@app.route("/api/claude/usage")
def api_claude_usage():
    with _bg_lock:
        data = _bg_cache.get('claude_usage')
    if data is None:
        return jsonify({"models": [], "tools": [], "daily": [], "totals": {}, "loading": True})
    return jsonify(data)


@app.route("/api/codex/usage")
def api_codex_usage():
    with _bg_lock:
        data = _bg_cache.get('codex_usage')
    if data is None:
        return jsonify({"models": [], "tools": [], "daily": [], "totals": {}, "loading": True})
    return jsonify(data)


@app.route("/claude/session/<session_id>")
def claude_session_detail_page(session_id):
    return jsonify({
        "error": "UI moved to savant-app client renderer",
        "mode": "claude",
        "session_id": session_id,
    }), 410


# ───────────────────────────────────────────────────────────────────────────
# Hermes session parsing
# ───────────────────────────────────────────────────────────────────────────

_SAVANT_SEED_MARKER_RE = re.compile(
    r"\[\[SAVANT:WS=(?P<ws>[^;\]]+)(?:;NAME=(?P<name>[^;\]]+))?(?:;LAUNCH=(?P<launch>[^\]]+))?\]\]"
)


def _hermes_extract_savant_seed_marker(text: str) -> tuple[str, dict | None]:
    """Return (clean_text, marker_info) if a Savant seed marker exists in text.

    Marker format:
      [[SAVANT:WS=<workspace_id>;NAME=<session_name>;LAUNCH=<launch_id>]]

    NAME and LAUNCH are optional. The marker is stripped from returned text.
    """
    if not isinstance(text, str) or not text:
        return text, None

    m = _SAVANT_SEED_MARKER_RE.search(text)
    if not m:
        return text, None

    ws_id = (m.group("ws") or "").strip()
    name = (m.group("name") or "").strip()
    launch_id = (m.group("launch") or "").strip()

    cleaned = _SAVANT_SEED_MARKER_RE.sub("", text).strip()
    marker = {
        "workspace_id": ws_id,
        "name": name,
        "launch_id": launch_id,
    }
    return cleaned, marker


def _hermes_read_session_meta(session_id: str) -> dict:
    """Read Savant metadata for a Hermes session."""
    os.makedirs(HERMES_META_DIR, exist_ok=True)
    meta_path = os.path.join(HERMES_META_DIR, f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return {"workspace": None, "starred": False, "archived": False}
    try:
        with open(meta_path) as f:
            return json.load(f)
    except Exception:
        return {"workspace": None, "starred": False, "archived": False}


def _hermes_write_session_meta(session_id: str, meta: dict):
    """Write Savant metadata for a Hermes session."""
    os.makedirs(HERMES_META_DIR, exist_ok=True)
    meta_path = os.path.join(HERMES_META_DIR, f"{session_id}.json")
    try:
        with open(meta_path, "w") as f:
            json.dump(meta, f)
    except Exception as e:
        logger.error(f"Error writing Hermes meta {session_id}: {e}")


def _hermes_find_session_file(session_id: str) -> str | None:
    """Find the session JSON file for a Hermes session."""
    # Session files follow pattern: session_<session_id>.json
    candidate = os.path.join(HERMES_SESSIONS_DIR, f"session_{session_id}.json")
    if os.path.isfile(candidate):
        return candidate
    # Also try without the session_ prefix
    candidate2 = os.path.join(HERMES_SESSIONS_DIR, f"{session_id}.json")
    if os.path.isfile(candidate2):
        return candidate2
    return None


def _hermes_load_session(session_id: str) -> dict | None:
    """Load a Hermes session JSON file."""
    path = _hermes_find_session_file(session_id)
    if not path:
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading Hermes session {session_id}: {e}")
        return None


def _hermes_extract_tools_from_messages(messages: list) -> tuple[set, int, dict]:
    """Extract tool names, total tool call count, and tool call counts from messages."""
    tools_used = set()
    tool_call_count = 0
    tool_call_counts = {}
    for msg in messages:
        if msg.get("role") == "assistant":
            for tc in (msg.get("tool_calls") or []):
                fn = tc.get("function", {})
                name = fn.get("name", "")
                if name:
                    tools_used.add(name)
                    tool_call_count += 1
                    tool_call_counts[name] = tool_call_counts.get(name, 0) + 1
    return tools_used, tool_call_count, tool_call_counts


def _hermes_build_session_chains() -> dict:
    """Build parent→tip chains from state.db. Returns {root_id: {root_id, tip_id, chain: [ids]}}.

    When state.db exists, uses parent_session_id to build chains.
    Only root sessions (no parent) become entries.  Child/tip sessions are
    folded into their root's chain list.

    When state.db is absent, falls back to treating each JSON file as standalone.
    """
    if os.path.isfile(HERMES_STATE_DB):
        try:
            import sqlite3
            conn = sqlite3.connect(HERMES_STATE_DB)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT id, parent_session_id, end_reason, message_count, title, model, "
                "input_tokens, output_tokens, estimated_cost_usd, tool_call_count, "
                "started_at FROM sessions ORDER BY started_at"
            ).fetchall()
            conn.close()

            # Build lookup: id -> row, parent_id -> children
            by_id = {r["id"]: dict(r) for r in rows}
            children_of = {}  # parent_id -> [child_ids]
            for r in rows:
                pid = r["parent_session_id"]
                if pid:
                    children_of.setdefault(pid, []).append(r["id"])

            # Find roots (sessions with no parent, or whose parent is not in by_id)
            roots = [sid for sid, r in by_id.items()
                     if not r.get("parent_session_id") or r["parent_session_id"] not in by_id]

            chains = {}
            for root_id in roots:
                chain = [root_id]
                current = root_id
                while current in children_of:
                    kids = children_of[current]
                    # Pick the child (there should be exactly one per checkpoint model)
                    current = kids[0]
                    chain.append(current)
                tip_id = chain[-1]
                chains[root_id] = {
                    "root_id": root_id,
                    "tip_id": tip_id,
                    "chain": chain,
                    "db_rows": {sid: by_id[sid] for sid in chain if sid in by_id},
                }
            return chains

        except Exception as e:
            logger.error(f"Error reading Hermes state.db: {e}")
            # Fall through to fallback

    # Fallback: each JSON file is a standalone session
    chains = {}
    if os.path.isdir(HERMES_SESSIONS_DIR):
        for filename in os.listdir(HERMES_SESSIONS_DIR):
            if not filename.endswith(".json") or not filename.startswith("session_"):
                continue
            sid = filename[len("session_"):-len(".json")]
            chains[sid] = {"root_id": sid, "tip_id": sid, "chain": [sid], "db_rows": {}}
    return chains


def _hermes_resolve_session_id(session_id: str) -> tuple[str, dict | None]:
    """Resolve any session_id (root, child, or tip) to (root_id, chain_info).

    Returns (root_id, chain_info) where chain_info has root_id, tip_id, chain list.
    If the session_id is not found, returns (session_id, None).
    """
    chains = _hermes_build_session_chains()

    # Direct hit: session_id is a root
    if session_id in chains:
        return session_id, chains[session_id]

    # Search: session_id might be a child or tip in some chain
    for root_id, info in chains.items():
        if session_id in info["chain"]:
            return root_id, info

    return session_id, None


def _hermes_compute_activity_buckets(all_messages_with_timestamps: list, session_start: str, session_end: str) -> list:
    """Compute 24-element activity buckets from message timestamps.

    Divides the session duration into 24 equal time buckets and counts
    messages in each, producing a sparkline array for the frontend.

    all_messages_with_timestamps: list of (role, timestamp_str) tuples
    session_start, session_end: ISO timestamp strings for session boundaries
    Returns: list of 24 ints (message counts per bucket)
    """
    start_dt = parse_timestamp(session_start)
    end_dt = parse_timestamp(session_end)
    if not start_dt or not end_dt:
        return []
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)

    duration = (end_dt - start_dt).total_seconds()
    if duration <= 0:
        # All activity in a single instant — put everything in first bucket
        return [len(all_messages_with_timestamps)] + [0] * 23 if all_messages_with_timestamps else []

    bucket_size = duration / 24.0
    buckets = [0] * 24

    for _role, ts_str in all_messages_with_timestamps:
        ts_dt = parse_timestamp(ts_str)
        if not ts_dt:
            continue
        if ts_dt.tzinfo is None:
            ts_dt = ts_dt.replace(tzinfo=timezone.utc)
        offset = (ts_dt - start_dt).total_seconds()
        idx = min(int(offset / bucket_size), 23)
        if idx < 0:
            idx = 0
        buckets[idx] += 1

    return buckets


def _hermes_get_last_intent(messages: list) -> str | None:
    """Extract last user intent (last user message content) from messages."""
    last_intent = None
    for msg in messages:
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                last_intent = content.strip()[:200]
    return last_intent


def _hermes_detect_has_abort(messages: list) -> bool:
    """Check if any message indicates an abort/cancellation."""
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            lower = content.lower()
            if msg.get("role") == "assistant" and any(w in lower for w in ["aborted", "cancelled", "interrupted"]):
                return True
    return False


def _hermes_compute_disk_size(chain_ids: list) -> int:
    """Compute total disk size of all session JSON files in a chain."""
    total = 0
    for sid in chain_ids:
        path = _hermes_find_session_file(sid)
        if path:
            try:
                total += os.path.getsize(path)
            except OSError:
                pass
    return total


def _hermes_extract_cwd(session_data: dict) -> str:
    """Extract the working directory from a Hermes session.

    Hermes doesn't store cwd explicitly.  We infer it from:
      1. ``workdir`` args in terminal / read_file / search_files tool calls
      2. Absolute paths referenced in tool call arguments
      3. AGENTS.md / project context paths in the system prompt

    Returns the best-guess project directory or empty string.
    """
    import re as _re

    candidates: dict[str, int] = {}  # path -> score (higher = more confident)

    messages = session_data.get("messages", [])

    for msg in messages:
        # --- assistant tool_calls ---
        if msg.get("role") == "assistant":
            for tc in msg.get("tool_calls", []):
                fn = tc.get("function", {})
                fn_name = fn.get("name", "")
                raw_args = fn.get("arguments", "")
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except (json.JSONDecodeError, TypeError):
                    args = {}
                if not isinstance(args, dict):
                    continue

                # Explicit workdir is the strongest signal
                wd = args.get("workdir", "")
                if wd and os.path.isabs(wd):
                    candidates[wd] = candidates.get(wd, 0) + 10

                # path / file args in read_file, search_files, patch, write_file
                for key in ("path", "file_path"):
                    p = args.get(key, "")
                    if p and os.path.isabs(p):
                        # Extract project root (e.g. /Users/x/Developer/org/repo)
                        root = _hermes_project_root_from_path(p)
                        if root:
                            candidates[root] = candidates.get(root, 0) + 3

                # terminal command may contain cd <path>
                if fn_name == "terminal":
                    cmd = args.get("command", "")
                    for m in _re.finditer(r'\bcd\s+(/[^\s;&|]+)', cmd):
                        root = _hermes_project_root_from_path(m.group(1))
                        if root:
                            candidates[root] = candidates.get(root, 0) + 5

        # --- tool results may contain absolute paths ---
        if msg.get("role") == "tool":
            content = msg.get("content", "")
            if isinstance(content, str):
                for m in _re.finditer(r'(/(?:Users|home)/[^\s"\'\\:]+)', content):
                    root = _hermes_project_root_from_path(m.group(1))
                    if root:
                        candidates[root] = candidates.get(root, 0) + 1

    if not candidates:
        return ""

    # Return the highest-scored candidate
    best = max(candidates, key=candidates.get)
    return best


def _hermes_project_root_from_path(path: str) -> str:
    """Given an absolute path, try to extract a plausible project root.

    Heuristic: keep up to 5 components (e.g. /Users/x/Developer/org/repo).
    If the path has more components after that, we trim to the project root.
    If fewer, return as-is (it's already a root-level path).
    Excludes hidden directories and system paths.
    """
    parts = path.rstrip("/").split("/")

    # Reject paths into hidden directories or system locations
    _EXCLUDED_SEGMENTS = {
        ".hermes", ".copilot", ".claude", ".codex", ".cache", ".config",
        ".local", ".npm", ".git", "Library", "node_modules", "tmp",
        "__pycache__", ".savant", ".savant-meta",
    }
    for p in parts:
        if p in _EXCLUDED_SEGMENTS:
            return ""

    # Look for common dev directory markers
    for marker in ("Developer", "Projects", "repos", "src", "workspace"):
        if marker in parts:
            idx = parts.index(marker)
            # Developer typically has org/repo (2 levels), others just repo (1 level)
            depth = 3 if marker == "Developer" else 2
            end = min(idx + depth, len(parts))
            candidate = "/".join(parts[:end])
            if len(candidate) > 3:
                return candidate
    # Fallback: /home/user/project paths (not macOS)
    if len(parts) >= 4 and parts[1] == "home":
        return "/".join(parts[:4])
    return ""


def hermes_get_all_sessions() -> list[dict]:
    """Gather Hermes sessions from ~/.hermes/sessions/, grouped by checkpoint chains.

    Uses state.db to identify parent→child chains and collapses them into
    single logical sessions.  The root_id is used as the canonical session ID,
    data is drawn from the tip (latest checkpoint), and tool/message stats are
    aggregated across the entire chain.
    """
    if not os.path.isdir(HERMES_SESSIONS_DIR):
        return []

    chains = _hermes_build_session_chains()
    sessions = []

    for root_id, chain_info in chains.items():
        tip_id = chain_info["tip_id"]
        chain_ids = chain_info["chain"]

        # Load the root session (for created timestamp and initial user message)
        root_data = _hermes_load_session(root_id)
        # Load the tip session (for latest data)
        tip_data = _hermes_load_session(tip_id) if tip_id != root_id else root_data

        if not tip_data:
            # Tip JSON missing; try root
            if not root_data:
                continue
            tip_data = root_data

        if not root_data:
            root_data = tip_data

        model = tip_data.get("model", "unknown")
        platform = tip_data.get("platform", "cli")
        session_start = root_data.get("session_start", "")
        last_updated = tip_data.get("last_updated", session_start)

        # Aggregate messages, tools, counts across all chain sessions
        all_tools_used = set()
        total_tool_calls = 0
        total_user_count = 0
        total_message_count = 0
        summary = ""
        user_msgs = []
        models_seen = set()
        model_call_counts = {}
        tool_call_counts = {}
        all_messages_flat = []  # for activity buckets
        last_intent = None
        has_abort = False
        last_event_type = None
        seed_workspace_id = ""
        seed_session_name = ""

        for sid in chain_ids:
            sdata = _hermes_load_session(sid) if sid != tip_id else tip_data
            if sid == root_id and root_data:
                sdata = root_data
            if not sdata:
                continue
            msgs = sdata.get("messages", [])
            total_message_count += len(msgs)
            m = sdata.get("model", "")
            if m:
                models_seen.add(m)

            s_start = sdata.get("session_start", "")
            s_end = sdata.get("last_updated", s_start)

            for msg in msgs:
                role = msg.get("role", "")
                if role == "user":
                    content = msg.get("content", "")
                    clean_content, marker = _hermes_extract_savant_seed_marker(content)
                    if marker:
                        if marker.get("workspace_id") and not seed_workspace_id:
                            seed_workspace_id = marker["workspace_id"]
                        if marker.get("name") and not seed_session_name:
                            seed_session_name = marker["name"]
                    if isinstance(clean_content, str) and clean_content.strip():
                        if not summary:
                            summary = clean_content[:140]
                        user_msgs.append({"content": clean_content[:200], "timestamp": sdata.get("session_start", "")})
                        last_intent = clean_content.strip()[:200]
                    total_user_count += 1
                elif role == "assistant":
                    m_name = sdata.get("model", "unknown")
                    model_call_counts[m_name] = model_call_counts.get(m_name, 0) + 1

                # Track last event type
                if role:
                    last_event_type = role

                # Distribute message timestamps across session span for buckets
                if s_start:
                    all_messages_flat.append((role, s_start))

            # Check for abort
            if not has_abort:
                has_abort = _hermes_detect_has_abort(msgs)

            t_used, t_count, t_counts = _hermes_extract_tools_from_messages(msgs)
            all_tools_used |= t_used
            total_tool_calls += t_count
            for tn, tc in t_counts.items():
                tool_call_counts[tn] = tool_call_counts.get(tn, 0) + tc

        if not summary:
            # Try title from state.db
            db_rows = chain_info.get("db_rows", {})
            for sid in reversed(chain_ids):
                row = db_rows.get(sid, {})
                if row.get("title"):
                    summary = row["title"]
                    break
            if not summary:
                summary = f"Hermes Session ({model})"

        # Meta is stored under root_id
        meta = _hermes_read_session_meta(root_id)

        # Auto-attach workspace/nickname from Savant seed marker when present.
        # This allows "create session from workspace" to bind new sessions without
        # requiring a second manual assignment step.
        meta_changed = False
        if seed_workspace_id and not meta.get("workspace") and WorkspaceDB.get_by_id(seed_workspace_id):
            meta["workspace"] = seed_workspace_id
            meta_changed = True
        if seed_session_name and not meta.get("nickname"):
            meta["nickname"] = seed_session_name
            meta_changed = True
        if meta_changed:
            _hermes_write_session_meta(root_id, meta)

        # Determine status from tip's last_updated
        status = "COMPLETED"
        is_open = False
        lu_dt = parse_timestamp(last_updated)
        if lu_dt and lu_dt.tzinfo is None:
            lu_dt = lu_dt.replace(tzinfo=timezone.utc)
        if lu_dt and (datetime.now(timezone.utc) - lu_dt).total_seconds() < 600:
            status = "RUNNING"
            is_open = True

        tip_path = _hermes_find_session_file(tip_id) or ""

        # Compute enriched fields
        checkpoint_count = max(0, len(chain_ids) - 1)
        disk_size = _hermes_compute_disk_size(chain_ids)

        # Extract cwd from session data (Hermes doesn't store it explicitly)
        cwd = _hermes_extract_cwd(root_data or tip_data)
        resume_command = f"cd {cwd} && hermes --resume {root_id}" if cwd else f"hermes --resume {root_id}"

        activity_buckets = _hermes_compute_activity_buckets(
            all_messages_flat, session_start, last_updated
        )

        # Token/cost aggregation from state.db rows
        db_rows = chain_info.get("db_rows", {})
        input_tokens = sum(r.get("input_tokens", 0) or 0 for r in db_rows.values())
        output_tokens = sum(r.get("output_tokens", 0) or 0 for r in db_rows.values())
        estimated_cost_usd = sum(r.get("estimated_cost_usd", 0) or 0 for r in db_rows.values())

        sessions.append({
            "id": root_id,
            "provider": "hermes",
            "project": os.path.basename(cwd) if cwd else "",
            "project_path": cwd,
            "cwd": cwd,
            "summary": meta.get("nickname") or summary,
            "modified": last_updated,
            "created": session_start,
            "updated_at": last_updated,
            "created_at": session_start,
            "path": tip_path,
            "session_path": tip_path,
            "message_count": total_message_count,
            "turn_count": total_user_count,
            "user_messages": user_msgs[:3],
            "workspace": meta.get("workspace"),
            "starred": meta.get("starred", False),
            "archived": meta.get("archived", False),
            "nickname": meta.get("nickname", ""),
            "status": status,
            "is_open": is_open,
            "model": model,
            "models": sorted(models_seen),
            "platform": platform,
            "tools_used": sorted(all_tools_used)[:8],
            "tool_call_count": total_tool_calls,
            "event_count": total_message_count,
            "git_commit_count": 0,
            # ── Enriched fields (parity with Copilot/Claude) ──
            "model_call_counts": model_call_counts,
            "tool_call_counts": tool_call_counts,
            "activity_buckets": activity_buckets,
            "checkpoint_count": checkpoint_count,
            "disk_size": disk_size,
            "file_count": len(chain_ids),  # number of session files
            "resume_command": resume_command,
            "first_event_time": session_start or None,
            "last_event_time": last_updated or None,
            "last_event_type": last_event_type,
            "last_intent": last_intent,
            "has_abort": has_abort,
            "active_tools": [],  # Hermes doesn't have persistent tool processes
            "notes": meta.get("notes", []),
            "jira_tickets": meta.get("jira_tickets", []),
            "mrs": meta.get("mrs", []),
            "has_plan_file": False,
            "research_count": 0,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost_usd": estimated_cost_usd,
        })

    sessions.sort(key=lambda x: x.get("modified", ""), reverse=True)
    return sessions


def _hermes_build_session_tree(chain_ids, db_rows, root_id):
    """Build a tree dict with checkpoints, rewind_snapshots, files, and plan.

    For Hermes, chain segments (child sessions) become virtual checkpoints.
    Each session file on disk contributes to ``files``.
    ``rewind_snapshots`` is always empty (Hermes doesn't have Claude-style rewinds).
    ``plan`` is None (Hermes doesn't persist plan files in a session dir).
    """
    checkpoints = []
    files = []
    hermes_dir = os.path.expanduser("~/.hermes/sessions")

    for i, sid in enumerate(chain_ids):
        # Build the session file path
        fname = f"session_{sid}.json"
        fpath = os.path.join(hermes_dir, fname)
        size = 0
        mtime = ""
        try:
            if os.path.isfile(fpath):
                st = os.stat(fpath)
                size = st.st_size
                mtime = datetime.fromtimestamp(
                    st.st_mtime, tz=timezone.utc
                ).isoformat()
        except OSError:
            pass

        # Every session file is a "file" in the tree
        files.append({
            "name": fname,
            "path": fpath,
            "size": size,
            "mtime": mtime,
        })

        # Only non-root sessions are checkpoints (chain continuation points)
        if i > 0:
            db_row = db_rows.get(sid, {}) if db_rows else {}
            label = db_row.get("title", "") or f"Checkpoint {i}"
            checkpoints.append({
                "name": label,
                "path": fpath,
                "mtime": mtime,
                "size": size,
            })

    return {
        "files": files,
        "checkpoints": checkpoints,
        "rewind_snapshots": [],
        "plan": None,
        "total_size": sum(f["size"] for f in files),
    }


def hermes_get_session_detail(session_id: str) -> dict | None:
    """Get detailed info for a single Hermes session (chain-aware).

    Resolves any session_id (root, child, or tip) to the full chain,
    aggregates stats across the chain, and uses root_id as canonical ID.
    """
    root_id, chain_info = _hermes_resolve_session_id(session_id)

    if chain_info:
        chain_ids = chain_info["chain"]
        tip_id = chain_info["tip_id"]
    else:
        # No chain info — try loading directly (backward compat)
        chain_ids = [session_id]
        tip_id = session_id
        root_id = session_id

    # Load root and tip data
    root_data = _hermes_load_session(root_id)
    tip_data = _hermes_load_session(tip_id) if tip_id != root_id else root_data

    if not tip_data and not root_data:
        return None
    if not tip_data:
        tip_data = root_data
    if not root_data:
        root_data = tip_data

    model = tip_data.get("model", "unknown")
    platform = tip_data.get("platform", "cli")
    session_start = root_data.get("session_start", "")
    last_updated = tip_data.get("last_updated", session_start)

    # Aggregate across chain
    all_tools_used = set()
    total_tool_calls = 0
    total_user_count = 0
    total_message_count = 0
    total_assistant_count = 0
    tool_call_counts = {}
    model_call_counts = {}
    summary = ""
    user_msgs = []
    models_seen = set()
    all_messages_flat = []  # for activity buckets
    last_intent = None
    has_abort = False
    last_event_type = None
    seed_workspace_id = ""
    seed_session_name = ""

    for sid in chain_ids:
        if sid == tip_id:
            sdata = tip_data
        elif sid == root_id:
            sdata = root_data
        else:
            sdata = _hermes_load_session(sid)
        if not sdata:
            continue

        msgs = sdata.get("messages", [])
        total_message_count += len(msgs)
        m = sdata.get("model", "")
        if m:
            models_seen.add(m)

        s_start = sdata.get("session_start", "")

        for msg in msgs:
            role = msg.get("role", "")
            if role == "user":
                content = msg.get("content", "")
                clean_content, marker = _hermes_extract_savant_seed_marker(content)
                if marker:
                    if marker.get("workspace_id") and not seed_workspace_id:
                        seed_workspace_id = marker["workspace_id"]
                    if marker.get("name") and not seed_session_name:
                        seed_session_name = marker["name"]
                if isinstance(clean_content, str) and clean_content.strip():
                    if not summary:
                        summary = clean_content[:140]
                    user_msgs.append({"content": clean_content[:200], "timestamp": sdata.get("session_start", "")})
                    last_intent = clean_content.strip()[:200]
                total_user_count += 1
            elif role == "assistant":
                total_assistant_count += 1
                m_name = sdata.get("model", "unknown")
                model_call_counts[m_name] = model_call_counts.get(m_name, 0) + 1

            # Track last event type
            if role:
                last_event_type = role

            # Distribute message timestamps across session span for buckets
            if s_start:
                all_messages_flat.append((role, s_start))

        # Check for abort
        if not has_abort:
            has_abort = _hermes_detect_has_abort(msgs)

        t_used, t_count, t_counts = _hermes_extract_tools_from_messages(msgs)
        all_tools_used |= t_used
        total_tool_calls += t_count
        for tn, tc in t_counts.items():
            tool_call_counts[tn] = tool_call_counts.get(tn, 0) + tc

    if not summary:
        # Try title from state.db
        db_rows = chain_info.get("db_rows", {}) if chain_info else {}
        for sid in reversed(chain_ids):
            row = db_rows.get(sid, {})
            if row.get("title"):
                summary = row["title"]
                break
        if not summary:
            summary = f"Hermes Session ({model})"

    meta = _hermes_read_session_meta(root_id)

    # Mirror auto-attach logic used in list view so detail view stays consistent.
    meta_changed = False
    if seed_workspace_id and not meta.get("workspace") and WorkspaceDB.get_by_id(seed_workspace_id):
        meta["workspace"] = seed_workspace_id
        meta_changed = True
    if seed_session_name and not meta.get("nickname"):
        meta["nickname"] = seed_session_name
        meta_changed = True
    if meta_changed:
        _hermes_write_session_meta(root_id, meta)

    status = "COMPLETED"
    lu_dt = parse_timestamp(last_updated)
    if lu_dt and lu_dt.tzinfo is None:
        lu_dt = lu_dt.replace(tzinfo=timezone.utc)
    if lu_dt and (datetime.now(timezone.utc) - lu_dt).total_seconds() < 600:
        status = "RUNNING"

    # Compute enriched fields
    checkpoint_count = max(0, len(chain_ids) - 1)
    disk_size = _hermes_compute_disk_size(chain_ids)

    # Extract cwd from session data (Hermes doesn't store it explicitly)
    cwd = _hermes_extract_cwd(root_data or tip_data)
    resume_command = f"cd {cwd} && hermes --resume {root_id}" if cwd else f"hermes --resume {root_id}"

    activity_buckets = _hermes_compute_activity_buckets(
        all_messages_flat, session_start, last_updated
    )

    # Token/cost aggregation from state.db rows
    db_rows = chain_info.get("db_rows", {}) if chain_info else {}
    input_tokens = sum(r.get("input_tokens", 0) or 0 for r in db_rows.values())
    output_tokens = sum(r.get("output_tokens", 0) or 0 for r in db_rows.values())
    estimated_cost_usd = sum(r.get("estimated_cost_usd", 0) or 0 for r in db_rows.values())

    # ── Build tree with virtual checkpoints from chain segments ──
    tree = _hermes_build_session_tree(chain_ids, db_rows, root_id)

    return {
        "id": root_id,
        "provider": "hermes",
        "summary": meta.get("nickname") or summary,
        "nickname": meta.get("nickname", ""),
        "workspace": meta.get("workspace"),
        "starred": meta.get("starred", False),
        "archived": meta.get("archived", False),
        "status": status,
        "model": model,
        "models": sorted(models_seen),
        "platform": platform,
        "modified": last_updated,
        "created": session_start,
        "updated_at": last_updated,
        "created_at": session_start,
        "message_count": total_message_count,
        "turn_count": total_user_count,
        "user_messages": user_msgs[:5],
        "tools_used": sorted(all_tools_used),
        "tool_call_count": total_tool_calls,
        "tool_call_counts": tool_call_counts,
        "model_call_counts": model_call_counts,
        "event_count": total_message_count,
        "git_commit_count": 0,
        "is_open": status == "RUNNING",
        "project": os.path.basename(cwd) if cwd else "",
        "project_path": cwd,
        "cwd": cwd,
        # ── Enriched fields (parity with Copilot/Claude) ──
        "tree": tree,
        "activity_buckets": activity_buckets,
        "checkpoint_count": checkpoint_count,
        "disk_size": disk_size,
        "file_count": len(tree.get("files", [])),
        "resume_command": resume_command,
        "first_event_time": session_start or None,
        "last_event_time": last_updated or None,
        "last_event_type": last_event_type,
        "last_intent": last_intent,
        "has_abort": has_abort,
        "active_tools": [],
        "notes": meta.get("notes", []),
        "jira_tickets": meta.get("jira_tickets", []),
        "mrs": meta.get("mrs", []),
        "has_plan_file": False,
        "research_count": 0,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": estimated_cost_usd,
    }


def hermes_parse_full_conversation(session_id: str) -> tuple:
    """Parse a Hermes session into a conversation list, tool map, and stats.

    Chain-aware: merges messages from all sessions in the parent chain.

    Returns the same shape as claude_parse_full_conversation():
      - conversation: list of dicts with ``type`` field (user_message,
        assistant_message, tool_start) — NOT ``role``.
      - tool_map: keyed by call_id, each value has name/args/result/success.
      - stats: user_messages, assistant_messages, tool_calls,
        tool_success_rate, avg_response_length, files_created, files_edited.
    """
    root_id, chain_info = _hermes_resolve_session_id(session_id)

    if chain_info:
        chain_ids = chain_info["chain"]
    else:
        chain_ids = [session_id]
        root_id = session_id

    conversation = []
    tool_map = {}
    stats = {
        "user_messages": 0,
        "assistant_messages": 0,
        "assistant_chars": 0,
        "tool_calls": 0,
        "tool_successes": 0,
        "tool_failures": 0,
        "files_created": [],
        "files_edited": [],
    }
    models_seen = set()

    for sid in chain_ids:
        data = _hermes_load_session(sid)
        if not data:
            continue

        messages = data.get("messages", [])
        model = data.get("model", "unknown")
        if model:
            models_seen.add(model)
        session_start = data.get("session_start", "")
        last_updated = data.get("last_updated", session_start)

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")

            if role == "user":
                text = content if isinstance(content, str) else str(content)
                conversation.append({
                    "type": "user_message",
                    "content": text,
                    "timestamp": session_start,
                })
                stats["user_messages"] += 1

            elif role == "assistant":
                text = content if isinstance(content, str) else ""
                tool_calls_raw = msg.get("tool_calls") or []
                tool_requests = []
                for tc in tool_calls_raw:
                    fn = tc.get("function", {})
                    call_id = tc.get("id", tc.get("call_id", ""))
                    tool_name = fn.get("name", "")
                    args_str = fn.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except Exception:
                        args = {}
                    tool_requests.append({
                        "call_id": call_id,
                        "tool_name": tool_name,
                        "arguments": args,
                    })
                    tool_map[call_id] = {
                        "name": tool_name,
                        "args": args,
                        "result": None,
                        "success": None,
                        "model": model,
                        "start_ts": last_updated,
                    }
                    stats["tool_calls"] += 1

                    # Track file changes
                    fpath = args.get("path", args.get("file_path", ""))
                    if tool_name in ("write_file",) and fpath:
                        if fpath not in stats["files_created"]:
                            stats["files_created"].append(fpath)
                    elif tool_name in ("patch", "edit") and fpath:
                        if fpath not in stats["files_edited"]:
                            stats["files_edited"].append(fpath)

                conversation.append({
                    "type": "assistant_message",
                    "content": text,
                    "tool_requests": tool_requests,
                    "model": model,
                    "timestamp": last_updated,
                })
                stats["assistant_messages"] += 1
                stats["assistant_chars"] += len(text)

                # Emit tool_start entries AFTER the assistant message
                for tr in tool_requests:
                    conversation.append({
                        "type": "tool_start",
                        "call_id": tr["call_id"],
                        "tool_name": tr["tool_name"],
                        "timestamp": last_updated,
                    })

            elif role == "tool":
                call_id = msg.get("tool_call_id", "")
                result_content = content if isinstance(content, str) else str(content)
                # Determine success heuristic: non-empty result without
                # obvious error markers is considered success
                is_error = False
                if result_content:
                    lower = result_content.lower()[:500]
                    is_error = any(
                        marker in lower
                        for marker in ("error:", "traceback", "exception", "failed", "command not found")
                    )
                if call_id and call_id in tool_map:
                    tool_map[call_id]["result"] = result_content[:5000]
                    tool_map[call_id]["success"] = not is_error
                    if is_error:
                        stats["tool_failures"] += 1
                    else:
                        stats["tool_successes"] += 1

    # Compute derived stats (same as claude_parse_full_conversation)
    stats["avg_response_length"] = round(
        stats["assistant_chars"] / max(stats["assistant_messages"], 1)
    )
    stats["tool_success_rate"] = round(
        stats["tool_successes"] / max(stats["tool_calls"], 1) * 100, 1
    )
    stats["files_created"] = stats["files_created"][:50]
    stats["files_edited"] = stats["files_edited"][:50]

    return conversation, tool_map, stats


def _build_hermes_usage():
    """Build Hermes usage data from session chains (no double-counting).

    Uses state.db chains to identify logical sessions.  Counts each chain
    as one session.  Aggregates tool/message stats across chain members.
    Token counts come from state.db when available.

    Returns the same shape as _build_copilot_usage() so the frontend
    renderUsage() / fetchMcp() work identically for all providers.
    """
    model_totals = Counter()
    tool_totals = Counter()
    total_turns = 0
    total_messages = 0
    total_tool_calls = 0
    total_events = 0
    total_input_tokens = 0
    total_output_tokens = 0
    daily_stats = {}
    session_durations = []  # in minutes

    if not os.path.isdir(HERMES_SESSIONS_DIR):
        return {"models": [], "tools": [], "daily": [], "totals": {}, "loading": False}

    chains = _hermes_build_session_chains()
    session_count = len(chains)

    for root_id, chain_info in chains.items():
        chain_ids = chain_info["chain"]
        db_rows = chain_info.get("db_rows", {})

        # Sum tokens from state.db rows
        for sid, row in db_rows.items():
            total_input_tokens += row.get("input_tokens", 0) or 0
            total_output_tokens += row.get("output_tokens", 0) or 0

        # Get day from root session's start time
        root_data = _hermes_load_session(root_id)
        start_time = root_data.get("session_start", "") if root_data else ""
        day = start_time[:10] if start_time and len(start_time) >= 10 else None

        if day:
            if day not in daily_stats:
                daily_stats[day] = {"date": day, "sessions": 0, "messages": 0, "tools": 0, "turns": 0}
            daily_stats[day]["sessions"] += 1

        # Calculate session duration from first session_start to last last_updated
        chain_start = None
        chain_end = None
        for sid in chain_ids:
            sdata = _hermes_load_session(sid) if sid != root_id else root_data
            if not sdata:
                continue
            s_start = sdata.get("session_start", "")
            s_end = sdata.get("last_updated", "") or s_start
            if s_start:
                try:
                    t1 = datetime.fromisoformat(s_start)
                    if chain_start is None or t1 < chain_start:
                        chain_start = t1
                except (ValueError, TypeError):
                    pass
            if s_end:
                try:
                    t2 = datetime.fromisoformat(s_end)
                    if chain_end is None or t2 > chain_end:
                        chain_end = t2
                except (ValueError, TypeError):
                    pass
        if chain_start and chain_end and chain_end > chain_start:
            dur = (chain_end - chain_start).total_seconds() / 60.0
            session_durations.append(dur)

        for sid in chain_ids:
            sdata = _hermes_load_session(sid) if sid != root_id else root_data
            if not sdata:
                continue
            messages = sdata.get("messages", [])
            model = sdata.get("model", "unknown")

            for msg in messages:
                total_events += 1
                role = msg.get("role")
                if role == "user":
                    total_messages += 1
                    if day and day in daily_stats:
                        daily_stats[day]["messages"] += 1
                elif role == "assistant":
                    total_turns += 1
                    model_totals[model] += 1
                    if day and day in daily_stats:
                        daily_stats[day]["turns"] += 1
                    for tc in (msg.get("tool_calls") or []):
                        fn = tc.get("function", {})
                        t_name = fn.get("name", "unknown")
                        total_tool_calls += 1
                        tool_totals[t_name] += 1
                        if day and day in daily_stats:
                            daily_stats[day]["tools"] += 1

    # Use 'calls' key to match copilot/claude/codex format (frontend expects .calls)
    models_list = [{"name": m, "calls": c} for m, c in model_totals.most_common()]
    tools_list = [{"name": t, "calls": c} for t, c in tool_totals.most_common(25)]
    daily_list = sorted(daily_stats.values(), key=lambda x: x["date"])

    # Efficiency metrics (same as copilot)
    avg_tools_per_turn = round(total_tool_calls / max(total_turns, 1), 1)
    avg_turns_per_msg = round(total_turns / max(total_messages, 1), 1)
    total_hours = round(sum(session_durations) / 60.0, 1)
    avg_session_min = round(sum(session_durations) / max(len(session_durations), 1), 0)

    return {
        "models": models_list,
        "tools": tools_list,
        "daily": daily_list,
        "totals": {
            "sessions": session_count,
            "messages": total_messages,
            "turns": total_turns,
            "tool_calls": total_tool_calls,
            "events": total_events,
            "total_hours": total_hours,
            "avg_session_minutes": avg_session_min,
            "avg_tools_per_turn": avg_tools_per_turn,
            "avg_turns_per_message": avg_turns_per_msg,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
        },
    }


# ── Hermes API routes ────────────────────────────────────────────────────────

@app.route("/api/hermes/sessions")
def api_hermes_sessions():
    with _bg_lock:
        all_sessions = _bg_cache.get('hermes_sessions')
    if all_sessions is None:
        all_sessions = hermes_get_all_sessions()
        with _bg_lock:
            _bg_cache['hermes_sessions'] = all_sessions
    limit = safe_limit(request.args.get("limit", 30, type=int), 100)
    offset = max(0, request.args.get("offset", 0, type=int) or 0)
    paginated = all_sessions[offset:offset + limit]
    return jsonify({
        "sessions": paginated,
        "total": len(all_sessions),
        "has_more": len(all_sessions) > (offset + limit),
    })


@app.route("/api/hermes/session/<session_id>")
def api_hermes_session_detail(session_id):
    info = hermes_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(info)


@app.route("/api/hermes/session/<session_id>/convert-prompt")
def api_hermes_convert_prompt(session_id):
    """Generate a handoff prompt from a Hermes session."""
    info = hermes_get_session_detail(session_id)
    if not info:
        return jsonify({"error": "Session not found"}), 404
    try:
        _, _, stats = hermes_parse_full_conversation(session_id)
    except Exception:
        stats = {}
    prompt = build_convert_prompt(info, stats, provider="hermes")
    return jsonify({"prompt": prompt, "session_id": session_id, "char_count": len(prompt)})


@app.route("/api/hermes/session/<session_id>/conversation")
def api_hermes_session_conversation(session_id):
    """Full parsed conversation with stats for Hermes."""
    conversation, tool_map, stats = hermes_parse_full_conversation(session_id)
    return jsonify({
        "conversation": conversation,
        "tools": tool_map,
        "stats": stats,
    })


@app.route("/api/hermes/session/<session_id>/workspace", methods=["POST"])
def api_hermes_session_workspace(session_id):
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    if not _hermes_find_session_file(root_id):
        return jsonify({"error": "Not a Hermes session"}), 404
    data = request.get_json(force=True)
    ws_id = data.get("workspace_id")
    meta = _hermes_read_session_meta(root_id)
    meta["workspace"] = ws_id
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['workspace'] = ws_id
                    break
    if ws_id:
        _emit_event("session_assigned", f"Hermes session assigned to workspace", {"session_id": root_id, "workspace_id": ws_id})
    return jsonify({"id": root_id, "workspace": ws_id, "workspace_id": ws_id})


@app.route("/api/hermes/session/<session_id>/star", methods=["POST"])
def api_hermes_session_star(session_id):
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    if not _hermes_find_session_file(root_id):
        return jsonify({"error": "Not a Hermes session"}), 404
    meta = _hermes_read_session_meta(root_id)
    meta["starred"] = not meta.get("starred", False)
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['starred'] = meta["starred"]
                    break
    return jsonify({"id": root_id, "starred": meta["starred"]})


@app.route("/api/hermes/session/<session_id>/archive", methods=["POST"])
def api_hermes_session_archive(session_id):
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    if not _hermes_find_session_file(root_id):
        return jsonify({"error": "Not a Hermes session"}), 404
    meta = _hermes_read_session_meta(root_id)
    meta["archived"] = not meta.get("archived", False)
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['archived'] = meta["archived"]
                    break
    return jsonify({"id": root_id, "archived": meta["archived"]})


@app.route("/api/hermes/session/<session_id>/rename", methods=["POST"])
def api_hermes_session_rename(session_id):
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    if not _hermes_find_session_file(root_id):
        return jsonify({"error": "Not a Hermes session"}), 404
    data = request.get_json(force=True)
    nickname = (data.get("nickname") or "").strip()
    meta = _hermes_read_session_meta(root_id)
    if nickname:
        meta["nickname"] = nickname
    else:
        meta.pop("nickname", None)
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get("hermes_sessions") is not None:
            for s in _bg_cache["hermes_sessions"]:
                if s["id"] == root_id:
                    s["nickname"] = nickname
                    if nickname:
                        s["summary"] = nickname
                    break
    return jsonify({"id": root_id, "nickname": nickname})


@app.route("/api/hermes/session/<session_id>/notes", methods=["GET"])
def api_hermes_session_notes_get(session_id):
    try:
        full_session_id = f"hermes_{session_id}"
        notes_list = NoteDB.list_by_session(full_session_id)
        notes = [
            {
                "text": n.get("text", ""),
                "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
            }
            for n in notes_list
        ]
        return jsonify({"notes": notes})
    except Exception as e:
        logger.error(f"Error getting hermes session notes: {e}")
        return jsonify({"error": "Failed to get notes"}), 500


@app.route("/api/hermes/session/<session_id>/notes", methods=["POST"])
def api_hermes_session_notes_post(session_id):
    try:
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Note text required"}), 400
        import uuid
        note_id = f"note_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        full_session_id = f"hermes_{session_id}"
        NoteDB.create({
            "note_id": note_id,
            "session_id": full_session_id,
            "workspace_id": "",
            "text": text,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        notes_list = NoteDB.list_by_session(full_session_id)
        _emit_event("note_created", f"Note added to hermes session", {"session_id": session_id})
        return jsonify({"id": session_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})
    except Exception as e:
        logger.error(f"Error creating hermes session note: {e}")
        return jsonify({"error": "Failed to create note"}), 500


@app.route("/api/hermes/session/<session_id>/notes", methods=["DELETE"])
def api_hermes_session_notes_delete(session_id):
    try:
        data = request.get_json(force=True)
        idx = data.get("index")
        if idx is None:
            return jsonify({"error": "index required"}), 400
        full_session_id = f"hermes_{session_id}"
        notes_list = NoteDB.list_by_session(full_session_id)
        if idx < 0 or idx >= len(notes_list):
            return jsonify({"error": "index out of range"}), 400
        note_id = notes_list[idx].get("note_id")
        if note_id:
            NoteDB.delete(note_id)
        return jsonify({"id": session_id, "deleted": True})
    except Exception as e:
        logger.error(f"Error deleting hermes session note: {e}")
        return jsonify({"error": "Failed to delete note"}), 500


# ── Hermes session file endpoints ────────────────────────────────────────────

def _hermes_find_session_dir(session_id: str) -> str | None:
    """Find the artifact directory for a Hermes session.

    Hermes stores session artifacts in HERMES_SESSIONS_DIR/<session_id>/
    (a directory alongside the session JSON file).
    """
    candidate = os.path.join(HERMES_SESSIONS_DIR, session_id)
    if os.path.isdir(candidate):
        return candidate
    return None


@app.route("/api/hermes/session/<session_id>/file")
def api_hermes_session_file(session_id):
    """Read a file from a Hermes session artifact directory."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return jsonify({"error": "Invalid path"}), 400
    root_id, _ = _hermes_resolve_session_id(session_id)
    session_dir = _hermes_find_session_dir(root_id)
    if not session_dir:
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
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


@app.route("/api/hermes/session/<session_id>/file/raw")
def api_hermes_session_file_raw(session_id):
    """Serve a Hermes session file raw."""
    rel_path = request.args.get("path", "")
    if not rel_path or ".." in rel_path:
        return "Invalid path", 400
    root_id, _ = _hermes_resolve_session_id(session_id)
    session_dir = _hermes_find_session_dir(root_id)
    if not session_dir:
        return "Session not found", 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return "File not found", 404
    return send_file(full)


@app.route("/api/hermes/session/<session_id>/file", methods=["PUT"])
def api_hermes_session_file_write(session_id):
    """Write content to a Hermes session file."""
    data = request.get_json(force=True)
    rel_path = data.get("path", "")
    content = data.get("content")
    if not rel_path or ".." in rel_path or content is None:
        return jsonify({"error": "Invalid path or missing content"}), 400
    root_id, _ = _hermes_resolve_session_id(session_id)
    session_dir = _hermes_find_session_dir(root_id)
    if not session_dir:
        return jsonify({"error": "Session directory not found"}), 404
    full = os.path.realpath(os.path.join(session_dir, rel_path))
    if not full.startswith(os.path.realpath(session_dir)) or not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "w") as f:
            f.write(content)
        return jsonify({"ok": True, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/hermes/session/<session_id>/project-files")
def api_hermes_session_project_files(session_id):
    """Extract files created/edited/read during a Hermes session (chain-aware)."""
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    chain_ids = chain_info["chain"] if chain_info else [session_id]

    files_seen = {}
    cwd = ""

    for sid in chain_ids:
        data = _hermes_load_session(sid)
        if not data:
            continue

        messages = data.get("messages", [])

        for msg in messages:
            if msg.get("role") != "assistant":
                continue
            for tc in (msg.get("tool_calls") or []):
                fn = tc.get("function", {})
                tool_name = fn.get("name", "")
                args_str = fn.get("arguments", "{}")
                try:
                    args = json.loads(args_str) if isinstance(args_str, str) else args_str
                except Exception:
                    args = {}
                if not isinstance(args, dict):
                    continue

                fpath = args.get("path", args.get("file_path", ""))
                if not fpath:
                    # check for terminal/workdir
                    if tool_name == "terminal":
                        wd = args.get("workdir", "")
                        if wd and not cwd:
                            cwd = wd
                    continue
                if "/.hermes/" in fpath or "/.copilot/" in fpath or "/.claude/" in fpath:
                    continue

                action = "view"
                if tool_name in ("write_file", "skill_manage"):
                    action = "create"
                elif tool_name in ("patch",):
                    action = "edit"
                elif tool_name in ("read_file", "search_files"):
                    action = "view"
                else:
                    action = tool_name.lower() if tool_name else "view"

                ts = data.get("last_updated", "")
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
                if action in ("create", "edit"):
                    files_seen[fpath]["action"] = action

    file_list = []
    for fpath, info in files_seen.items():
        info["name"] = os.path.basename(fpath)
        info["relative"] = os.path.relpath(fpath, cwd) if cwd and fpath.startswith(cwd) else fpath
        file_list.append(info)
    file_list.sort(key=lambda x: x.get("last_seen", ""), reverse=True)
    return jsonify({"files": file_list, "cwd": cwd})


@app.route("/api/hermes/session/<session_id>/git-changes")
def api_hermes_session_git_changes(session_id):
    """Extract git commands, commits, file changes from Hermes session (chain-aware)."""
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    chain_ids = chain_info["chain"] if chain_info else [session_id]

    commits = []
    file_changes = []
    git_commands = []

    for sid in chain_ids:
        data = _hermes_load_session(sid)
        if not data:
            continue

        messages = data.get("messages", [])

        # Collect tool calls and their results
        tool_calls_by_id = {}
        tool_results_by_id = {}

        for msg in messages:
            role = msg.get("role", "")
            if role == "assistant":
                for tc in (msg.get("tool_calls") or []):
                    fn = tc.get("function", {})
                    call_id = tc.get("id", tc.get("call_id", ""))
                    tool_name = fn.get("name", "")
                    args_str = fn.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except Exception:
                        args = {}
                    tool_calls_by_id[call_id] = {"name": tool_name, "args": args if isinstance(args, dict) else {}, "ts": data.get("last_updated", "")}

                    # Track file changes from write/patch tools
                    if isinstance(args, dict):
                        fpath = args.get("path", args.get("file_path", ""))
                        if tool_name == "write_file" and fpath:
                            file_changes.append({"type": "create", "path": fpath, "timestamp": data.get("last_updated", "")})
                        elif tool_name == "patch" and fpath:
                            file_changes.append({"type": "edit", "path": fpath, "timestamp": data.get("last_updated", "")})

            elif role == "tool":
                call_id = msg.get("tool_call_id", "")
                result_text = msg.get("content", "")
                if isinstance(result_text, str):
                    tool_results_by_id[call_id] = {"content": result_text[:5000], "ts": ""}

        # Extract git commands from terminal tool calls
        for call_id, info in tool_calls_by_id.items():
            if info["name"] != "terminal":
                continue
            cmd = info["args"].get("command", "")
            if not cmd or "git " not in cmd:
                continue
            result_info = tool_results_by_id.get(call_id, {})
            result_text = result_info.get("content", "")

            cmd_type = "other"
            if "commit" in cmd:
                cmd_type = "commit"
            elif "push" in cmd:
                cmd_type = "push"
            elif "diff" in cmd:
                cmd_type = "diff"
            elif "status" in cmd:
                cmd_type = "status"
            elif "add " in cmd:
                cmd_type = "add"
            elif "checkout" in cmd or "switch" in cmd:
                cmd_type = "checkout"

            git_commands.append({
                "command": cmd[:500],
                "timestamp": info["ts"],
                "result": result_text[:3000],
                "type": cmd_type,
            })

            if cmd_type == "commit" and result_text:
                match = re.search(r"\[(\S+)\s+([a-f0-9]+)\]\s+(.*?)(?:\n|$)", result_text)
                if match:
                    files_match = re.search(r"(\d+)\s+files?\s+changed", result_text)
                    ins_match = re.search(r"(\d+)\s+insertions?", result_text)
                    del_match = re.search(r"(\d+)\s+deletions?", result_text)
                    commits.append({
                        "sha": match.group(2),
                        "branch": match.group(1),
                        "message": match.group(3),
                        "timestamp": info["ts"],
                        "files_changed": int(files_match.group(1)) if files_match else 0,
                        "insertions": int(ins_match.group(1)) if ins_match else 0,
                        "deletions": int(del_match.group(1)) if del_match else 0,
                    })

    unique_files = {}
    for fc in file_changes:
        p = fc["path"]
        if p not in unique_files:
            unique_files[p] = {"path": p, "creates": 0, "edits": 0, "first_seen": fc["timestamp"], "last_seen": fc["timestamp"]}
        if fc["type"] == "create":
            unique_files[p]["creates"] += 1
        else:
            unique_files[p]["edits"] += 1
        unique_files[p]["last_seen"] = fc["timestamp"]

    return jsonify({
        "commits": commits,
        "file_changes": file_changes,
        "file_summary": sorted(unique_files.values(), key=lambda x: x["last_seen"], reverse=True),
        "git_commands": git_commands,
    })


@app.route("/api/hermes/session/<session_id>", methods=["DELETE"])
def api_hermes_session_delete(session_id):
    # Resolve to root so we delete the entire chain
    root_id, chain_info = _hermes_resolve_session_id(session_id)
    chain_ids = chain_info["chain"] if chain_info else [session_id]

    errors = []
    for sid in chain_ids:
        path = _hermes_find_session_file(sid)
        if path and os.path.isfile(path):
            try:
                os.remove(path)
            except Exception as e:
                errors.append(str(e))
        # Remove meta for every chain member
        meta_path = os.path.join(HERMES_META_DIR, f"{sid}.json")
        if os.path.isfile(meta_path):
            try:
                os.remove(meta_path)
            except Exception:
                pass

    if errors:
        return jsonify({"error": "; ".join(errors)}), 500

    # Evict from cache using root_id (canonical)
    with _bg_lock:
        if _bg_cache.get("hermes_sessions") is not None:
            _bg_cache["hermes_sessions"] = [s for s in _bg_cache["hermes_sessions"] if s["id"] != root_id]
    return jsonify({"deleted": root_id})


@app.route("/api/hermes/sessions/bulk-delete", methods=["POST"])
def api_hermes_bulk_delete():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No session IDs provided"}), 400
    deleted = []
    errors = []

    # Resolve each id to its root and collect all chain files
    seen_roots = set()
    for sid in ids:
        sid = str(sid)
        root_id, chain_info = _hermes_resolve_session_id(sid)
        if root_id in seen_roots:
            continue
        seen_roots.add(root_id)
        chain_ids = chain_info["chain"] if chain_info else [sid]

        chain_ok = True
        for csid in chain_ids:
            path = _hermes_find_session_file(csid)
            if path and os.path.isfile(path):
                try:
                    os.remove(path)
                except Exception as e:
                    errors.append({"id": csid, "error": str(e)})
                    chain_ok = False
            meta_path = os.path.join(HERMES_META_DIR, f"{csid}.json")
            if os.path.isfile(meta_path):
                try:
                    os.remove(meta_path)
                except Exception:
                    pass
        if chain_ok:
            deleted.append(root_id)

    if deleted:
        deleted_set = set(deleted)
        with _bg_lock:
            if _bg_cache.get("hermes_sessions") is not None:
                _bg_cache["hermes_sessions"] = [s for s in _bg_cache["hermes_sessions"] if s["id"] not in deleted_set]
    return jsonify({"deleted": deleted, "errors": errors})


@app.route("/api/hermes/search")
def api_hermes_search():
    query = request.args.get("q", "").strip().lower()
    if not query or len(query) < 2:
        return jsonify({"results": [], "error": "Query too short"})
    limit = int(request.args.get("limit", 50))
    results = []
    for session in hermes_get_all_sessions():
        data = _hermes_load_session(session["id"])
        if not data:
            continue
        for msg in data.get("messages", []):
            if msg.get("role") not in ("user", "assistant"):
                continue
            content = msg.get("content", "")
            if not isinstance(content, str):
                continue
            lower = content.lower()
            if query not in lower:
                continue
            idx = lower.index(query)
            start = max(0, idx - 80)
            results.append({
                "session_id": session["id"],
                "summary": session.get("nickname") or session.get("summary") or "Hermes Session",
                "provider": "hermes",
                "timestamp": data.get("session_start", ""),
                "content": content[start:start + 200],
            })
            if len(results) >= limit:
                break
        if len(results) >= limit:
            break
    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    return jsonify({"results": results})


# ── Hermes merge request (MR) endpoints ──────────────────────────────────────

@app.route("/api/hermes/session/<session_id>/mr", methods=["GET"])
def api_hermes_session_mr_get(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    meta = _hermes_read_session_meta(root_id)
    mrs = meta.get("mrs", [])
    return jsonify(mrs)


@app.route("/api/hermes/session/<session_id>/mr", methods=["POST"])
def api_hermes_session_mr_post(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    mr_id = data.get("id") or str(int(time.time() * 1000))
    mr_data = {
        "id": mr_id,
        "url": (data.get("url") or "").strip(),
        "status": (data.get("status") or "").strip(),
        "jira": (data.get("jira") or "").strip(),
        "role": (data.get("role") or "").strip(),
    }
    meta = _hermes_read_session_meta(root_id)
    mrs = meta.get("mrs", [])
    found = False
    for i, mr in enumerate(mrs):
        if mr.get("id") == mr_id:
            mrs[i] = mr_data
            found = True
            break
    if not found:
        mrs.append(mr_data)
    meta["mrs"] = mrs
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['mrs'] = mrs
                    break
    return jsonify({"id": root_id, "mrs": mrs})


@app.route("/api/hermes/session/<session_id>/mr/<mr_id>", methods=["DELETE"])
def api_hermes_session_mr_delete(session_id, mr_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    meta = _hermes_read_session_meta(root_id)
    mrs = [mr for mr in meta.get("mrs", []) if mr.get("id") != mr_id]
    meta["mrs"] = mrs
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['mrs'] = mrs
                    break
    return jsonify({"id": root_id, "deleted": True})


# ── Hermes Jira ticket endpoints ─────────────────────────────────────────────

@app.route("/api/hermes/session/<session_id>/jira-ticket", methods=["GET"])
def api_hermes_session_jira_ticket_get(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    meta = _hermes_read_session_meta(root_id)
    tickets = meta.get("jira_tickets", [])
    return jsonify(tickets)


@app.route("/api/hermes/session/<session_id>/jira-ticket", methods=["POST"])
def api_hermes_session_jira_ticket_post(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    ticket_id = data.get("id") or _unique_ts_id()
    ticket_data = {
        "id": ticket_id,
        "ticket_key": (data.get("ticket_key") or "").strip().upper(),
        "title": (data.get("title") or "").strip(),
        "status": (data.get("status") or "").strip(),
        "assignee": (data.get("assignee") or "").strip(),
        "role": (data.get("role") or "").strip(),
    }
    meta = _hermes_read_session_meta(root_id)
    tickets = meta.get("jira_tickets", [])
    found = False
    for i, t in enumerate(tickets):
        if t.get("id") == ticket_id:
            tickets[i] = ticket_data
            found = True
            break
    if not found:
        tickets.append(ticket_data)
    meta["jira_tickets"] = tickets
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": root_id, "jira_tickets": tickets})


@app.route("/api/hermes/session/<session_id>/jira-ticket/<ticket_id>", methods=["DELETE"])
def api_hermes_session_jira_ticket_delete(session_id, ticket_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    meta = _hermes_read_session_meta(root_id)
    tickets = [t for t in meta.get("jira_tickets", []) if t.get("id") != ticket_id]
    meta["jira_tickets"] = tickets
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": root_id, "deleted": True})


# ── Hermes assign/unassign MR & Jira (central registry) ─────────────────────

@app.route("/api/hermes/session/<session_id>/assign-mr", methods=["POST"])
def api_hermes_session_assign_mr(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    mr_id = data.get("mr_id")
    if not mr_id:
        return jsonify({"error": "mr_id required"}), 400
    registry = _read_merge_requests()
    mr = next((m for m in registry if m["id"] == mr_id), None)
    if not mr:
        return jsonify({"error": "MR not found in registry"}), 404
    explicit_role = (data.get("role") or "").strip()
    role = explicit_role or _auto_detect_mr_role(mr)
    if role == "author" and not mr.get("author"):
        prefs = _read_preferences()
        my_name = (prefs.get("name") or "").strip()
        if my_name:
            mr["author"] = my_name
            _write_merge_requests(registry)
            _mr_registry_cache["data"] = None
    meta = _hermes_read_session_meta(root_id)
    if "mrs" not in meta:
        meta["mrs"] = []
    if any(link.get("mr_id") == mr_id for link in meta["mrs"]):
        return jsonify({"error": "MR already assigned to this session"}), 409
    link = {
        "mr_id": mr_id,
        "role": role,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
    }
    meta["mrs"].append(link)
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['mrs'] = meta["mrs"]
                    break
    return jsonify({"session_id": root_id, "link": link, "mrs": meta["mrs"]})


@app.route("/api/hermes/session/<session_id>/unassign-mr", methods=["POST"])
def api_hermes_session_unassign_mr(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    mr_id = data.get("mr_id")
    if not mr_id:
        return jsonify({"error": "mr_id required"}), 400
    meta = _hermes_read_session_meta(root_id)
    before = len(meta.get("mrs", []))
    meta["mrs"] = [link for link in meta.get("mrs", []) if link.get("mr_id") != mr_id]
    after = len(meta["mrs"])
    if before == after:
        return jsonify({"error": "MR was not assigned to this session"}), 404
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['mrs'] = meta["mrs"]
                    break
    return jsonify({"session_id": root_id, "removed": mr_id, "mrs": meta["mrs"]})


@app.route("/api/hermes/session/<session_id>/assign-jira", methods=["POST"])
def api_hermes_session_assign_jira(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        return jsonify({"error": "ticket_id required"}), 400
    registry = _read_jira_tickets()
    ticket = next((t for t in registry if t["id"] == ticket_id), None)
    if not ticket:
        return jsonify({"error": "Jira ticket not found in registry"}), 404
    role = (data.get("role") or "watcher").strip()
    meta = _hermes_read_session_meta(root_id)
    if "jira_tickets" not in meta:
        meta["jira_tickets"] = []
    if any(link.get("ticket_id") == ticket_id for link in meta["jira_tickets"]):
        return jsonify({"error": "Jira ticket already assigned to this session"}), 409
    link = {
        "ticket_id": ticket_id,
        "role": role,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
    }
    meta["jira_tickets"].append(link)
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['jira_tickets'] = meta["jira_tickets"]
                    break
    return jsonify({"session_id": root_id, "link": link, "jira_tickets": meta["jira_tickets"]})


@app.route("/api/hermes/session/<session_id>/unassign-jira", methods=["POST"])
def api_hermes_session_unassign_jira(session_id):
    root_id, _ = _hermes_resolve_session_id(session_id)
    data = request.get_json(force=True)
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        return jsonify({"error": "ticket_id required"}), 400
    meta = _hermes_read_session_meta(root_id)
    before = len(meta.get("jira_tickets", []))
    meta["jira_tickets"] = [link for link in meta.get("jira_tickets", []) if link.get("ticket_id") != ticket_id]
    after = len(meta["jira_tickets"])
    if before == after:
        return jsonify({"error": "Jira ticket was not assigned to this session"}), 404
    _hermes_write_session_meta(root_id, meta)
    with _bg_lock:
        if _bg_cache.get('hermes_sessions') is not None:
            for s in _bg_cache['hermes_sessions']:
                if s['id'] == root_id:
                    s['jira_tickets'] = meta["jira_tickets"]
                    break
    return jsonify({"session_id": root_id, "removed": ticket_id, "jira_tickets": meta["jira_tickets"]})


@app.route("/api/hermes/usage")
def api_hermes_usage():
    with _bg_lock:
        data = _bg_cache.get('hermes_usage')
    if data is None:
        return jsonify({"models": [], "tools": [], "daily": [], "totals": {}, "loading": True})
    return jsonify(data)


@app.route("/hermes/session/<session_id>")
def hermes_session_detail_page(session_id):
    return jsonify({
        "error": "UI moved to savant-app client renderer",
        "mode": "hermes",
        "session_id": session_id,
    }), 410


# ───────────────────────────────────────────────────────────────────────────
# Codex session parsing
# ───────────────────────────────────────────────────────────────────────────

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
                except Exception:
                    continue
    except Exception:
        pass
    return entries


def codex_session_files():
    sessions_dir = codex_sessions_dir()
    if not os.path.isdir(sessions_dir):
        return []
    return glob.glob(os.path.join(sessions_dir, "**", "*.jsonl"), recursive=True)


def codex_find_session_jsonl(session_id):
    if not session_id:
        return None
    pattern = os.path.join(codex_sessions_dir(), "**", f"*{session_id}*.jsonl")
    matches = glob.glob(pattern, recursive=True)
    return matches[0] if matches else None


def codex_find_session_dir(session_id):
    """Return a Codex session artifact directory when one exists."""
    jsonl_path = codex_find_session_jsonl(session_id)
    if not jsonl_path:
        return None

    base_dir = os.path.dirname(jsonl_path)
    stem = os.path.splitext(os.path.basename(jsonl_path))[0]
    candidates = [
        os.path.join(base_dir, session_id),
        os.path.join(base_dir, stem),
        os.path.join(base_dir, "artifacts", session_id),
    ]
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return None


def codex_list_session_tree(session_id):
    """List files inside a Codex session artifact directory, if present."""
    session_dir = codex_find_session_dir(session_id)
    result = {"files": [], "plan": None, "research": [], "checkpoints": [], "rewind_snapshots": []}
    if not session_dir or not os.path.isdir(session_dir):
        return result

    for root, _dirs, files in os.walk(session_dir):
        for fname in files:
            fp = os.path.join(root, fname)
            rel = os.path.relpath(fp, session_dir)
            try:
                size = os.path.getsize(fp)
            except OSError:
                size = 0
            try:
                mtime = datetime.fromtimestamp(
                    os.path.getmtime(fp), tz=timezone.utc
                ).isoformat()
            except Exception:
                mtime = ""
            item = {
                "name": fname,
                "path": rel,
                "size": size,
                "mtime": mtime,
            }
            lower_rel = rel.lower()
            lower_name = fname.lower()
            if lower_name == "plan.md":
                result["plan"] = item
            elif lower_rel.startswith("research/"):
                result["research"].append(item)
            elif lower_rel.startswith("checkpoints/"):
                result["checkpoints"].append(item)
            else:
                result["files"].append(item)

    return result


def _codex_parse_arguments(args):
    if isinstance(args, dict):
        return args
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
            return parsed if isinstance(parsed, dict) else {"raw": args}
        except Exception:
            return {"raw": args}
    return {}


def _codex_extract_tool_path(args):
    if not isinstance(args, dict):
        return ""
    for key in ("path", "file_path", "target_file", "target_path", "filename"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _codex_extract_command_string(args):
    if not isinstance(args, dict):
        return ""
    for key in ("command", "cmd", "input", "raw_command"):
        val = args.get(key)
        if isinstance(val, list):
            return " ".join(str(x) for x in val)
        if isinstance(val, str):
            return val
    return ""


def _codex_resolve_file(session_id, rel_path):
    """Resolve a relative file path within the Codex session scope."""
    if not rel_path or ".." in rel_path:
        return None, None

    jsonl_path = codex_find_session_jsonl(session_id)
    if not jsonl_path:
        return None, None

    basename = os.path.basename(jsonl_path)
    if rel_path == basename:
        return jsonl_path, "jsonl"

    session_dir = codex_find_session_dir(session_id)
    if session_dir:
        full = os.path.realpath(os.path.join(session_dir, rel_path))
        if full.startswith(os.path.realpath(session_dir)):
            return full, "artifact"

    return None, None


def _codex_extract_session_id(path, first_entry):
    first_entry = first_entry or {}
    sid = first_entry.get("id")
    if isinstance(sid, str) and sid.strip():
        return sid.strip()

    payload = first_entry.get("payload")
    if isinstance(payload, dict):
        payload_id = payload.get("id")
        if isinstance(payload_id, str) and payload_id.strip():
            return payload_id.strip()

    basename = os.path.basename(path)
    match = re.search(
        r"(?:^|[^0-9a-fA-F])([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[^0-9a-fA-F]|$)",
        basename,
    )
    return match.group(1) if match else os.path.splitext(basename)[0]


def _codex_message_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or item.get("input_text") or item.get("output_text")
                if text:
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _codex_unwrap_entry(entry):
    """Normalize modern Codex JSONL wrappers into a single event shape."""
    if not isinstance(entry, dict):
        return {}

    ts = entry.get("timestamp")
    etype = entry.get("type")
    payload = entry.get("payload")

    if etype in {"response_item", "event_msg"} and isinstance(payload, dict):
        normalized = dict(payload)
        normalized.setdefault("timestamp", ts)
        normalized["_wrapper_type"] = etype
        return normalized

    normalized = dict(entry)
    normalized.setdefault("timestamp", ts)
    return normalized


def _codex_extract_env_context(text):
    match = re.search(r"<cwd>(.*?)</cwd>", text or "", flags=re.DOTALL)
    return (match.group(1).strip() if match else "")


def _codex_extract_summary(entries):
    for raw_entry in entries:
        entry = _codex_unwrap_entry(raw_entry)
        if entry.get("type") == "message" and entry.get("role") == "user":
            text = _codex_message_text(entry.get("content"))
            if "<environment_context>" in text:
                continue
            if "# AGENTS.md instructions" in text or "<INSTRUCTIONS>" in text:
                continue
            text = text.strip()
            if text:
                return text.splitlines()[0][:140]
    for raw_entry in entries:
        entry = _codex_unwrap_entry(raw_entry)
        if entry.get("type") == "message" and entry.get("role") == "user":
            text = _codex_message_text(entry.get("content")).strip()
            if text:
                return text.splitlines()[0][:140]
    first = _codex_unwrap_entry(entries[0]) if entries else {}
    instructions = first.get("instructions", "") if isinstance(first, dict) else ""
    if instructions:
        return instructions.strip().splitlines()[0][:140]
    return ""


def codex_get_session_info(session_id, include_tree=False):
    path = codex_find_session_jsonl(session_id)
    if not path:
        return None
    return _codex_build_session_info(path, include_tree=include_tree)


def _codex_build_session_info(path, include_tree=False):
    entries = codex_safe_read_jsonl(path)
    if not entries:
        return None
    first = entries[0]
    session_id = _codex_extract_session_id(path, first)
    meta = codex_read_session_meta(session_id)

    created_at = first.get("timestamp") or datetime.fromtimestamp(
        os.path.getmtime(path), tz=timezone.utc
    ).isoformat()
    updated_at = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).isoformat()

    cwd = ""
    for raw_entry in entries:
        entry = _codex_unwrap_entry(raw_entry)
        if entry.get("type") == "message" and entry.get("role") == "user":
            text = _codex_message_text(entry.get("content"))
            if "<environment_context>" in text:
                cwd = _codex_extract_env_context(text)
                if cwd:
                    break

    summary = meta.get("nickname") or _codex_extract_summary(entries)
    tool_counts = Counter()
    user_messages = []
    message_count = 0
    turn_count = 0
    last_event_type = None
    for raw_entry in entries:
        entry = _codex_unwrap_entry(raw_entry)
        last_event_type = entry.get("type") or last_event_type
        if entry.get("type") == "message":
            message_count += 1
            if entry.get("role") == "user":
                turn_count += 1
                text = _codex_message_text(entry.get("content")).strip()
                if text:
                    user_messages.append({"timestamp": entry.get("timestamp", created_at), "content": text[:500]})
        if entry.get("type") == "function_call":
            tool_counts[entry.get("name", "unknown")] += 1

    git_info = first.get("git") if isinstance(first, dict) else {}
    repo_url = (git_info or {}).get("repository_url") or ""
    branch = (git_info or {}).get("branch") or ""
    project = meta.get("project") or (Path(cwd).name if cwd else "")
    resume_command = f"cd {cwd} && codex resume {session_id}" if cwd else f"codex resume {session_id}"

    # Standardize resume_command to use resume keyword as requested.

    tree = codex_list_session_tree(session_id)
    notes_list = NoteDB.list_by_session(session_id)
    notes = [
        {
            "text": n.get("text", ""),
            "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
        }
        for n in notes_list
    ]

    info = {
        "id": session_id,
        "provider": "codex",
        "summary": summary,
        "nickname": meta.get("nickname") or "",
        "created_at": created_at,
        "updated_at": updated_at,
        "last_event_time": updated_at,
        "last_event_type": last_event_type or "",
        "message_count": message_count,
        "turn_count": turn_count,
        "event_count": len(entries),
        "tools_used": list(tool_counts.keys()),
        "tool_call_counts": dict(tool_counts),
        "model_call_counts": {},
        "models": [],
        "workspace": meta.get("workspace"),
        "project": project,
        "cwd": cwd,
        "git_root": repo_url,
        "branch": branch,
        "session_path": path,
        "status": meta.get("status") or "IDLE",
        "is_open": False,
        "starred": bool(meta.get("starred")),
        "archived": bool(meta.get("archived")),
        "resume_command": resume_command,
        "user_messages": user_messages[:6],
        "notes": notes,
        "mrs": _enrich_session_mrs(meta.get("mrs", [])),
        "jira_tickets": meta.get("jira_tickets", []),
    }
    if include_tree:
        info["tree"] = tree
    return info


def codex_get_all_sessions():
    sessions = []
    for path in codex_session_files():
        info = _codex_build_session_info(path, include_tree=False)
        if info:
            sessions.append(info)
    sessions.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return sessions


def codex_parse_conversation(session_id):
    path = codex_find_session_jsonl(session_id)
    if not path:
        return [], {}, _new_conversation_stats()
    entries = codex_safe_read_jsonl(path)
    conversation = []
    tool_map = {}
    stats = _new_conversation_stats()

    for raw_entry in entries:
        entry = _codex_unwrap_entry(raw_entry)
        etype = entry.get("type")
        ts = entry.get("timestamp")
        if etype == "message":
            text = _codex_message_text(entry.get("content")).strip()
            if entry.get("role") == "user":
                stats["user_messages"] += 1
                if text:
                    conversation.append({"type": "user_message", "timestamp": ts, "content": text})
            elif entry.get("role") == "assistant":
                stats["assistant_messages"] += 1
                stats["assistant_chars"] += len(text)
                if text:
                    conversation.append({"type": "assistant_message", "timestamp": ts, "content": text, "reasoning": "", "tool_requests": []})
        elif etype == "function_call":
            stats["tool_calls"] += 1
            tool_name = entry.get("name", "unknown")
            call_id = entry.get("call_id") or ""
            args = entry.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {"raw": args[:500]}
            tool_map[call_id] = {"name": tool_name, "args": args or {}, "start_ts": ts, "end_ts": None, "result": None, "success": None, "model": None}
            conversation.append({"type": "tool_start", "timestamp": ts, "call_id": call_id, "tool_name": tool_name})
        elif etype == "function_call_output":
            call_id = entry.get("call_id") or ""
            output = entry.get("output")
            result = output
            success = None
            if isinstance(output, str):
                try:
                    parsed = json.loads(output)
                    result = parsed.get("output", parsed)
                    meta = parsed.get("metadata", {}) if isinstance(parsed, dict) else {}
                    if isinstance(meta, dict) and meta.get("exit_code") is not None:
                        success = meta.get("exit_code") == 0
                except Exception:
                    result = output
            if call_id in tool_map:
                tool_map[call_id]["result"] = result
                tool_map[call_id]["success"] = success
                tool_map[call_id]["end_ts"] = ts
            if success is True:
                stats["tool_successes"] += 1
            elif success is False:
                stats["tool_failures"] += 1
        elif etype == "reasoning":
            continue

    _finalize_conversation_stats(stats)
    return conversation, tool_map, stats


@app.route("/codex/session/<session_id>")
def codex_session_detail_page(session_id):
    return jsonify({
        "error": "UI moved to savant-app client renderer",
        "mode": "codex",
        "session_id": session_id,
    }), 410


# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND CACHE WORKER
# ═══════════════════════════════════════════════════════════════════════════════


def _bg_build_codex_sessions():
    return codex_get_all_sessions()


def _bg_build_copilot_sessions():
    sessions = []
    if not os.path.isdir(SESSION_DIR):
        return sessions
    entries = [
        (entry, os.path.join(SESSION_DIR, entry))
        for entry in os.listdir(SESSION_DIR)
        if len(entry) == 36 and os.path.isdir(os.path.join(SESSION_DIR, entry))
    ]
    def _load(args):
        eid, full = args
        try:
            return get_session_info(eid, full)
        except Exception:
            return None
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = pool.map(_load, entries)
    sessions = [s for s in results if s is not None]
    sessions.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return sessions


def _bg_worker():
    """Background thread: refreshes session lists every 30s, usage every 120s."""
    import sys
    print("[bg-cache] Worker thread started", flush=True, file=sys.stderr)
    _usage_ts = 0
    while True:
        # Build all session caches in parallel
        with ThreadPoolExecutor(max_workers=5) as pool:
            f_copilot = pool.submit(_bg_build_copilot_sessions)
            f_claude = pool.submit(claude_get_all_sessions)
            f_codex = pool.submit(_bg_build_codex_sessions)
            f_gemini = pool.submit(gemini_get_all_sessions)
            f_hermes = pool.submit(hermes_get_all_sessions)

        for name, future, key in [
            ("copilot", f_copilot, "copilot_sessions"),
            ("claude", f_claude, "claude_sessions"),
            ("codex", f_codex, "codex_sessions"),
            ("gemini", f_gemini, "gemini_sessions"),
            ("hermes", f_hermes, "hermes_sessions"),
        ]:
            try:
                data = future.result()
                with _bg_lock:
                    _bg_cache[key] = data
                print(f"[bg-cache] {name}: {len(data)} sessions", flush=True, file=sys.stderr)
            except Exception as e:
                print(f"[bg-cache] {name} sessions error: {e}", flush=True, file=sys.stderr)

        now = _time.time()
        if now - _usage_ts >= 120:
            _usage_ts = now
            with ThreadPoolExecutor(max_workers=5) as pool:
                f_cu = pool.submit(_build_copilot_usage)
                f_clau = pool.submit(_build_claude_usage)
                f_codex = pool.submit(_build_codex_usage)
                f_gemini = pool.submit(_build_gemini_usage)
                f_hermes = pool.submit(_build_hermes_usage)

            for name, future, key in [
                ("copilot", f_cu, "copilot_usage"),
                ("claude", f_clau, "claude_usage"),
                ("codex", f_codex, "codex_usage"),
                ("gemini", f_gemini, "gemini_usage"),
                ("hermes", f_hermes, "hermes_usage"),
            ]:
                try:
                    data = future.result()
                    with _bg_lock:
                        _bg_cache[key] = data
                except Exception as e:
                    print(f"[bg-cache] {name} usage error: {e}")

        _time.sleep(30)


if os.environ.get("SAVANT_DISABLE_BG_CACHE", "").strip().lower() not in ("1", "true", "yes", "on"):
    _bg_thread = threading.Thread(target=_bg_worker, daemon=True)
    _bg_thread.start()

# ── Task indexes (SQLite) ──
TaskDB.ensure_indexes()


# ── Merge Requests (first-class entity) ────────────────────────────────────

def _merge_requests_path():
    return os.path.join(META_DIR, "merge_requests.json")

_mr_lock = threading.RLock()

def _read_merge_requests():
    """Read merge requests from SQLite."""
    try:
        mrs = MergeRequestDB.list_all(limit=1000)
        
        normalized = []
        for mr in mrs:
            normalized_mr = {
                "id": mr.get("mr_id"),
                "mr_id": mr.get("mr_id"),
                "url": mr.get("url", ""),
                "title": mr.get("title", ""),
                "status": mr.get("status", "open"),
                "author": mr.get("author", ""),
                "jira": mr.get("jira", ""),
                "workspace": mr.get("workspace_id", ""),
                "workspace_id": mr.get("workspace_id", ""),
            }
            normalized.append(normalized_mr)
        
        return normalized
    except Exception as e:
        logger.error(f"Error reading merge requests: {e}")
        return []

def _write_merge_requests(mrs):
    """Write merge requests to SQLite."""
    try:
        for mr in mrs:
            mr_id = mr.get("id") or mr.get("mr_id")
            if not mr_id or not mr.get("url"):
                continue
            
            ws_id = mr.get("workspace_id") or mr.get("workspace", "")
            existing = MergeRequestDB.get_by_url(mr.get("url"))
            if existing:
                MergeRequestDB.update(mr_id, {
                    "title": mr.get("title", ""),
                    "status": mr.get("status", "open"),
                    "author": mr.get("author", ""),
                    "jira": mr.get("jira", ""),
                    "workspace_id": ws_id,
                    "priority": mr.get("priority", "medium"),
                    "project_id": mr.get("project_id", ""),
                    "mr_iid": mr.get("mr_iid", 0),
                })
            else:
                MergeRequestDB.create({
                    "mr_id": mr_id,
                    "workspace_id": ws_id,
                    "url": mr.get("url", ""),
                    "project_id": mr.get("project_id", ""),
                    "mr_iid": mr.get("mr_iid", 0),
                    "title": mr.get("title", ""),
                    "status": mr.get("status", "open"),
                    "author": mr.get("author", ""),
                    "jira": mr.get("jira", ""),
                    "priority": mr.get("priority", "medium"),
                })
    except Exception as e:
        logger.error(f"Error writing merge requests: {e}")

def _parse_mr_url(url):
    """Extract project_id and mr_iid from a GitLab MR URL."""
    m = re.match(r"https?://[^/]+/(.+?)/-/merge_requests/(\d+)", url)
    if m:
        return m.group(1), int(m.group(2))
    return "", 0

# Cached registry lookup, refreshed lazily
_mr_registry_cache = {"data": None, "mtime": 0}

def _get_mr_registry_by_id():
    """Get mr_id → registry entry map, cached by file mtime."""
    path = _merge_requests_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    if _mr_registry_cache["data"] is not None and _mr_registry_cache["mtime"] == mtime:
        return _mr_registry_cache["data"]
    registry = _read_merge_requests()
    lookup = {m["id"]: m for m in registry}
    _mr_registry_cache["data"] = lookup
    _mr_registry_cache["mtime"] = mtime
    return lookup

def _enrich_session_mrs(raw_mrs):
    """Resolve mr_id references in session mrs[] to full MR data for the frontend.
    Returns list with all registry fields plus session-level role/assigned_at."""
    if not raw_mrs:
        return []
    # Check if already old format (has url) — no enrichment needed
    if raw_mrs[0].get("url"):
        return raw_mrs
    registry = _get_mr_registry_by_id()
    enriched = []
    for link in raw_mrs:
        mr_id = link.get("mr_id")
        if not mr_id:
            continue
        reg = registry.get(mr_id, {})
        enriched.append({
            "id": mr_id,
            "mr_id": mr_id,
            "url": reg.get("url", ""),
            "title": reg.get("title", ""),
            "jira": reg.get("jira", ""),
            "status": reg.get("status", "open"),
            "author": reg.get("author", ""),
            "priority": reg.get("priority", "medium"),
            "workspace_id": reg.get("workspace_id", ""),
            "role": link.get("role", ""),
            "assigned_at": link.get("assigned_at", ""),
        })
    return enriched

def _auto_detect_mr_role(mr_registry_entry):
    """Auto-detect whether the current user is author or reviewer for an MR.
    Compares MR registry author against preferences name.
    If MR has no author yet, assumes caller is the author."""
    mr_author = (mr_registry_entry.get("author") or "").strip().lower()
    if not mr_author:
        return "author"
    prefs = _read_preferences()
    my_name = (prefs.get("name") or "").strip().lower()
    if not my_name:
        return "reviewer"
    # Fuzzy match: check if preferences name appears in MR author or vice versa
    if my_name in mr_author or mr_author in my_name:
        return "author"
    return "reviewer"

def _enrich_mr_with_sessions(mr):
    """Add linked sessions info to an MR dict."""
    mr_id = mr["id"]
    linked = []
    with _bg_lock:
        all_sessions = list(_bg_cache.get('copilot_sessions') or [])
    for s in all_sessions:
        for link in (s.get("mrs") or []):
            if link.get("mr_id") == mr_id:
                linked.append({
                    "session_id": s["id"],
                    "role": link.get("role", ""),
                    "assigned_at": link.get("assigned_at", ""),
                })
    mr["sessions"] = linked
    return mr


@app.route("/api/merge-requests", methods=["GET"])
def api_merge_requests_list():
    mrs = _read_merge_requests()
    ws_filter = request.args.get("workspace_id")
    if ws_filter:
        mrs = [m for m in mrs if m.get("workspace_id") == ws_filter]
    status_filter = request.args.get("status")
    if status_filter:
        mrs = [m for m in mrs if m.get("status") == status_filter]
    return jsonify(mrs)


@app.route("/api/merge-requests", methods=["POST"])
def api_merge_requests_create():
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400

    mrs = _read_merge_requests()
    # Prevent duplicate by URL
    existing = next((m for m in mrs if m.get("url", "").strip().lower().rstrip("/") == url.lower().rstrip("/")), None)
    if existing:
        return jsonify({"error": "MR already registered", "existing": existing}), 409

    project_id, mr_iid = _parse_mr_url(url)
    now_iso = datetime.now(timezone.utc).isoformat()
    # Auto-populate author from preferences if not provided
    author = (data.get("author") or "").strip()
    if not author:
        prefs = _read_preferences()
        author = (prefs.get("name") or "").strip()
    mr = {
        "id": data.get("id") or str(int(time.time() * 1000)),
        "project_id": data.get("project_id") or project_id,
        "mr_iid": data.get("mr_iid") or mr_iid,
        "title": (data.get("title") or "").strip(),
        "url": url,
        "jira": (data.get("jira") or "").strip(),
        "status": data.get("status") or "open",
        "author": author,
        "priority": data.get("priority") or "medium",
        "workspace_id": data.get("workspace_id") or "",
        "notes": [],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    mrs.append(mr)
    _write_merge_requests(mrs)
    _mr_registry_cache["data"] = None
    _emit_event("mr_created", f"MR registered: {url}", {"mr_id": mr["id"], "workspace_id": mr.get("workspace_id")})
    return jsonify(mr)


@app.route("/api/merge-requests/<mr_id>", methods=["GET"])
def api_merge_requests_get(mr_id):
    mrs = _read_merge_requests()
    mr = next((m for m in mrs if m["id"] == mr_id), None)
    if not mr:
        return jsonify({"error": "MR not found"}), 404
    return jsonify(_enrich_mr_with_sessions(dict(mr)))


@app.route("/api/merge-requests/<mr_id>", methods=["PUT"])
def api_merge_requests_update(mr_id):
    data = request.get_json(force=True)
    mrs = _read_merge_requests()
    for m in mrs:
        if m["id"] == mr_id:
            for key in ("title", "status", "jira", "author", "priority", "workspace_id", "project_id", "mr_iid"):
                if key in data:
                    m[key] = data[key]
            m["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write_merge_requests(mrs)
            _emit_event("mr_updated", f"MR updated: {m.get('url','')}", {"mr_id": mr_id, "status": m.get("status")})
            return jsonify(m)
    return jsonify({"error": "MR not found"}), 404


@app.route("/api/merge-requests/<mr_id>", methods=["DELETE"])
def api_merge_requests_delete(mr_id):
    mrs = _read_merge_requests()
    mrs = [m for m in mrs if m["id"] != mr_id]
    _write_merge_requests(mrs)
    return jsonify({"deleted": mr_id})


@app.route("/api/merge-requests/<mr_id>/notes", methods=["GET"])
def api_merge_request_notes_list(mr_id):
    mrs = _read_merge_requests()
    mr = next((m for m in mrs if m["id"] == mr_id), None)
    if not mr:
        return jsonify({"error": "MR not found"}), 404
    return jsonify({"mr_id": mr_id, "notes": mr.get("notes", [])})


@app.route("/api/merge-requests/<mr_id>/notes", methods=["POST"])
def api_merge_request_notes_create(mr_id):
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text required"}), 400

    mrs = _read_merge_requests()
    for m in mrs:
        if m["id"] == mr_id:
            if "notes" not in m:
                m["notes"] = []
            note = {
                "session_id": data.get("session_id") or "",
                "text": text,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            m["notes"].append(note)
            m["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write_merge_requests(mrs)
            return jsonify({"mr_id": mr_id, "note": note, "total": len(m["notes"])})
    return jsonify({"error": "MR not found"}), 404


@app.route("/api/session/<session_id>/assign-mr", methods=["POST"])
def api_session_assign_mr(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    mr_id = data.get("mr_id")
    if not mr_id:
        return jsonify({"error": "mr_id required"}), 400
    # Verify MR exists in registry
    registry = _read_merge_requests()
    mr = next((m for m in registry if m["id"] == mr_id), None)
    if not mr:
        return jsonify({"error": "MR not found in registry"}), 404
    explicit_role = (data.get("role") or "").strip()
    # Auto-detect role from MR author if not explicitly provided
    role = explicit_role or _auto_detect_mr_role(mr)
    # If this session is the author and MR has no author yet, claim it
    if role == "author" and not mr.get("author"):
        prefs = _read_preferences()
        my_name = (prefs.get("name") or "").strip()
        if my_name:
            mr["author"] = my_name
            _write_merge_requests(registry)
            _mr_registry_cache["data"] = None
    meta = read_session_meta(full)
    if "mrs" not in meta:
        meta["mrs"] = []
    # Don't duplicate
    if any(link.get("mr_id") == mr_id for link in meta["mrs"]):
        return jsonify({"error": "MR already assigned to this session"}), 409
    link = {
        "mr_id": mr_id,
        "role": role,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
    }
    meta["mrs"].append(link)
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = meta["mrs"]
                    break
    return jsonify({"session_id": session_id, "link": link, "mrs": meta["mrs"]})


@app.route("/api/session/<session_id>/unassign-mr", methods=["POST"])
def api_session_unassign_mr(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    mr_id = data.get("mr_id")
    if not mr_id:
        return jsonify({"error": "mr_id required"}), 400
    meta = read_session_meta(full)
    before = len(meta.get("mrs", []))
    meta["mrs"] = [link for link in meta.get("mrs", []) if link.get("mr_id") != mr_id]
    after = len(meta["mrs"])
    if before == after:
        return jsonify({"error": "MR was not assigned to this session"}), 404
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = meta["mrs"]
                    break
    return jsonify({"session_id": session_id, "removed": mr_id, "mrs": meta["mrs"]})


@app.route("/api/merge-requests/migrate", methods=["POST"])
def api_merge_requests_migrate():
    """Migration endpoint: scan sessions, dedup MRs, write registry, rewrite sessions."""
    if _read_merge_requests():
        return jsonify({"error": "merge_requests.json already has data. Delete it to re-run migration."}), 409

    entries = []
    for sid in os.listdir(SESSION_DIR):
        meta_path = os.path.join(SESSION_DIR, sid, ".copilot-meta.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
        except Exception:
            continue
        for mr in meta.get("mrs", []):
            if "mr_id" in mr and "url" not in mr:
                continue  # already migrated
            entries.append({
                "session_id": sid,
                "old_id": mr.get("id", ""),
                "url": mr.get("url", ""),
                "status": mr.get("status", ""),
                "jira": mr.get("jira", ""),
                "role": mr.get("role", ""),
                "workspace": meta.get("workspace", ""),
            })

    if not entries:
        return jsonify({"message": "No legacy MR entries found", "migrated": 0})

    from collections import defaultdict
    by_url = defaultdict(list)
    for e in entries:
        if e["url"]:
            by_url[e["url"]].append(e)

    now_iso = datetime.now(timezone.utc).isoformat()
    canonical = []
    url_to_id = {}

    for url, group in by_url.items():
        ids = [e["old_id"] for e in group if e["old_id"]]
        canonical_id = min(ids, key=lambda x: int(x)) if ids else str(int(time.time() * 1000))
        url_to_id[url] = canonical_id

        workspaces = [e["workspace"] for e in group if e["workspace"]]
        workspace_id = max(set(workspaces), key=workspaces.count) if workspaces else ""
        latest = max(group, key=lambda e: int(e["old_id"]) if e["old_id"] else 0)
        jira = next((e["jira"] for e in group if e["jira"]), "")
        project_id, mr_iid = _parse_mr_url(url)

        canonical.append({
            "id": canonical_id,
            "project_id": project_id,
            "mr_iid": mr_iid,
            "title": "",
            "url": url,
            "jira": jira,
            "status": latest["status"],
            "author": "",
            "priority": "medium",
            "workspace_id": workspace_id,
            "notes": [],
            "created_at": now_iso,
            "updated_at": now_iso,
        })

    _write_merge_requests(canonical)

    # Rewrite sessions
    rewritten = 0
    for sid in os.listdir(SESSION_DIR):
        meta_path = os.path.join(SESSION_DIR, sid, ".copilot-meta.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
        except Exception:
            continue
        old_mrs = meta.get("mrs", [])
        if not old_mrs:
            continue
        # Skip already-migrated sessions
        if old_mrs and "mr_id" in old_mrs[0] and "url" not in old_mrs[0]:
            continue
        # Back up
        bak = meta_path + ".pre-mr-migration.bak"
        if not os.path.exists(bak):
            shutil.copy2(meta_path, bak)
        new_mrs = []
        for mr in old_mrs:
            url = mr.get("url", "")
            cid = url_to_id.get(url)
            if cid:
                new_mrs.append({
                    "mr_id": cid,
                    "role": mr.get("role", ""),
                    "assigned_at": now_iso,
                })
        meta["mrs"] = new_mrs
        meta.pop("mr", None)
        write_session_meta(os.path.join(SESSION_DIR, sid), meta)
        rewritten += 1

    return jsonify({
        "migrated": len(canonical),
        "deduplicated_from": len(entries),
        "sessions_rewritten": rewritten,
        "merge_requests": canonical,
    })


# ── Jira Tickets (first-class entity) ───────────────────────────────────────

def _jira_tickets_path():
    return os.path.join(META_DIR, "jira_tickets.json")

_jira_lock = threading.RLock()

def _read_jira_tickets():
    """Read jira tickets from SQLite."""
    for attempt in range(3):
        try:
            tickets = JiraTicketDB.list_all(limit=1000)
            normalized = []
            for t in tickets:
                normalized.append({
                    "id": t.get("ticket_id"),
                    "ticket_id": t.get("ticket_id"),
                    "ticket_key": t.get("ticket_key", ""),
                    "title": t.get("title", ""),
                    "status": t.get("status", "todo"),
                    "priority": t.get("priority", "medium"),
                    "assignee": t.get("assignee", ""),
                    "reporter": t.get("reporter", ""),
                    "workspace_id": t.get("workspace_id", ""),
                    "url": f"https://icapitalnetwork.atlassian.net/browse/{t.get('ticket_key', '')}",
                    "created_at": t.get("created_at", ""),
                    "updated_at": t.get("updated_at", ""),
                    "notes": t.get("notes", []),
                })
            return normalized
        except Exception as e:
            if attempt == 2:
                logger.error(f"Error reading jira tickets: {e}")
            import time; time.sleep(0.1)
    return []

def _write_jira_tickets(tickets):
    """Write jira tickets to SQLite."""
    try:
        for t in tickets:
            ticket_id = t.get("id") or t.get("ticket_id")
            if not ticket_id or not t.get("ticket_key"):
                continue
            existing = JiraTicketDB.get_by_id(ticket_id)
            if existing:
                JiraTicketDB.update(ticket_id, {
                    "title": t.get("title", ""),
                    "status": t.get("status", "todo"),
                    "priority": t.get("priority", "medium"),
                    "assignee": t.get("assignee", ""),
                    "reporter": t.get("reporter", ""),
                })
            else:
                JiraTicketDB.create({
                    "ticket_id": ticket_id,
                    "workspace_id": t.get("workspace_id", ""),
                    "ticket_key": t.get("ticket_key", ""),
                    "title": t.get("title", ""),
                    "status": t.get("status", "todo"),
                    "priority": t.get("priority", "medium"),
                    "assignee": t.get("assignee", ""),
                    "reporter": t.get("reporter", ""),
                })
    except Exception as e:
        logger.error(f"Error writing jira tickets: {e}")

_jira_registry_cache = {"data": None, "mtime": 0}

def _get_jira_registry_by_id():
    """Get ticket_id → registry entry map from SQLite."""
    registry = _read_jira_tickets()
    return {t["id"]: t for t in registry}

def _enrich_session_jira_tickets(raw_tickets):
    """Resolve ticket_id references in session jira_tickets[] to full data."""
    if not raw_tickets:
        return []
    if raw_tickets[0].get("ticket_key"):
        return raw_tickets
    registry = _get_jira_registry_by_id()
    enriched = []
    for link in raw_tickets:
        ticket_id = link.get("ticket_id")
        if not ticket_id:
            continue
        reg = registry.get(ticket_id, {})
        enriched.append({
            "id": ticket_id,
            "ticket_id": ticket_id,
            "ticket_key": reg.get("ticket_key", ""),
            "title": reg.get("title", ""),
            "url": reg.get("url", ""),
            "status": reg.get("status", "todo"),
            "priority": reg.get("priority", "medium"),
            "assignee": reg.get("assignee", ""),
            "reporter": reg.get("reporter", ""),
            "workspace_id": reg.get("workspace_id", ""),
            "role": link.get("role", ""),
            "assigned_at": link.get("assigned_at", ""),
        })
    return enriched

def _enrich_jira_with_sessions(ticket):
    """Add linked sessions info to a Jira ticket dict."""
    ticket_id = ticket["id"]
    linked = []
    with _bg_lock:
        all_sessions = list(_bg_cache.get('copilot_sessions') or [])
    for s in all_sessions:
        for link in (s.get("jira_tickets") or []):
            if link.get("ticket_id") == ticket_id:
                linked.append({
                    "session_id": s["id"],
                    "role": link.get("role", ""),
                    "assigned_at": link.get("assigned_at", ""),
                })
    ticket["sessions"] = linked
    return ticket


@app.route("/api/jira-tickets", methods=["GET"])
def api_jira_tickets_list():
    tickets = _read_jira_tickets()
    ws_filter = request.args.get("workspace_id")
    if ws_filter:
        tickets = [t for t in tickets if t.get("workspace_id") == ws_filter]
    status_filter = request.args.get("status")
    if status_filter:
        tickets = [t for t in tickets if t.get("status") == status_filter]
    assignee_filter = request.args.get("assignee")
    if assignee_filter:
        tickets = [t for t in tickets if (t.get("assignee") or "").lower() == assignee_filter.lower()]
    return jsonify(tickets)


@app.route("/api/jira-tickets", methods=["POST"])
def api_jira_tickets_create():
    data = request.get_json(force=True)
    ticket_key = (data.get("ticket_key") or "").strip().upper()
    if not ticket_key:
        return jsonify({"error": "ticket_key required"}), 400

    existing = JiraTicketDB.get_by_key(ticket_key)
    if existing:
        return jsonify({"error": "Jira ticket already registered", "existing": existing}), 409

    now_iso = datetime.now(timezone.utc).isoformat()
    url = (data.get("url") or "").strip()
    if not url:
        url = f"https://icapitalnetwork.atlassian.net/browse/{ticket_key}"
    assignee = (data.get("assignee") or "").strip()
    if not assignee:
        prefs = _read_preferences()
        assignee = (prefs.get("name") or "").strip()
    ticket_id = data.get("id") or _unique_ts_id()
    workspace_id = data.get("workspace_id") or ""
    try:
        JiraTicketDB.create({
            "ticket_id": ticket_id,
            "workspace_id": workspace_id,
            "ticket_key": ticket_key,
            "title": (data.get("title") or "").strip(),
            "status": data.get("status") or "todo",
            "priority": data.get("priority") or "medium",
            "assignee": assignee,
            "reporter": (data.get("reporter") or "").strip(),
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    except Exception as e:
        logger.error(f"Error creating jira ticket: {e}")
        return jsonify({"error": str(e)}), 500
    ticket = JiraTicketDB.get_by_id(ticket_id)
    if not ticket:
        return jsonify({"error": "Failed to create jira ticket"}), 500
    # Normalize for API response
    ticket["id"] = ticket["ticket_id"]
    ticket["url"] = url
    _emit_event("jira_created", f"Jira ticket registered: {ticket_key}", {"ticket_id": ticket_id, "workspace_id": workspace_id})
    return jsonify(ticket)


def _resolve_jira_ticket(identifier):
    """Resolve a Jira ticket by ticket_id or ticket_key. Returns (normalized dict, raw db dict) or (None, None)."""
    ticket = JiraTicketDB.get_by_id(identifier)
    if not ticket:
        ticket = JiraTicketDB.get_by_key(identifier.upper())
    if not ticket:
        return None
    # Normalize for API
    ticket["id"] = ticket["ticket_id"]
    ticket["url"] = f"https://icapitalnetwork.atlassian.net/browse/{ticket.get('ticket_key', '')}"
    return ticket


@app.route("/api/jira-tickets/<ticket_id>", methods=["GET"])
def api_jira_tickets_get(ticket_id):
    ticket = _resolve_jira_ticket(ticket_id)
    if not ticket:
        return jsonify({"error": "Jira ticket not found"}), 404
    return jsonify(_enrich_jira_with_sessions(dict(ticket)))


@app.route("/api/jira-tickets/<ticket_id>", methods=["PUT"])
def api_jira_tickets_update(ticket_id):
    ticket = _resolve_jira_ticket(ticket_id)
    if not ticket:
        return jsonify({"error": "Jira ticket not found"}), 404
    real_id = ticket["ticket_id"]
    data = request.get_json(force=True)
    updates = {}
    for key in ("title", "status", "priority", "assignee", "reporter", "workspace_id", "ticket_key"):
        if key in data:
            updates[key] = data[key]
    if not updates:
        return jsonify(ticket)
    updated = JiraTicketDB.update(real_id, updates)
    if not updated:
        return jsonify({"error": "Update failed"}), 500
    updated["id"] = updated["ticket_id"]
    updated["url"] = f"https://icapitalnetwork.atlassian.net/browse/{updated.get('ticket_key', '')}"
    _emit_event("jira_updated", f"Jira ticket updated: {updated.get('ticket_key','')}", {"ticket_id": real_id, "status": updated.get("status")})
    return jsonify(updated)


@app.route("/api/jira-tickets/<ticket_id>", methods=["DELETE"])
def api_jira_tickets_delete(ticket_id):
    ticket = _resolve_jira_ticket(ticket_id)
    if not ticket:
        return jsonify({"error": "Jira ticket not found"}), 404
    real_id = ticket["ticket_id"]
    JiraTicketDB.delete(real_id)
    return jsonify({"deleted": real_id})


@app.route("/api/jira-tickets/<ticket_id>/notes", methods=["GET"])
def api_jira_ticket_notes_list(ticket_id):
    ticket = _resolve_jira_ticket(ticket_id)
    if not ticket:
        return jsonify({"error": "Jira ticket not found"}), 404
    return jsonify({"ticket_id": ticket["ticket_id"], "notes": ticket.get("notes", [])})


@app.route("/api/jira-tickets/<ticket_id>/notes", methods=["POST"])
def api_jira_ticket_notes_create(ticket_id):
    ticket = _resolve_jira_ticket(ticket_id)
    if not ticket:
        return jsonify({"error": "Jira ticket not found"}), 404
    real_id = ticket["ticket_id"]
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    result = JiraTicketDB.add_note(real_id, text, session_id=data.get("session_id") or "")
    if not result:
        return jsonify({"error": "Failed to add note"}), 500
    return jsonify({"ticket_id": real_id, "note": result["notes"][-1], "total": len(result["notes"])})


# ── Session-level Jira ticket endpoints ─────────────────────────────────────

@app.route("/api/session/<session_id>/jira-ticket", methods=["GET"])
def api_session_jira_ticket_get(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    tickets = meta.get("jira_tickets", [])
    tickets = _enrich_session_jira_tickets(tickets)
    return jsonify(tickets)


@app.route("/api/session/<session_id>/jira-ticket", methods=["POST"])
def api_session_jira_ticket_post(session_id):
    """Add or update a Jira ticket for a session. Works with the central registry."""
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    ticket_key = (data.get("ticket_key") or "").strip().upper()
    title = (data.get("title") or "").strip()
    status = (data.get("status") or "").strip()
    priority = (data.get("priority") or "").strip()
    assignee = (data.get("assignee") or "").strip()
    reporter = (data.get("reporter") or "").strip()
    role = (data.get("role") or "assignee").strip()
    ticket_id = data.get("id") or data.get("ticket_id") or ""

    registry = _read_jira_tickets()
    registry_entry = None

    if ticket_id:
        registry_entry = next((t for t in registry if t["id"] == ticket_id), None)
    if not registry_entry and ticket_key:
        registry_entry = next((t for t in registry if (t.get("ticket_key") or "").upper() == ticket_key), None)

    now_iso = datetime.now(timezone.utc).isoformat()

    if registry_entry:
        if status:
            registry_entry["status"] = status
        if title:
            registry_entry["title"] = title
        if priority:
            registry_entry["priority"] = priority
        if assignee:
            registry_entry["assignee"] = assignee
        if reporter:
            registry_entry["reporter"] = reporter
        registry_entry["updated_at"] = now_iso
        ticket_id = registry_entry["id"]
    else:
        if not ticket_key:
            return jsonify({"error": "ticket_key required for new Jira ticket"}), 400
        ticket_id = _unique_ts_id()
        url = f"https://icapitalnetwork.atlassian.net/browse/{ticket_key}"
        meta_ws = read_session_meta(full).get("workspace", "")
        if not assignee:
            prefs = _read_preferences()
            assignee = (prefs.get("name") or "").strip()
        registry_entry = {
            "id": ticket_id,
            "ticket_key": ticket_key,
            "title": title,
            "url": url,
            "status": status or "todo",
            "priority": priority or "medium",
            "assignee": assignee,
            "reporter": reporter,
            "workspace_id": meta_ws,
            "notes": [],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        registry.append(registry_entry)

    _write_jira_tickets(registry)
    _jira_registry_cache["data"] = None

    meta = read_session_meta(full)
    if "jira_tickets" not in meta:
        meta["jira_tickets"] = []
    meta["jira_tickets"] = [link for link in meta["jira_tickets"] if link.get("ticket_id") != ticket_id]
    meta["jira_tickets"].append({
        "ticket_id": ticket_id,
        "role": role,
        "assigned_at": now_iso,
    })
    write_session_meta(full, meta)

    enriched = _enrich_session_jira_tickets(meta["jira_tickets"])
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = enriched
                    break

    return jsonify({"id": session_id, "jira_tickets": enriched})


@app.route("/api/session/<session_id>/jira-ticket/<ticket_id>", methods=["DELETE"])
def api_session_jira_ticket_delete(session_id, ticket_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    meta = read_session_meta(full)
    tickets = meta.get("jira_tickets", [])
    tickets = [t for t in tickets if t.get("ticket_id") != ticket_id]
    meta["jira_tickets"] = tickets
    write_session_meta(full, meta)
    enriched = _enrich_session_jira_tickets(tickets)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = enriched
                    break
    return jsonify({"id": session_id, "deleted": ticket_id, "jira_tickets": enriched})


@app.route("/api/session/<session_id>/assign-jira", methods=["POST"])
def api_session_assign_jira(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        return jsonify({"error": "ticket_id required"}), 400
    registry = _read_jira_tickets()
    ticket = next((t for t in registry if t["id"] == ticket_id), None)
    if not ticket:
        return jsonify({"error": "Jira ticket not found in registry"}), 404
    role = (data.get("role") or "watcher").strip()
    meta = read_session_meta(full)
    if "jira_tickets" not in meta:
        meta["jira_tickets"] = []
    if any(link.get("ticket_id") == ticket_id for link in meta["jira_tickets"]):
        return jsonify({"error": "Jira ticket already assigned to this session"}), 409
    link = {
        "ticket_id": ticket_id,
        "role": role,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
    }
    meta["jira_tickets"].append(link)
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = meta["jira_tickets"]
                    break
    return jsonify({"session_id": session_id, "link": link, "jira_tickets": meta["jira_tickets"]})


@app.route("/api/session/<session_id>/unassign-jira", methods=["POST"])
def api_session_unassign_jira(session_id):
    full = os.path.realpath(os.path.join(SESSION_DIR, session_id))
    if not full.startswith(os.path.realpath(SESSION_DIR)) or not os.path.isdir(full):
        return jsonify({"error": "Session not found"}), 404
    data = request.get_json(force=True)
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        return jsonify({"error": "ticket_id required"}), 400
    meta = read_session_meta(full)
    before = len(meta.get("jira_tickets", []))
    meta["jira_tickets"] = [link for link in meta.get("jira_tickets", []) if link.get("ticket_id") != ticket_id]
    after = len(meta["jira_tickets"])
    if before == after:
        return jsonify({"error": "Jira ticket was not assigned to this session"}), 404
    write_session_meta(full, meta)
    with _bg_lock:
        if _bg_cache.get('copilot_sessions') is not None:
            for s in _bg_cache['copilot_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = meta["jira_tickets"]
                    break
    return jsonify({"session_id": session_id, "removed": ticket_id, "jira_tickets": meta["jira_tickets"]})


# ── Claude session Jira ticket endpoints ────────────────────────────────────

@app.route("/api/claude/session/<session_id>/jira-ticket", methods=["GET"])
def api_claude_session_jira_ticket_get(session_id):
    meta = claude_read_session_meta(session_id)
    tickets = meta.get("jira_tickets", [])
    return jsonify(tickets)


@app.route("/api/claude/session/<session_id>/jira-ticket", methods=["POST"])
def api_claude_session_jira_ticket_post(session_id):
    data = request.get_json(force=True)
    ticket_id = data.get("id") or _unique_ts_id()
    ticket_data = {
        "id": ticket_id,
        "ticket_key": (data.get("ticket_key") or "").strip().upper(),
        "title": (data.get("title") or "").strip(),
        "status": (data.get("status") or "").strip(),
        "assignee": (data.get("assignee") or "").strip(),
        "role": (data.get("role") or "").strip(),
    }
    meta = claude_read_session_meta(session_id)
    tickets = meta.get("jira_tickets", [])
    found = False
    for i, t in enumerate(tickets):
        if t.get("id") == ticket_id:
            tickets[i] = ticket_data
            found = True
            break
    if not found:
        tickets.append(ticket_data)
    meta["jira_tickets"] = tickets
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": session_id, "jira_tickets": tickets})


@app.route("/api/claude/session/<session_id>/jira-ticket/<ticket_id>", methods=["DELETE"])
def api_claude_session_jira_ticket_delete(session_id, ticket_id):
    meta = claude_read_session_meta(session_id)
    tickets = [t for t in meta.get("jira_tickets", []) if t.get("id") != ticket_id]
    meta["jira_tickets"] = tickets
    claude_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('claude_sessions') is not None:
            for s in _bg_cache['claude_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": session_id, "deleted": True})


# ───────────────────────────────────────────────────────────────────────────
# Codex session endpoints
# ───────────────────────────────────────────────────────────────────────────

def _codex_session_exists(session_id):
    return codex_find_session_jsonl(session_id) is not None


@app.route("/api/codex/sessions/bulk-delete", methods=["POST"])
def api_codex_bulk_delete():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No session IDs provided"}), 400

    deleted = []
    errors = []
    for sid in ids:
        path = codex_find_session_jsonl(sid)
        if not path:
            deleted.append(sid)
            continue
        try:
            os.remove(path)
            deleted.append(sid)
        except Exception as e:
            errors.append({"id": sid, "error": str(e)})

    if deleted:
        with _bg_lock:
            if _bg_cache.get('codex_sessions') is not None:
                _bg_cache['codex_sessions'] = [s for s in _bg_cache['codex_sessions'] if s['id'] not in deleted]
        meta = codex_load_all_meta()
        for sid in deleted:
            meta.pop(sid, None)
        codex_save_all_meta(meta)
    return jsonify({"deleted": deleted, "errors": errors})


@app.route("/api/codex/session/<session_id>", methods=["DELETE"])
def api_codex_session_delete(session_id):
    path = codex_find_session_jsonl(session_id)
    if path:
        try:
            os.remove(path)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            _bg_cache['codex_sessions'] = [s for s in _bg_cache['codex_sessions'] if s['id'] != session_id]
    meta = codex_load_all_meta()
    meta.pop(session_id, None)
    codex_save_all_meta(meta)
    return jsonify({"deleted": session_id})


@app.route("/api/codex/session/<session_id>/rename", methods=["POST"])
def api_codex_session_rename(session_id):
    if not _codex_session_exists(session_id):
        return jsonify({"error": "Not a Codex session"}), 404
    data = request.get_json(force=True)
    nickname = (data.get("nickname") or "").strip()
    meta = codex_read_session_meta(session_id)
    meta["nickname"] = nickname
    codex_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['nickname'] = nickname
                    if nickname:
                        s['summary'] = nickname
                    break
    return jsonify({"id": session_id, "nickname": nickname})


@app.route("/api/codex/session/<session_id>/star", methods=["POST"])
def api_codex_session_star(session_id):
    if not _codex_session_exists(session_id):
        return jsonify({"error": "Not a Codex session"}), 404
    meta = codex_read_session_meta(session_id)
    meta["starred"] = not meta.get("starred", False)
    codex_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['starred'] = meta["starred"]
                    break
    return jsonify({"id": session_id, "starred": meta["starred"]})


@app.route("/api/codex/session/<session_id>/archive", methods=["POST"])
def api_codex_session_archive(session_id):
    if not _codex_session_exists(session_id):
        return jsonify({"error": "Not a Codex session"}), 404
    meta = codex_read_session_meta(session_id)
    meta["archived"] = not meta.get("archived", False)
    codex_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['archived'] = meta["archived"]
                    break
    return jsonify({"id": session_id, "archived": meta["archived"]})


@app.route("/api/codex/session/<session_id>/workspace", methods=["POST"])
def api_codex_session_workspace_set(session_id):
    if not _codex_session_exists(session_id):
        return jsonify({"error": "Not a Codex session"}), 404
    data = request.get_json(force=True)
    ws_id = data.get("workspace_id")
    meta = codex_read_session_meta(session_id)
    meta["workspace"] = ws_id
    codex_write_session_meta(session_id, meta)
    codex_write_workspace_meta(session_id, ws_id)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['workspace'] = ws_id
                    break
    if ws_id:
        _emit_event("session_assigned", "Session assigned to workspace", {"session_id": session_id, "workspace_id": ws_id})
    return jsonify({"id": session_id, "workspace": ws_id})


@app.route("/api/codex/session/<session_id>/notes", methods=["GET"])
def api_codex_session_notes_get(session_id):
    notes_list = NoteDB.list_by_session(session_id)
    notes = [
        {
            "text": n.get("text", ""),
            "timestamp": n.get("created_at", "").isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at", "")
        }
        for n in notes_list
    ]
    return jsonify({"notes": notes})


@app.route("/api/codex/session/<session_id>/notes", methods=["POST"])
def api_codex_session_notes_post(session_id):
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Note text required"}), 400
    import uuid
    note_id = f"note_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    NoteDB.create({
        "note_id": note_id,
        "session_id": session_id,
        "workspace_id": "",
        "text": text,
        "created_at": now_iso,
        "updated_at": now_iso,
    })
    notes_list = NoteDB.list_by_session(session_id)
    _emit_event("note_created", "Note added to session", {"session_id": session_id})
    return jsonify({"id": session_id, "note": {"text": text, "timestamp": now_iso}, "total": len(notes_list)})


@app.route("/api/codex/session/<session_id>/notes", methods=["DELETE"])
def api_codex_session_notes_delete(session_id):
    data = request.get_json(force=True)
    idx = data.get("index")
    if idx is None:
        return jsonify({"error": "index required"}), 400
    notes_list = NoteDB.list_by_session(session_id)
    if idx < 0 or idx >= len(notes_list):
        return jsonify({"error": "index out of range"}), 400
    note_id = notes_list[idx].get("note_id")
    if note_id:
        NoteDB.delete(note_id)
    notes_list = NoteDB.list_by_session(session_id)
    return jsonify({"id": session_id, "deleted": True, "total": len(notes_list)})


@app.route("/api/codex/session/<session_id>/mr", methods=["GET"])
def api_codex_session_mr_get(session_id):
    meta = codex_read_session_meta(session_id)
    mrs = _enrich_session_mrs(meta.get("mrs", []))
    return jsonify({"id": session_id, "mrs": mrs})


@app.route("/api/codex/session/<session_id>/mr", methods=["POST"])
def api_codex_session_mr_post(session_id):
    if not _codex_session_exists(session_id):
        return jsonify({"error": "Not a Codex session"}), 404
    data = request.get_json(force=True)
    mr_data = data.get("mr") or {}
    if not mr_data:
        return jsonify({"error": "MR data required"}), 400
    meta = codex_read_session_meta(session_id)
    mrs = meta.get("mrs", [])
    mrs.append(mr_data)
    meta["mrs"] = mrs
    codex_write_session_meta(session_id, meta)
    enriched = _enrich_session_mrs(mrs)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = enriched
                    break
    return jsonify({"id": session_id, "mrs": enriched})


@app.route("/api/codex/session/<session_id>/mr/<mr_id>", methods=["DELETE"])
def api_codex_session_mr_delete(session_id, mr_id):
    meta = codex_read_session_meta(session_id)
    mrs = meta.get("mrs", [])
    mrs = [mr for mr in mrs if mr.get("id") != mr_id and mr.get("mr_id") != mr_id]
    meta["mrs"] = mrs
    codex_write_session_meta(session_id, meta)
    enriched = _enrich_session_mrs(mrs)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['mrs'] = enriched
                    break
    return jsonify({"id": session_id, "deleted": True})


@app.route("/api/codex/session/<session_id>/jira-ticket", methods=["GET"])
def api_codex_session_jira_ticket_get(session_id):
    meta = codex_read_session_meta(session_id)
    tickets = meta.get("jira_tickets", [])
    return jsonify({"id": session_id, "jira_tickets": tickets})


@app.route("/api/codex/session/<session_id>/jira-ticket", methods=["POST"])
def api_codex_session_jira_ticket_post(session_id):
    data = request.get_json(force=True)
    ticket_data = data.get("ticket") or {}
    if not ticket_data:
        return jsonify({"error": "Ticket data required"}), 400
    meta = codex_read_session_meta(session_id)
    tickets = meta.get("jira_tickets", [])
    found = False
    for i, t in enumerate(tickets):
        if t.get("id") == ticket_data.get("id"):
            tickets[i] = ticket_data
            found = True
            break
    if not found:
        tickets.append(ticket_data)
    meta["jira_tickets"] = tickets
    codex_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": session_id, "jira_tickets": tickets})


@app.route("/api/codex/session/<session_id>/jira-ticket/<ticket_id>", methods=["DELETE"])
def api_codex_session_jira_ticket_delete(session_id, ticket_id):
    meta = codex_read_session_meta(session_id)
    tickets = [t for t in meta.get("jira_tickets", []) if t.get("id") != ticket_id]
    meta["jira_tickets"] = tickets
    codex_write_session_meta(session_id, meta)
    with _bg_lock:
        if _bg_cache.get('codex_sessions') is not None:
            for s in _bg_cache['codex_sessions']:
                if s['id'] == session_id:
                    s['jira_tickets'] = tickets
                    break
    return jsonify({"id": session_id, "deleted": True})


@app.route("/api/codex/session/<session_id>/file")
def api_codex_session_file(session_id):
    """Read a file from a Codex session artifact directory."""
    rel_path = request.args.get("path", "")
    full, scope = _codex_resolve_file(session_id, rel_path)
    if not full:
        return jsonify({"error": "File not found"}), 404
    if not os.path.isfile(full):
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
            "editable": scope == "artifact",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/codex/session/<session_id>/file/raw")
def api_codex_session_file_raw(session_id):
    """Serve a Codex session file raw."""
    rel_path = request.args.get("path", "")
    full, _scope = _codex_resolve_file(session_id, rel_path)
    if not full or not os.path.isfile(full):
        return "File not found", 404
    return send_file(full)


@app.route("/api/codex/session/<session_id>/file", methods=["PUT"])
def api_codex_session_file_write(session_id):
    """Write content to a Codex session artifact file."""
    data = request.get_json(force=True)
    rel_path = data.get("path", "")
    content = data.get("content")
    full, scope = _codex_resolve_file(session_id, rel_path)
    if not full or scope != "artifact" or content is None:
        return jsonify({"error": "Invalid path or missing content"}), 400
    if not os.path.isfile(full):
        return jsonify({"error": "File not found"}), 404
    try:
        with open(full, "w") as f:
            f.write(content)
        return jsonify({"ok": True, "size": len(content)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
            match = re.search(r"\[(\S+)\s+([a-f0-9]+)\]\s+(.*?)(?:\n|$)", result_text)
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
