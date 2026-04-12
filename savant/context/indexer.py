"""Repository indexer — walk, chunk, embed, store pipeline.

Rewritten for SQLite + sqlite-vec (replaces PostgreSQL version).
Runs indexing in background threads with progress tracking.
"""

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .chunker import ContentChunker
from .db import ContextDB
from .language import MemoryBankDetector
from .walker import FileWalker

logger = logging.getLogger(__name__)


class _CancelledError(Exception):
    """Raised when indexing is cancelled by user."""
    pass

# Global indexing state for progress tracking
_indexing_lock = threading.Lock()
_indexing_status: Dict[str, Any] = {}  # {project: {status, progress, total, ...}}
_cancel_flags: Dict[str, bool] = {}   # {project: True} to request cancellation


def get_indexing_status() -> Dict[str, Any]:
    with _indexing_lock:
        return dict(_indexing_status)


def request_cancel(project: str):
    """Request cancellation of an in-progress indexing job."""
    with _indexing_lock:
        _cancel_flags[project] = True
        if project in _indexing_status:
            _indexing_status[project]["phase"] = "Cancelling"


def _is_cancelled(project: str) -> bool:
    with _indexing_lock:
        return _cancel_flags.get(project, False)


def _clear_cancel(project: str):
    with _indexing_lock:
        _cancel_flags.pop(project, None)


def _set_status(project: str, **kwargs):
    kwargs.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
    with _indexing_lock:
        if project not in _indexing_status:
            _indexing_status[project] = {}
        _indexing_status[project].update(kwargs)


def _clear_status(project: str):
    with _indexing_lock:
        _indexing_status.pop(project, None)


