import json
from pathlib import Path


def test_hermes_seed_marker_auto_assigns_workspace(client, sample_workspace, tmp_path, monkeypatch):
    import app as app_module

    hermes_root = tmp_path / "hermes"
    sessions_dir = hermes_root / "sessions"
    meta_dir = hermes_root / ".savant-meta"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(app_module, "HERMES_DIR", str(hermes_root))
    monkeypatch.setattr(app_module, "HERMES_SESSIONS_DIR", str(sessions_dir))
    monkeypatch.setattr(app_module, "HERMES_META_DIR", str(meta_dir))
    monkeypatch.setattr(app_module, "HERMES_STATE_DB", str(hermes_root / "state.db"))

    sid = "sess_launch_1"
    seed = f"Implement feature kickoff [[SAVANT:WS={sample_workspace};NAME=Launch Session]]"
    payload = {
        "model": "test-model",
        "platform": "cli",
        "session_start": "2026-04-18T00:00:00+00:00",
        "last_updated": "2026-04-18T00:00:10+00:00",
        "messages": [
            {"role": "user", "content": seed}
        ],
    }
    (sessions_dir / f"session_{sid}.json").write_text(json.dumps(payload), encoding="utf-8")

    res = client.get("/api/hermes/sessions")
    assert res.status_code == 200
    data = res.get_json()
    sessions = data.get("sessions", [])
    assert sessions, "Expected at least one Hermes session"

    s = sessions[0]
    assert s["id"] == sid
    assert s.get("workspace") == sample_workspace
    assert "SAVANT:WS=" not in (s.get("summary") or "")
    assert s.get("summary") == "Launch Session"
    assert "SAVANT:WS=" not in (s.get("last_intent") or "")
    assert (s.get("last_intent") or "").startswith("Implement feature kickoff")


def test_workspace_new_session_ui_hooks_exist():
    index_html = Path("savant/templates/index.html").read_text(encoding="utf-8")
    ws_js = Path("savant/static/js/workspaces.js").read_text(encoding="utf-8")

    assert 'id="ws-new-session-modal"' in index_html
    assert 'id="ws-new-session-name"' in index_html
    assert 'id="ws-new-session-repo"' in index_html
    assert 'id="ws-new-session-seed"' in index_html
    assert 'id="ws-new-session-provider"' in index_html

    assert "openWsNewSessionModal" in ws_js
    assert "browseWsNewSessionRepo" in ws_js
    assert "startWsNewSession" in ws_js
    assert "_getEnabledSessionProviders" in ws_js
    assert "_providerLaunchCommand" in ws_js
