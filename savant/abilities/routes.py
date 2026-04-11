"""
Flask Blueprint for Abilities REST API.

All routes under /api/abilities/*.
The MCP server and (future) UI both call these endpoints.
"""

import logging
import os
from pathlib import Path
from typing import Optional

from flask import Blueprint, jsonify, request

from .store import AbilityStore
from .resolver import Resolver

logger = logging.getLogger(__name__)

abilities_bp = Blueprint("abilities", __name__)

# ── Singleton store + resolver ────────────────────────────────────────────────

_BASE_DIR = os.environ.get("SAVANT_ABILITIES_DIR", str(Path.home() / ".savant" / "abilities"))
_store: Optional[AbilityStore] = None
_resolver: Optional[Resolver] = None


def _get_store() -> AbilityStore:
    global _store
    if _store is None:
        _store = AbilityStore(Path(_BASE_DIR))
    # Reload on every request to pick up file changes
    _store.load()
    return _store


def _get_resolver() -> Resolver:
    global _resolver
    store = _get_store()
    if _resolver is None or _resolver.store is not store:
        _resolver = Resolver(store)
    return _resolver


# ── GET /api/abilities/assets — list all assets grouped by type ───────────────

@abilities_bp.route("/api/abilities/assets", methods=["GET"])
def list_assets():
    try:
        store = _get_store()
        return jsonify(store.list_assets_grouped())
    except Exception as e:
        logger.error(f"list_assets failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── GET /api/abilities/assets/<id> — get single asset ─────────────────────────

@abilities_bp.route("/api/abilities/assets/<path:asset_id>", methods=["GET"])
def get_asset(asset_id: str):
    try:
        store = _get_store()
        asset = store.get_asset_dict(asset_id)
        if not asset:
            return jsonify({"error": f"Asset '{asset_id}' not found"}), 404
        return jsonify(asset)
    except Exception as e:
        logger.error(f"get_asset failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── POST /api/abilities/assets — create new asset ────────────────────────────

@abilities_bp.route("/api/abilities/assets", methods=["POST"])
def create_asset():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        required = ["id", "type", "tags", "priority"]
        for field in required:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        store = _get_store()
        result = store.create_asset(
            asset_type=data["type"],
            asset_id=data["id"],
            tags=data["tags"],
            priority=int(data["priority"]),
            body=data.get("body", ""),
            includes=data.get("includes"),
            name=data.get("name"),
            aliases=data.get("aliases"),
        )
        return jsonify(result), 201
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        logger.error(f"create_asset failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── PUT /api/abilities/assets/<id> — update existing asset ───────────────────

@abilities_bp.route("/api/abilities/assets/<path:asset_id>", methods=["PUT"])
def update_asset(asset_id: str):
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        store = _get_store()
        result = store.update_asset(
            asset_id=asset_id,
            tags=data.get("tags"),
            priority=int(data["priority"]) if "priority" in data else None,
            body=data.get("body"),
            includes=data.get("includes"),
            name=data.get("name"),
            aliases=data.get("aliases"),
        )
        return jsonify(result)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"update_asset failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── DELETE /api/abilities/assets/<id> — delete asset ─────────────────────────

@abilities_bp.route("/api/abilities/assets/<path:asset_id>", methods=["DELETE"])
def delete_asset(asset_id: str):
    try:
        store = _get_store()
        store.delete_asset(asset_id)
        return jsonify({"ok": True, "deleted": asset_id})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"delete_asset failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── POST /api/abilities/learn — append to ## Learned section ─────────────────

@abilities_bp.route("/api/abilities/learn", methods=["POST"])
def learn():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        asset_id = data.get("asset_id")
        content = data.get("content")
        if not asset_id or not content:
            return jsonify({"error": "asset_id and content required"}), 400

        store = _get_store()
        result = store.append_learned(asset_id, content)
        return jsonify(result)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"learn failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── POST /api/abilities/resolve — resolve prompt from config ─────────────────

@abilities_bp.route("/api/abilities/resolve", methods=["POST"])
def resolve():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        persona = data.get("persona")
        if not persona:
            return jsonify({"error": "persona required"}), 400

        resolver = _get_resolver()
        result = resolver.resolve(
            persona=persona,
            tags=data.get("tags", []),
            repo_id=data.get("repo_id"),
            include_trace=bool(data.get("trace", False)),
        )
        return jsonify(result)
    except Exception as e:
        logger.error(f"resolve failed: {e}")
        return jsonify({"error": str(e)}), 500


# ── GET /api/abilities/validate — validate store integrity ───────────────────

@abilities_bp.route("/api/abilities/validate", methods=["GET"])
def validate():
    try:
        store = _get_store()
        store.validate_all()
        return jsonify({"ok": True, "stats": store.stats()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── GET /api/abilities/stats — asset counts by type ──────────────────────────

@abilities_bp.route("/api/abilities/stats", methods=["GET"])
def stats():
    try:
        store = _get_store()
        return jsonify(store.stats())
    except Exception as e:
        logger.error(f"stats failed: {e}")
        return jsonify({"error": str(e)}), 500
