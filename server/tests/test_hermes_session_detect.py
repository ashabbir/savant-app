"""Tests for Hermes session detection in MCP session_detect module."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mcp"))

import session_detect


def test_find_hermes_session_by_env_reads_workspace(tmp_path, monkeypatch):
    """HERMES_SESSION_ID env var should resolve to a session with workspace."""
    hdir = tmp_path / "hermes"
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "20260415_091817_de93bc"
    (meta_dir / f"{session_id}.json").write_text(json.dumps({"workspace": "ws-hermes-1"}))

    monkeypatch.setenv("HERMES_DIR", str(hdir))
    monkeypatch.setenv("HERMES_SESSION_ID", session_id)

    result = session_detect._find_hermes_session_by_env()

    assert result == {
        "session_id": session_id,
        "workspace_id": "ws-hermes-1",
        "provider": "hermes",
    }


def test_find_hermes_session_by_env_no_workspace(tmp_path, monkeypatch):
    """HERMES_SESSION_ID with no meta file should return workspace_id=None."""
    hdir = tmp_path / "hermes"
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "20260415_092054_810db8"
    monkeypatch.setenv("HERMES_DIR", str(hdir))
    monkeypatch.setenv("HERMES_SESSION_ID", session_id)

    result = session_detect._find_hermes_session_by_env()

    assert result == {
        "session_id": session_id,
        "workspace_id": None,
        "provider": "hermes",
    }


def test_find_hermes_session_by_env_no_env_var(monkeypatch):
    """Without HERMES_SESSION_ID env var, detection should return None."""
    monkeypatch.delenv("HERMES_SESSION_ID", raising=False)
    result = session_detect._find_hermes_session_by_env()
    assert result is None


def test_hermes_read_workspace_missing_file(tmp_path, monkeypatch):
    """_hermes_read_workspace should return None for nonexistent meta."""
    hdir = tmp_path / "hermes"
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    monkeypatch.setenv("HERMES_DIR", str(hdir))
    result = session_detect._hermes_read_workspace("nonexistent-id")
    assert result is None


def test_hermes_read_workspace_corrupt_json(tmp_path, monkeypatch):
    """_hermes_read_workspace should return None for corrupt JSON."""
    hdir = tmp_path / "hermes"
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "corrupt_session"
    (meta_dir / f"{session_id}.json").write_text("{invalid json")

    monkeypatch.setenv("HERMES_DIR", str(hdir))
    result = session_detect._hermes_read_workspace(session_id)
    assert result is None


def test_detect_session_finds_hermes_via_env(tmp_path, monkeypatch):
    """detect_session() should find Hermes sessions via env when no other provider matches."""
    hdir = tmp_path / "hermes"
    meta_dir = hdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "20260415_091350_44407f"
    (meta_dir / f"{session_id}.json").write_text(json.dumps({"workspace": "ws-h"}))

    # Clear all other provider env vars
    monkeypatch.delenv("CODEX_SESSION_ID", raising=False)
    monkeypatch.delenv("CODEX_SESSION", raising=False)
    monkeypatch.delenv("CODEX_SESSION_PATH", raising=False)
    monkeypatch.delenv("CODEX_SESSION_LOG", raising=False)
    monkeypatch.delenv("GEMINI_CLI", raising=False)
    monkeypatch.delenv("SAVANT_WORKSPACE_ID", raising=False)
    monkeypatch.delenv("SAVANT_SESSION_ID", raising=False)

    monkeypatch.setenv("HERMES_DIR", str(hdir))
    monkeypatch.setenv("HERMES_SESSION_ID", session_id)

    # Patch session dirs so Copilot/Claude don't match
    monkeypatch.setattr(session_detect, "COPILOT_SESSION_DIR", str(tmp_path / "no-copilot"))
    monkeypatch.setattr(session_detect, "CLAUDE_SESSIONS_DIR", str(tmp_path / "no-claude"))

    result = session_detect.detect_session()
    assert result["session_id"] == session_id
    assert result["provider"] == "hermes"
    assert result["workspace_id"] == "ws-h"
