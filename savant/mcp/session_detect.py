"""
Session detection for AI coding sessions → workspace mapping.

Supports:
  - Copilot CLI: walks process tree to match PID lock files under
    ~/.copilot/session-state/ and reads workspace from .copilot-meta.json.
  - Claude Code: reads ~/.claude/sessions/<pid>.json written by the
    Claude Code CLI, then looks up workspace from savant meta files.
  - Codex CLI: uses env vars (CODEX_SESSION_ID / CODEX_SESSION_PATH) and
    workspace metadata stored under ~/.codex/.savant-meta/.
  - Hermes Agent: uses env vars (HERMES_SESSION_ID) and workspace metadata
    stored under ~/.hermes/.savant-meta/.
"""

import glob
import json
import os


COPILOT_SESSION_DIR = os.path.expanduser("~/.copilot/session-state")
CLAUDE_SESSIONS_DIR = os.path.expanduser("~/.claude/sessions")
CLAUDE_DIR = os.path.expanduser("~/.claude")
CODEX_DIR = os.path.expanduser("~/.codex")
GEMINI_DIR = os.path.expanduser("~/.gemini")
HERMES_DIR = os.path.expanduser("~/.hermes")


def _codex_dir() -> str:
    return os.environ.get("CODEX_DIR", CODEX_DIR)


def _codex_meta_dir() -> str:
    return os.path.join(_codex_dir(), ".savant-meta")


# ── Copilot detection ────────────────────────────────────────────────────────

