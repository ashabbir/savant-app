"""Regression tests for Codex session detection."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mcp"))

import session_detect


def test_find_codex_session_by_env_reads_workspace_from_codex_dir(tmp_path, monkeypatch):
    cdir = tmp_path / "codex"
    meta_dir = cdir / ".savant-meta"
    meta_dir.mkdir(parents=True)

    session_id = "0204cc81-99b8-4a9c-bc27-30c868cb48ea"
    (meta_dir / f"{session_id}.json").write_text(json.dumps({"workspace": "ws-test-1"}))

    monkeypatch.setenv("CODEX_DIR", str(cdir))
    monkeypatch.setenv("CODEX_SESSION_ID", session_id)

    result = session_detect._find_codex_session_by_env()

    assert result == {
        "session_id": session_id,
        "workspace_id": "ws-test-1",
        "provider": "codex",
    }
