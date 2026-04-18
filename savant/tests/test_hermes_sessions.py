"""Tests for Hermes session ingestion and provider endpoints."""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _make_hermes_session(session_id="20260415_091817_de93bc", model="claude-opus-4.6"):
    """Build a realistic Hermes session JSON payload."""
    return {
        "session_id": session_id,
        "model": model,
        "base_url": "https://api.githubcopilot.com",
        "platform": "cli",
        "session_start": "2026-04-15T09:18:17.040230",
        "last_updated": "2026-04-15T09:18:40.067219",
        "system_prompt": "You are a helpful assistant.",
        "tools": ["terminal", "read_file", "patch"],
        "message_count": 6,
        "messages": [
            {"role": "user", "content": "fix the login bug in auth.py"},
            {
                "role": "assistant",
                "content": "Let me check the auth module.",
                "finish_reason": "tool_calls",
                "reasoning": "",
                "tool_calls": [
                    {
                        "id": "call_001",
                        "call_id": "call_001",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": json.dumps({"path": "/tmp/project/auth.py"}),
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "content": "def login(user):\n    return True",
                "tool_call_id": "call_001",
            },
            {
                "role": "assistant",
                "content": "I see the issue. Let me fix it.",
                "finish_reason": "tool_calls",
                "reasoning": "",
                "tool_calls": [
                    {
                        "id": "call_002",
                        "call_id": "call_002",
                        "type": "function",
                        "function": {
                            "name": "patch",
                            "arguments": json.dumps({
                                "path": "/tmp/project/auth.py",
                                "old_string": "return True",
                                "new_string": "return validate(user)",
                            }),
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "content": "Patch applied successfully.",
                "tool_call_id": "call_002",
            },
            {
                "role": "assistant",
                "content": "Fixed! The login function now validates the user properly.",
                "finish_reason": "stop",
                "reasoning": "",
                "tool_calls": [],
            },
        ],
    }


@pytest.fixture
def hermes_dir(tmp_path, monkeypatch):
    """Set up a temporary Hermes sessions directory with a test session."""
    hdir = tmp_path / "hermes"
    sessions = hdir / "sessions"
    sessions.mkdir(parents=True)
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "20260415_091817_de93bc"
    payload = _make_hermes_session(session_id)
    (sessions / f"session_{session_id}.json").write_text(json.dumps(payload))

    # Write meta with workspace + star
    (meta_dir / f"{session_id}.json").write_text(
        json.dumps({"workspace": "ws-h1", "starred": True, "nickname": "Auth Fix"})
    )

    monkeypatch.setenv("HERMES_DIR", str(hdir))
    import app as app_mod

    monkeypatch.setattr(app_mod, "HERMES_DIR", str(hdir))
    monkeypatch.setattr(app_mod, "HERMES_SESSIONS_DIR", str(sessions))
    monkeypatch.setattr(app_mod, "HERMES_META_DIR", str(meta_dir))
    # Point state.db to a nonexistent path so the fallback (each JSON = standalone) kicks in
    monkeypatch.setattr(app_mod, "HERMES_STATE_DB", str(hdir / "state.db"))
    app_mod._bg_cache["hermes_sessions"] = None
    app_mod._bg_cache["hermes_usage"] = None
    return {"session_id": session_id, "sessions_dir": str(sessions), "meta_dir": str(meta_dir)}


@pytest.fixture
def hermes_client(_isolated_db, hermes_dir):
    from app import app

    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Session list ─────────────────────────────────────────────────────────────

def test_hermes_sessions_list(hermes_client, hermes_dir):
    resp = hermes_client.get("/api/hermes/sessions")
    assert resp.status_code == 200
    data = resp.get_json()
    sessions = data["sessions"]
    assert len(sessions) == 1
    s = sessions[0]
    assert s["id"] == hermes_dir["session_id"]
    assert s["provider"] == "hermes"
    assert s["summary"] == "Auth Fix"  # nickname takes precedence
    assert s["starred"] is True
    assert s["workspace"] == "ws-h1"
    assert s["model"] == "claude-opus-4.6"
    assert s["turn_count"] == 1  # 1 user message
    assert s["tool_call_count"] == 2  # read_file + patch


def test_hermes_sessions_list_empty(hermes_client, hermes_dir):
    """Pagination beyond available sessions returns empty list."""
    resp = hermes_client.get("/api/hermes/sessions?offset=100")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["sessions"] == []
    assert data["total"] == 1


# ── Session detail ───────────────────────────────────────────────────────────

def test_hermes_session_detail(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/api/hermes/session/{sid}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["id"] == sid
    assert data["provider"] == "hermes"
    assert data["model"] == "claude-opus-4.6"
    assert data["message_count"] == 6
    assert data["turn_count"] == 1
    assert data["tool_call_count"] == 2
    assert "read_file" in data["tools_used"]
    assert "patch" in data["tools_used"]


def test_hermes_session_detail_not_found(hermes_client):
    resp = hermes_client.get("/api/hermes/session/nonexistent")
    assert resp.status_code == 404


# ── Conversation ─────────────────────────────────────────────────────────────

def test_hermes_session_conversation(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/api/hermes/session/{sid}/conversation")
    assert resp.status_code == 200
    data = resp.get_json()

    conv = data["conversation"]
    assert len(conv) == 6  # user_message, assistant+tool_start, assistant+tool_start, assistant
    assert conv[0]["type"] == "user_message"
    assert conv[0]["content"] == "fix the login bug in auth.py"
    assert conv[1]["type"] == "assistant_message"
    assert conv[1]["tool_requests"] is not None
    assert conv[1]["tool_requests"][0]["tool_name"] == "read_file"

    stats = data["stats"]
    assert stats["tool_calls"] == 2
    assert stats["user_messages"] == 1
    assert "read_file" in [v["name"] for v in data["tools"].values()]

    tools = data["tools"]
    assert "call_001" in tools
    assert tools["call_001"]["name"] == "read_file"
    assert tools["call_001"]["result"] is not None


# ── Workspace assignment ─────────────────────────────────────────────────────

def test_hermes_session_workspace_assign(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(
        f"/api/hermes/session/{sid}/workspace",
        json={"workspace_id": "ws-new"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["workspace"] == "ws-new"

    # Verify it persists
    detail = hermes_client.get(f"/api/hermes/session/{sid}").get_json()
    assert detail["workspace"] == "ws-new"


def test_hermes_session_workspace_not_found(hermes_client):
    resp = hermes_client.post(
        "/api/hermes/session/nonexistent/workspace",
        json={"workspace_id": "ws-1"},
    )
    assert resp.status_code == 404


# ── Star / Archive / Rename ──────────────────────────────────────────────────

def test_hermes_session_star_toggle(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    # Initially starred=True, toggle to False
    resp = hermes_client.post(f"/api/hermes/session/{sid}/star")
    assert resp.status_code == 200
    assert resp.get_json()["starred"] is False

    # Toggle back
    resp2 = hermes_client.post(f"/api/hermes/session/{sid}/star")
    assert resp2.get_json()["starred"] is True


def test_hermes_session_archive_toggle(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(f"/api/hermes/session/{sid}/archive")
    assert resp.status_code == 200
    assert resp.get_json()["archived"] is True

    resp2 = hermes_client.post(f"/api/hermes/session/{sid}/archive")
    assert resp2.get_json()["archived"] is False


def test_hermes_session_rename(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(
        f"/api/hermes/session/{sid}/rename",
        json={"nickname": "New Name"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["nickname"] == "New Name"

    # Verify rename shows up in session list
    sessions = hermes_client.get("/api/hermes/sessions").get_json()["sessions"]
    assert sessions[0]["summary"] == "New Name"


def test_hermes_session_rename_clear(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(
        f"/api/hermes/session/{sid}/rename",
        json={"nickname": ""},
    )
    assert resp.status_code == 200
    assert resp.get_json()["nickname"] == ""


# ── Notes ────────────────────────────────────────────────────────────────────

def test_hermes_session_notes_crud(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]

    # Empty initially
    resp = hermes_client.get(f"/api/hermes/session/{sid}/notes")
    assert resp.status_code == 200
    assert resp.get_json()["notes"] == []

    # Create note
    resp = hermes_client.post(
        f"/api/hermes/session/{sid}/notes",
        json={"text": "Important finding"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["total"] == 1

    # Read back
    resp = hermes_client.get(f"/api/hermes/session/{sid}/notes")
    notes = resp.get_json()["notes"]
    assert len(notes) == 1
    assert notes[0]["text"] == "Important finding"

    # Delete
    resp = hermes_client.delete(
        f"/api/hermes/session/{sid}/notes",
        json={"index": 0},
    )
    assert resp.status_code == 200
    assert resp.get_json()["deleted"] is True

    # Verify empty again
    resp = hermes_client.get(f"/api/hermes/session/{sid}/notes")
    assert resp.get_json()["notes"] == []


def test_hermes_session_notes_empty_text_rejected(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(
        f"/api/hermes/session/{sid}/notes",
        json={"text": ""},
    )
    assert resp.status_code == 400


def test_hermes_session_notes_delete_invalid_index(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.delete(
        f"/api/hermes/session/{sid}/notes",
        json={"index": 99},
    )
    assert resp.status_code == 400


# ── Project files ────────────────────────────────────────────────────────────

def test_hermes_session_project_files(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/api/hermes/session/{sid}/project-files")
    assert resp.status_code == 200
    data = resp.get_json()
    files = data["files"]
    assert len(files) == 1
    assert files[0]["path"] == "/tmp/project/auth.py"
    assert files[0]["action"] == "edit"  # patch => edit takes precedence
    assert files[0]["count"] == 2  # read_file + patch


# ── Git changes ──────────────────────────────────────────────────────────────

def test_hermes_session_git_changes_empty(hermes_client, hermes_dir):
    """Session with no terminal git commands should return empty results."""
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/api/hermes/session/{sid}/git-changes")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["commits"] == []
    assert data["git_commands"] == []
    # But file_changes should include write/patch calls
    assert len(data["file_changes"]) == 1  # just the patch


# ── Search ───────────────────────────────────────────────────────────────────

def test_hermes_search(hermes_client, hermes_dir):
    resp = hermes_client.get("/api/hermes/search?q=login")
    assert resp.status_code == 200
    results = resp.get_json()["results"]
    assert len(results) >= 1
    assert results[0]["session_id"] == hermes_dir["session_id"]
    assert results[0]["provider"] == "hermes"


def test_hermes_search_no_match(hermes_client, hermes_dir):
    resp = hermes_client.get("/api/hermes/search?q=nonexistentxyz")
    assert resp.status_code == 200
    assert resp.get_json()["results"] == []


def test_hermes_search_too_short(hermes_client, hermes_dir):
    resp = hermes_client.get("/api/hermes/search?q=a")
    assert resp.status_code == 200
    assert "error" in resp.get_json()


# ── Convert prompt ───────────────────────────────────────────────────────────

def test_hermes_convert_prompt(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/api/hermes/session/{sid}/convert-prompt")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["session_id"] == sid
    assert "prompt" in data
    assert data["char_count"] > 0


# ── Usage ────────────────────────────────────────────────────────────────────

def test_hermes_usage(hermes_client, hermes_dir):
    # Force build usage (cache is None so it returns loading=True)
    import app as app_mod

    usage_data = app_mod._build_hermes_usage()
    assert usage_data["totals"]["sessions"] == 1
    assert usage_data["totals"]["messages"] == 1  # 1 user message
    assert usage_data["totals"]["turns"] == 3  # 3 assistant messages
    assert usage_data["totals"]["tool_calls"] == 2
    models = {m["name"] for m in usage_data["models"]}
    assert "claude-opus-4.6" in models
    tools = {t["name"] for t in usage_data["tools"]}
    assert "read_file" in tools
    assert "patch" in tools


# ── Delete ───────────────────────────────────────────────────────────────────

def test_hermes_session_delete(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]

    # Confirm it exists first
    resp = hermes_client.get(f"/api/hermes/session/{sid}")
    assert resp.status_code == 200

    # Delete it
    resp = hermes_client.delete(f"/api/hermes/session/{sid}")
    assert resp.status_code == 200
    assert resp.get_json()["deleted"] == sid

    # Should be gone from list
    resp = hermes_client.get("/api/hermes/sessions")
    assert resp.status_code == 200
    assert resp.get_json()["sessions"] == []


def test_hermes_bulk_delete(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.post(
        "/api/hermes/sessions/bulk-delete",
        json={"ids": [sid, "nonexistent"]},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert sid in data["deleted"]

    # Verify empty
    resp = hermes_client.get("/api/hermes/sessions")
    assert resp.get_json()["sessions"] == []


def test_hermes_bulk_delete_no_ids(hermes_client):
    resp = hermes_client.post(
        "/api/hermes/sessions/bulk-delete",
        json={"ids": []},
    )
    assert resp.status_code == 400


# ── Detail page route ────────────────────────────────────────────────────────

def test_hermes_detail_page_renders(hermes_client, hermes_dir):
    sid = hermes_dir["session_id"]
    resp = hermes_client.get(f"/hermes/session/{sid}")
    assert resp.status_code == 200
    # Should render the detail.html template
    assert b"html" in resp.data.lower() or resp.content_type.startswith("text/html")
