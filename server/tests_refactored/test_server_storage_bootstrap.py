from pathlib import Path

from abilities import bootstrap as bootstrap_module
from abilities.bootstrap import _resolve_seed_base, seed_abilities_if_missing
from server_paths import (
    _default_data_dir,
    get_server_abilities_base_dir,
    get_server_data_dir,
    get_server_db_path,
)
from sqlite_client import SQLiteClient


def test_abilities_seeded_when_missing(monkeypatch, tmp_path):
    data_dir = tmp_path / "data"
    seed_dir = tmp_path / "seed"
    seed_file = seed_dir / "abilities" / "personas" / "engineer.md"
    seed_file.parent.mkdir(parents=True, exist_ok=True)
    seed_file.write_text(
        "---\nid: persona.engineer\ntype: persona\ntags: [engineering]\npriority: 100\n---\nbody\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("SAVANT_SERVER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SAVANT_ABILITIES_SEED_DIR", str(seed_dir))

    result = seed_abilities_if_missing()
    assert result["seeded"] is True
    assert (data_dir / "abilities" / "personas" / "engineer.md").exists()

    # second run should no-op
    result2 = seed_abilities_if_missing()
    assert result2["seeded"] is False
    assert result2["reason"] == "already-populated"


def test_sqlite_connect_creates_db_when_missing(tmp_path):
    db_path = tmp_path / "mounted-data" / "savant.db"
    c = SQLiteClient()
    c.connect(str(db_path))
    try:
        assert db_path.exists()
    finally:
        c.disconnect()


def test_seed_returns_missing_when_seed_path_absent(monkeypatch, tmp_path):
    data_dir = tmp_path / "data"
    missing_seed = tmp_path / "missing-seed"
    monkeypatch.setenv("SAVANT_SERVER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SAVANT_ABILITIES_SEED_DIR", str(missing_seed))
    result = seed_abilities_if_missing()
    assert result["seeded"] is False
    assert result["reason"] == "seed-missing"


def test_resolve_seed_base_prefers_repo_seed_when_env_not_set(monkeypatch):
    monkeypatch.delenv("SAVANT_ABILITIES_SEED_DIR", raising=False)
    resolved = _resolve_seed_base()
    assert resolved.name == "abilities"
    assert resolved.parent.name == "savant"


def test_resolve_seed_base_falls_back_when_repo_seed_missing(monkeypatch):
    monkeypatch.delenv("SAVANT_ABILITIES_SEED_DIR", raising=False)

    original_exists = bootstrap_module.Path.exists

    def fake_exists(path_obj):
        as_posix = str(path_obj).replace("\\", "/")
        if as_posix.endswith("/savant/abilities"):
            return False
        return original_exists(path_obj)

    monkeypatch.setattr(bootstrap_module.Path, "exists", fake_exists)
    resolved = _resolve_seed_base()
    assert resolved.name == "abilities"
    assert resolved.parent.name == "seed"


def test_server_paths_support_explicit_locations(monkeypatch, tmp_path):
    data_dir = tmp_path / "server-data"
    db_path = tmp_path / "db-dir" / "custom.db"
    abilities_dir = tmp_path / "abilities-root"

    monkeypatch.setenv("SAVANT_SERVER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SAVANT_DB", str(db_path))
    monkeypatch.setenv("SAVANT_ABILITIES_DIR", str(abilities_dir))

    assert get_server_data_dir() == data_dir
    assert get_server_db_path() == db_path
    assert get_server_abilities_base_dir() == abilities_dir


def test_default_data_dir_switches_to_container_path(monkeypatch):
    monkeypatch.setenv("RUNNING_IN_DOCKER", "1")
    assert _default_data_dir().as_posix() == "/data/savant"
