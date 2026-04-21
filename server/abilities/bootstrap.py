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


def seed_abilities_if_missing() -> dict:
    target_base = get_server_abilities_base_dir()
    # AbilityStore always loads from <base>/abilities/...
    target_root = target_base / "abilities"
    target_root.mkdir(parents=True, exist_ok=True)

    existing = list(target_root.rglob("*.md"))
    if existing:
        return {"seeded": False, "reason": "already-populated", "count": len(existing)}

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
