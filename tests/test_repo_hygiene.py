from pathlib import Path


def test_gitignore_covers_server_database_artifacts():
    root = Path(__file__).resolve().parents[1]
    data = (root / ".gitignore").read_text(encoding="utf-8")
    assert "server/data/" in data
    assert "*.db" in data
    assert "*.db-shm" in data
    assert "*.db-wal" in data