def _find_session_by_pid(pid: int) -> dict | None:
    """Find session ID and workspace by matching a PID to a lock file."""
    pattern = os.path.join(COPILOT_SESSION_DIR, "*", f"inuse.{pid}.lock")
    matches = glob.glob(pattern)
    if not matches:
        return None

    session_dir = os.path.dirname(matches[0])
    session_id = os.path.basename(session_dir)

    # Read workspace from .copilot-meta.json
    meta_path = os.path.join(session_dir, ".copilot-meta.json")
    workspace_id = None
    if os.path.isfile(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            workspace_id = meta.get("workspace")
        except (json.JSONDecodeError, OSError):
            pass

    return {"session_id": session_id, "workspace_id": workspace_id}


# ── Claude Code detection ────────────────────────────────────────────────────

def _find_claude_session_by_pid(pid: int) -> dict | None:
    """Match a PID to a Claude Code session file (~/.claude/sessions/<pid>.json)."""
    session_file = os.path.join(CLAUDE_SESSIONS_DIR, f"{pid}.json")
    if not os.path.isfile(session_file):
        return None

    try:
        with open(session_file) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    session_id = data.get("sessionId")
    if not session_id:
        return None

    # Look up workspace from savant meta (stored per-session in ~/.claude)
    workspace_id = _claude_read_workspace(session_id)

    return {
        "session_id": session_id,
        "workspace_id": workspace_id,
        "provider": "claude",
    }


def _claude_read_workspace(session_id: str) -> str | None:
    """Read workspace assignment from savant meta for a Claude session."""
    meta_dir = os.path.join(CLAUDE_DIR, ".savant-meta")
    meta_path = os.path.join(meta_dir, f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f).get("workspace")
    except (json.JSONDecodeError, OSError):
        return None


# ── Codex detection ─────────────────────────────────────────────────────────

def _codex_read_workspace(session_id: str) -> str | None:
    """Read workspace assignment from Savant meta for a Codex session."""
    meta_path = os.path.join(_codex_meta_dir(), f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f).get("workspace")
    except (json.JSONDecodeError, OSError):
        return None


def _find_codex_session_by_env() -> dict | None:
    """Match a Codex session using env vars (CODEX_SESSION_ID or CODEX_SESSION_PATH)."""
    session_id = os.environ.get("CODEX_SESSION_ID") or os.environ.get("CODEX_SESSION")
    session_path = os.environ.get("CODEX_SESSION_PATH") or os.environ.get("CODEX_SESSION_LOG")
    if not session_id and session_path and os.path.isfile(session_path):
        try:
            with open(session_path) as f:
                first = f.readline().strip()
            data = json.loads(first) if first else {}
            session_id = data.get("id")
        except Exception:
            session_id = None
    if not session_id:
        return None
    return {
        "session_id": session_id,
        "workspace_id": _codex_read_workspace(session_id),
        "provider": "codex",
    }


# ── Gemini detection ─────────────────────────────────────────────────────────

def _gemini_read_workspace(session_id: str) -> str | None:
    """Read workspace assignment from Savant meta for a Gemini session."""
    meta_dir = os.path.join(GEMINI_DIR, ".savant-meta")
    meta_path = os.path.join(meta_dir, f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f).get("workspace")
    except (json.JSONDecodeError, OSError):
        return None


def _find_gemini_session_by_pid(pid: int) -> dict | None:
    """Detect if the PID is a gemini process and get the current session."""
    try:
        cmdline = os.popen(f"ps -p {pid} -o comm=").read().strip()
        if "gemini" not in cmdline.lower() and "node" not in cmdline.lower():
            return None
    except Exception:
        return None

    # Read the latest session from logs.json
    logs_file = os.path.join(GEMINI_DIR, "tmp", "savant-app", "logs.json")
    session_id = None
    if os.path.isfile(logs_file):
        try:
            with open(logs_file) as f:
                logs = json.load(f)
                if logs and isinstance(logs, list):
                    session_id = logs[-1].get("sessionId")
        except Exception:
            pass

    if not session_id:
        return None

    workspace_id = _gemini_read_workspace(session_id)
    return {
        "session_id": session_id,
        "workspace_id": workspace_id,
        "provider": "gemini",
    }


# ── Hermes detection ─────────────────────────────────────────────────────────

def _hermes_dir() -> str:
    return os.environ.get("HERMES_DIR", HERMES_DIR)


def _hermes_meta_dir() -> str:
    return os.path.join(_hermes_dir(), ".savant-meta")


def _hermes_read_workspace(session_id: str) -> str | None:
    """Read workspace assignment from Savant meta for a Hermes session."""
    meta_path = os.path.join(_hermes_meta_dir(), f"{session_id}.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f).get("workspace")
    except (json.JSONDecodeError, OSError):
        return None


def _find_hermes_session_by_env() -> dict | None:
    """Match a Hermes session using env vars (HERMES_SESSION_ID)."""
    session_id = os.environ.get("HERMES_SESSION_ID")
    if not session_id:
        return None
    return {
        "session_id": session_id,
        "workspace_id": _hermes_read_workspace(session_id),
        "provider": "hermes",
    }


# ── Unified detection ────────────────────────────────────────────────────────

def detect_session() -> dict:
    """
    Auto-detect the current AI coding session and its workspace.

    Tries Copilot CLI first (PID lock files), then Claude Code
    (~/.claude/sessions/<pid>.json), then Codex, Gemini, Hermes,
    then env var fallback.

    Returns dict with keys: session_id, workspace_id (may be None),
    provider ('copilot' | 'claude' | 'codex' | 'gemini' | 'hermes' | None).
    Raises RuntimeError if no session can be detected.
    """
    ppid = os.getppid()

    # 1. Copilot: try PPID then grandparent
    result = _find_session_by_pid(ppid)
    if result:
        result.setdefault("provider", "copilot")
        return result

    try:
        grandparent = os.popen(f"ps -o ppid= -p {ppid}").read().strip()
        if grandparent:
            result = _find_session_by_pid(int(grandparent))
            if result:
                result.setdefault("provider", "copilot")
                return result
    except (ValueError, OSError):
        pass

    # 2. Claude Code: try PPID then walk up ancestors
    result = _find_claude_session_by_pid(ppid)
    if result:
        return result

    # Walk up the process tree (Claude Code may be several levels up)
    try:
        current = ppid
        for _ in range(5):  # up to 5 levels
            parent = os.popen(f"ps -o ppid= -p {current}").read().strip()
            if not parent:
                break
            current = int(parent)
            result = _find_claude_session_by_pid(current)
            if result:
                return result
    except (ValueError, OSError):
        pass

    # 3. Codex: env-based session detection
    result = _find_codex_session_by_env()
    if result:
        return result

    # 4. Gemini CLI: env-based check or walk up ancestors
    if os.environ.get("GEMINI_CLI"):
        result = _find_gemini_session_by_pid(ppid)
        if result:
            return result
        
        try:
            current = ppid
            for _ in range(5):
                parent = os.popen(f"ps -o ppid= -p {current}").read().strip()
                if not parent:
                    break
                current = int(parent)
                result = _find_gemini_session_by_pid(current)
                if result:
                    return result
        except (ValueError, OSError):
            pass

    # 5. Hermes Agent: env-based session detection
    result = _find_hermes_session_by_env()
    if result:
        return result

    # 6. Fallback: env var override
    env_ws = os.environ.get("SAVANT_WORKSPACE_ID")
    env_session = os.environ.get("SAVANT_SESSION_ID")
    if env_ws or env_session:
        return {"session_id": env_session, "workspace_id": env_ws, "provider": None}

    raise RuntimeError(
        "Could not detect AI coding session. "
        "Assign a workspace manually via SAVANT_WORKSPACE_ID env var, "
        "or ensure this MCP is launched from within a Copilot CLI, Claude Code, Codex, Gemini, or Hermes session."
    )
