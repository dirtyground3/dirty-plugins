"""Journal contracts and allowed Compactor workflow transitions."""
from __future__ import annotations
from typing import Any, Literal, TypedDict

RunStatus = Literal["queued", "running", "awaitingReview", "acceptQueued", "discarding",
                    "reconciling", "finalizing", "recovery", "completed", "cancelled", "failed"]
OperationStatus = Literal["ready", "manual", "blocked", "unchanged", "encoding", "validated",
                          "awaitingReview", "staging", "installing", "reconciling", "restoring",
                          "deleting", "discarded", "restored", "completed", "cancelled", "failed"]


class Operation(TypedDict):
    id: str
    sceneId: str
    fileId: str
    source: str
    status: OperationStatus
    rule: dict[str, Any]


class OperationJournal(Operation, total=False):
    destination: str
    identity: dict[str, Any]
    sourceHash: str
    output: str
    outputHash: str
    outputSize: int
    staged: str
    backup: str
    scanJob: str
    reason: str


class Run(TypedDict):
    id: str
    status: RunStatus
    created: float
    settings: dict[str, Any]
    rulesDigest: str
    automatic: bool
    reviewOutputs: bool
    operations: list[OperationJournal]


# Retry paths are explicit: recovery can queue another worker or another scan.
RUN_TRANSITIONS = {
    "queued": {"running", "failed", "queued", "reconciling"},
    "running": {"awaitingReview", "reconciling", "recovery", "completed", "cancelled", "queued"},
    "awaitingReview": {"awaitingReview", "acceptQueued", "discarding", "queued"},
    "acceptQueued": {"running", "awaitingReview", "queued", "reconciling"},
    "discarding": {"queued", "awaitingReview", "recovery"},
    "reconciling": {"finalizing", "reconciling", "queued"},
    "finalizing": {"queued", "recovery", "reconciling"},
    "recovery": {"queued", "reconciling"},
    "completed": set(), "cancelled": set(), "failed": set(),
}


def transition_run(run: Run, status: RunStatus, persist, *, expected=None) -> bool:
    """Check local state, then persist with the journal's existing CAS revision.

    A mismatch is a duplicate worker/decision and has no side effects. Persistence
    failures propagate; callers retain their existing queue/recovery policy.
    """
    previous = run["status"]
    if expected is not None and previous != expected:
        return False
    if status not in RUN_TRANSITIONS.get(previous, set()):
        raise RuntimeError(f"Invalid Compactor run transition: {previous} -> {status}")
    run["status"] = status
    persist("run", run)
    return True
