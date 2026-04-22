import importlib
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"


def _load_server_app(tmp_path):
    os.environ["SAVANT_SERVER_DATA_DIR"] = str(tmp_path / "server-data")
    os.environ["SAVANT_ABILITIES_DIR"] = str(tmp_path / "server-data")
    os.environ["SAVANT_ABILITIES_SEED_DIR"] = str(ROOT / "savant" / "abilities")
    os.environ["SAVANT_DISABLE_BG_CACHE"] = "1"
    if str(SERVER_DIR) not in sys.path:
        sys.path.insert(0, str(SERVER_DIR))
    app_module = importlib.import_module("app")
    return importlib.reload(app_module)


def test_system_info_and_context_repos_endpoint(tmp_path):
    app_module = _load_server_app(tmp_path)
    client = app_module.app.test_client()

    info = client.get("/api/system/info")
    assert info.status_code == 200
    info_json = info.get_json()
    assert info_json["flask"]["status"] == "ok"
    assert info_json["build"]["version"] == "8.0.0"
    assert "database" in info_json
    assert "directories" in info_json

    repos = client.get("/api/context/repos")
    assert repos.status_code == 200
    repos_json = repos.get_json()
    assert isinstance(repos_json.get("repos", []), list)


def test_preferences_roundtrip_endpoint(tmp_path):
    app_module = _load_server_app(tmp_path)
    client = app_module.app.test_client()

    save_res = client.post(
        "/api/preferences",
        json={"name": "Integration User", "theme": "dark", "enabled_providers": ["copilot", "claude"]},
    )
    assert save_res.status_code == 200
    saved = save_res.get_json()
    assert saved["name"] == "Integration User"
    assert saved["theme"] == "dark"

    get_res = client.get("/api/preferences")
    assert get_res.status_code == 200
    got = get_res.get_json()
    assert got["name"] == "Integration User"
    assert got["theme"] == "dark"
