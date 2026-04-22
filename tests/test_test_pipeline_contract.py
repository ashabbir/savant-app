from pathlib import Path


def test_run_all_tests_includes_integration_phase():
    root = Path(__file__).resolve().parents[1]
    script = (root / "run-all-tests.sh").read_text(encoding="utf-8")
    assert "==> Monorepo integration tests" in script
    assert 'python" -m pytest tests -v' in script
