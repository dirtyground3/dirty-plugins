"""Explicit contracts for an extraction plan and its progress accounting."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import time
from typing import TypedDict


@dataclass(frozen=True)
class ExtractionOptions:
    destination_root: Path
    policy: str
    create_item_folders: bool
    dry_run: bool
    max_copy_speed_mib: float

    @property
    def max_copy_speed_bytes(self) -> float:
        return self.max_copy_speed_mib * 1024 * 1024


class PlannedOperation(TypedDict):
    kind: str
    source_path: Path
    destination_path: Path
    action: str
    size: int


class MarkerOperation(PlannedOperation):
    marker_id: str
    seconds: float
    end_seconds: float


@dataclass
class ExtractionPlan:
    operations: list[PlannedOperation]
    skipped: list[dict[str, str]]
    missing: list[dict[str, str]]
    destinations: set[str]
    folders: list[Path]


class ExtractionProgress:
    """Byte progress for copies, item progress when clips have unknown sizes."""
    def __init__(self, operations, reporter, interval):
        self.total_bytes = sum(item["size"] for item in operations)
        self.count = len(operations)
        self.use_bytes = not any(item["kind"] == "marker" for item in operations)
        self.completed_bytes = 0
        self.last_reported = 0.0
        self.reporter = reporter
        self.interval = interval

    def copy_callback(self):
        copied = 0
        def on_chunk(size):
            nonlocal copied
            copied += size
            now = time.monotonic()
            if self.use_bytes and now - self.last_reported >= self.interval:
                self.reporter.progress((self.completed_bytes + copied) / (self.total_bytes or max(self.count, 1)))
                self.last_reported = now
        return on_chunk

    def marker_callback(self, index):
        def on_marker(value):
            self.reporter.progress(((index - 1) + min(max(float(value), 0.0), 1.0)) / max(self.count, 1))
        return on_marker

    def complete(self, index, size):
        self.completed_bytes += size
        if self.use_bytes and self.total_bytes:
            self.reporter.progress(self.completed_bytes / self.total_bytes)
        elif self.count:
            self.reporter.progress(index / self.count)
