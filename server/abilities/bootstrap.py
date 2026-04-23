from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from server_paths import get_server_abilities_base_dir

logger = logging.getLogger(__name__)


def _resolve_seed_base() -> Path:
    explicit = os.environ.get("SAVANT_ABILITIES_SEED_DIR", "").strip()
    if explicit:
        return Path(explicit).expanduser()

    # Preferred repo seed location requested for bootstrap source.
    repo_seed = Path(__file__).resolve().parents[2] / "savant" / "abilities"
    if repo_seed.exists():
        return repo_seed

    # Fallback server-local seed location.
    return Path(__file__).resolve().parents[1] / "seed" / "abilities"


def _seed_root(base: Path) -> Path:
    # Seed bundle may be provided either as <seed>/abilities/... or directly as <seed>/...
    return base / "abilities" if (base / "abilities").exists() else base


def _target_root() -> Path:
    return get_server_abilities_base_dir() / "abilities"


def _asset_dirs() -> tuple[str, ...]:
    # Canonical ability folders. Seeding decisions are based only on these assets.
    return ("personas", "rules", "policies", "repos", "styles")


def _iter_asset_files(target_root: Path):
    for dirname in _asset_dirs():
        base = target_root / dirname
        if not base.exists():
            continue
        yield from base.rglob("*.md")


def abilities_asset_count() -> int:
    target_root = _target_root()
    if not target_root.exists():
        return 0
    return sum(1 for _ in _iter_asset_files(target_root))


def abilities_bootstrap_status() -> dict:
    seed_base = _resolve_seed_base()
    seed_root = _seed_root(seed_base)
    count = abilities_asset_count()
    seed_exists = seed_root.exists()
    return {
        "asset_count": count,
        "bootstrap_available": count == 0 and seed_exists,
        "seed_path": str(seed_root),
        "seed_exists": seed_exists,
    }


def seed_abilities_if_missing() -> dict:
    target_root = _target_root()
    target_root.mkdir(parents=True, exist_ok=True)

    count = abilities_asset_count()
    if count:
        return {"seeded": False, "reason": "already-populated", "count": count}

    seed_base = _resolve_seed_base()
    seed_root = _seed_root(seed_base)
    if not seed_root.exists():
        logger.warning("Abilities seed source missing: %s", seed_root)
        return {"seeded": False, "reason": "seed-missing", "seed_path": str(seed_root)}

    copied = 0
    for src in seed_root.rglob("*.md"):
        rel = src.relative_to(seed_root)
        dst = target_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    logger.info("Seeded abilities from %s to %s (%d files)", seed_root, target_root, copied)
    return {
        "seeded": True,
        "seed_path": str(seed_root),
        "target_path": str(target_root),
        "count": copied,
    }