class Indexer:
    """Repository indexer with background threading and progress tracking."""

    def __init__(self):
        self.chunker = ContentChunker()
        self._embedder = None  # lazy loaded

    def _get_embedder(self):
        if self._embedder is None:
            from .embeddings import EmbeddingModel
            self._embedder = EmbeddingModel.get()
        return self._embedder

    def _detect_language(self, rel_path: str):
        """Detect language using MemoryBankDetector + Pygments fallback."""
        language, is_memory_bank = MemoryBankDetector.detect_language(rel_path)
        if is_memory_bank:
            return language, True

        try:
            from pygments.lexers import get_lexer_for_filename
            from pygments.util import ClassNotFound
            try:
                lexer = get_lexer_for_filename(rel_path)
                return lexer.name, False
            except ClassNotFound:
                pass
        except ImportError:
            pass

        return language, False

    def index_repository(self, repo_path: Path, repo_name: Optional[str] = None,
                         on_progress: Optional[Callable] = None) -> Dict[str, Any]:
        """Index a repository synchronously. Returns stats dict."""
        repo_path = Path(repo_path).resolve()
        if not repo_path.exists():
            raise FileNotFoundError(f"Path does not exist: {repo_path}")
        if not repo_path.is_dir():
            raise NotADirectoryError(f"Not a directory: {repo_path}")

        repo_name = repo_name or repo_path.name

        # Phase 1: Loading model
        _set_status(repo_name, status="indexing", phase="Loading model",
                    progress=0, total=0, files_done=0, chunks_done=0,
                    current_file="", error=None)
        ContextDB.update_repo_status(repo_name, "indexing")
        embedder = self._get_embedder()

        # Get or create repo
        repo = ContextDB.get_repo(repo_name)
        if not repo:
            repo = ContextDB.add_repo(repo_name, str(repo_path))

        repo_id = repo["id"]

        # Phase 2: Clearing old data
        _set_status(repo_name, phase="Clearing old data")
        ContextDB.clear_repo_data(repo_id)

        try:
            # Phase 3: Scanning directory
            if _is_cancelled(repo_name):
                raise _CancelledError(repo_name)
            _set_status(repo_name, phase="Scanning directory")
            walker = FileWalker(repo_path)
            files_to_index = list(walker.walk())
            total_files = len(files_to_index)

            _set_status(repo_name, phase="Reading files", total=total_files)
            logger.info(f"Indexing {repo_name}: {total_files} files")

            files_indexed = 0
            chunks_indexed = 0
            memory_bank_count = 0
            lang_counts = {}
            errors = 0

            for file_rel_path in files_to_index:
                # Check for cancellation at top of each file
                if _is_cancelled(repo_name):
                    raise _CancelledError(repo_name)

                try:
                    if MemoryBankDetector.should_skip_in_memory_dir(str(file_rel_path)):
                        continue

                    file_abs_path = repo_path / file_rel_path
                    stat = file_abs_path.stat()
                    mtime_ns = int(stat.st_mtime_ns)

                    if stat.st_size > 50_000_000:  # 50MB limit
                        continue

                    try:
                        with open(file_abs_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        if "\x00" in content:  # binary
                            continue
                    except Exception:
                        errors += 1
                        continue

                    language, is_memory_bank = self._detect_language(str(file_rel_path))
                    if is_memory_bank:
                        memory_bank_count += 1
                    else:
                        lang_counts[language] = lang_counts.get(language, 0) + 1

                    now = datetime.now(timezone.utc).isoformat()
                    file_id = ContextDB.insert_file(
                        repo_id, str(file_rel_path), language,
                        is_memory_bank, mtime_ns, now
                    )
                    files_indexed += 1

                    # Phase 4: Embedding chunks
                    chunks = self.chunker.chunk_with_metadata(content)
                    for chunk_index, chunk_text in chunks:
                        vec = embedder.embed_one(chunk_text)
                        ContextDB.insert_chunk(file_id, chunk_index, chunk_text, vec)
                        chunks_indexed += 1

                    pct = int(files_indexed / total_files * 100) if total_files else 100
                    phase = "Embedding" if pct < 100 else "Finalizing"
                    _set_status(repo_name, phase=phase, files_done=files_indexed,
                                chunks_done=chunks_indexed, progress=pct,
                                current_file=str(file_rel_path), errors=errors,
                                memory_bank=memory_bank_count, languages=dict(lang_counts))

                    if on_progress and files_indexed % 5 == 0:
                        on_progress(files_indexed, total_files, chunks_indexed)

                except _CancelledError:
                    raise
                except Exception as e:
                    logger.error(f"Error indexing {file_rel_path}: {e}")
                    errors += 1

            now = datetime.now(timezone.utc).isoformat()
            ContextDB.update_repo_status(repo_name, "indexed", indexed_at=now)
            _set_status(repo_name, status="indexed", phase="Complete", progress=100,
                        files_done=files_indexed, chunks_done=chunks_indexed,
                        current_file="", errors=errors,
                        memory_bank=memory_bank_count, languages=dict(lang_counts))

            result = {
                "repo_name": repo_name,
                "repo_path": str(repo_path),
                "files_indexed": files_indexed,
                "chunks_indexed": chunks_indexed,
                "memory_bank_files": memory_bank_count,
                "errors": errors,
                "timestamp": now,
            }
            logger.info(f"Indexing complete: {repo_name} — {files_indexed} files, {chunks_indexed} chunks")
            return result

        except _CancelledError:
            logger.info(f"Indexing cancelled: {repo_name} (at {files_indexed} files)")
            ContextDB.update_repo_status(repo_name, "cancelled")
            _set_status(repo_name, status="cancelled", phase="Cancelled",
                        current_file="", error=None)
            return {"repo_name": repo_name, "cancelled": True,
                    "files_indexed": files_indexed, "chunks_indexed": chunks_indexed}

        except Exception as e:
            ContextDB.update_repo_status(repo_name, "error")
            _set_status(repo_name, status="error", phase="Failed", error=str(e))
            logger.error(f"Failed to index {repo_name}: {e}")
            raise
        finally:
            _clear_cancel(repo_name)
            # Clear status after a delay so UI can read final state
            def _cleanup():
                import time
                time.sleep(30)
                _clear_status(repo_name)
            threading.Thread(target=_cleanup, daemon=True).start()

    def index_in_background(self, repo_path: Path, repo_name: Optional[str] = None):
        """Start indexing in a background thread."""
        def _run():
            try:
                self.index_repository(repo_path, repo_name)
            except Exception as e:
                logger.error(f"Background indexing failed: {e}")

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return t

    def delete_repository(self, repo_name: str) -> bool:
        return ContextDB.delete_repo(repo_name)
