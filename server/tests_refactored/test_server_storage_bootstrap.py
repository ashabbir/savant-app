from pathlib import Path

from abilities.bootstrap import seed_abilities_if_missing
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
