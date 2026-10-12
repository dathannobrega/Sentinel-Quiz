"""Disk cache for synthesized audio (contract §5.1).

Layout: ``<cache_dir>/tts/<audio_id>.<mp3|wav>`` plus ``<audio_id>.json`` with the word
timestamps and metadata. Eviction is LRU by total size (``SPEECH_CACHE_MAX_MB``): the
file mtime is bumped on every read so recently played paragraphs survive. Only
synthesized audio ever lands here; uploaded recordings are never written to disk.
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONTENT_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav"}


@dataclass(slots=True)
class CachedAudio:
    audio_id: str
    audio_path: Path
    content_type: str
    meta: dict[str, Any]


class AudioCache:
    def __init__(self, root: Path, max_bytes: int) -> None:
        self.root = Path(root) / "tts"
        self.max_bytes = max(0, int(max_bytes))
        self._lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)

    def _meta_path(self, audio_id: str) -> Path:
        return self.root / f"{audio_id}.json"

    def get(self, audio_id: str) -> CachedAudio | None:
        meta_path = self._meta_path(audio_id)
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        ext = str(meta.get("ext") or "mp3")
        audio_path = self.root / f"{audio_id}.{ext}"
        if not audio_path.is_file():
            return None
        now = time.time()
        for path in (audio_path, meta_path):
            try:
                os.utime(path, (now, now))
            except OSError:
                pass
        return CachedAudio(audio_id, audio_path, CONTENT_TYPES.get(ext, "application/octet-stream"), meta)

    def put(self, audio_id: str, audio: bytes, ext: str, meta: dict[str, Any]) -> CachedAudio:
        meta = {**meta, "ext": ext}
        audio_path = self.root / f"{audio_id}.{ext}"
        meta_path = self._meta_path(audio_id)
        with self._lock:
            self._write_atomic(audio_path, audio)
            self._write_atomic(meta_path, json.dumps(meta, ensure_ascii=False).encode("utf-8"))
            self._evict_locked()
        return CachedAudio(audio_id, audio_path, CONTENT_TYPES.get(ext, "application/octet-stream"), meta)

    def total_bytes(self) -> int:
        return sum(p.stat().st_size for p in self.root.iterdir() if p.is_file())

    @staticmethod
    def _write_atomic(path: Path, data: bytes) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)

    def _evict_locked(self) -> None:
        """Drop least-recently-used entries (audio + json together) until under budget."""
        if self.max_bytes <= 0:
            return
        entries: dict[str, list[Path]] = {}
        for path in self.root.iterdir():
            if not path.is_file() or path.suffix == ".tmp":
                continue
            entries.setdefault(path.stem, []).append(path)
        sized = []
        for stem, paths in entries.items():
            try:
                size = sum(p.stat().st_size for p in paths)
                mtime = max(p.stat().st_mtime for p in paths)
            except OSError:
                continue
            sized.append((mtime, stem, size, paths))
        total = sum(item[2] for item in sized)
        for _mtime, _stem, size, paths in sorted(sized):
            if total <= self.max_bytes:
                break
            for p in paths:
                try:
                    p.unlink()
                except OSError:
                    pass
            total -= size
