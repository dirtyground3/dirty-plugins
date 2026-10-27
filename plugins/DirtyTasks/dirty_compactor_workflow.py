"""Small journal for encoding, exclusive publication, and scene attachment."""
from typing import Any, TypedDict

class OperationJournal(TypedDict, total=False):
    id: str
    sceneId: str
    fileId: str
    source: str
    destination: str
    status: str
    rule: dict[str, Any]

class Run(TypedDict):
    id: str
    status: str
    created: float
    settings: dict[str, Any]
    rulesDigest: str
    automatic: bool
    operations: list[OperationJournal]

RUN_TRANSITIONS = {
    "queued": {"running", "failed", "queued", "reconciling"},
    "running": {"reconciling", "recovery", "completed", "cancelled", "queued"},
    "reconciling": {"finalizing", "recovery", "reconciling", "queued"},
    "finalizing": {"queued", "recovery", "reconciling"},
    "recovery": {"queued", "reconciling", "cancelled"},
    "completed": set(), "cancelled": set(), "failed": set(),
}

def transition_run(run, status, persist, *, expected=None):
    previous = run["status"]
    if expected is not None and previous != expected:
        return False
    if status not in RUN_TRANSITIONS.get(previous, set()):
        raise RuntimeError(f"Invalid encoding run transition: {previous} -> {status}")
    run["status"] = status
    persist("run", run)
    return True
