import json
import os

os.environ["SAVANT_DISABLE_BG_CACHE"] = "1"

from app import app


def _client():
    app.config["TESTING"] = True
    return app.test_client()


def test_db_health_ok():
    c = _client()
    r = c.get("/api/db/health")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, dict)
    assert data.get("status") == "healthy"
    assert data.get("connected") is True


def test_system_info_has_ports():
    c = _client()
    r = c.get("/api/system/info")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, dict)
    assert "mcp_servers" in data
    assert isinstance(data["mcp_servers"], dict)


def test_events_endpoint_returns_list():
    c = _client()
    r = c.get("/api/events?since=0")
    assert r.status_code == 200
    data = r.get_json()
    assert isinstance(data, list)


def test_preferences_get_and_post_roundtrip():
    c = _client()
    payload = {
        "name": "Demo User",
        "work_week": [1, 2, 3, 4, 5],
        "enabled_providers": ["hermes", "codex"],
        "theme": "dark",
        "terminal": {
            "externalTerminal": "auto",
            "shell": "/bin/zsh",
            "fontSize": 13,
            "scrollback": 5000,
            "customCommand": "",
        },
    }
    p = c.post("/api/preferences", data=json.dumps(payload), content_type="application/json")
    assert p.status_code == 200
    saved = p.get_json()
    assert saved["name"] == "Demo User"
    assert saved["theme"] == "dark"
    g = c.get("/api/preferences")
    assert g.status_code == 200
    loaded = g.get_json()
    assert loaded["name"] == "Demo User"
    assert loaded["terminal"]["fontSize"] == 13


def test_mcp_health_endpoint_shape():
    c = _client()
    r = c.get("/api/mcp/health/workspace")
    assert r.status_code in (200, 502, 503)
    data = r.get_json()
    assert isinstance(data, dict)
    assert "status" in data
