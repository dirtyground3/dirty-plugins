"""Stash raw JSON and stderr protocols; domain dispatch stays in each plugin."""
from __future__ import annotations

import json
import sys
import time
from typing import Any


class Reporter:
    """No-op reporter for library calls and tests."""
    def info(self, _message: str) -> None:
        pass

    def error(self, _message: str) -> None:
        pass

    def progress(self, _value: float) -> None:
        pass


class StashReporter(Reporter):
    def __init__(self, stream=None):
        self.stream = stream

    def _write(self, level: str, message: Any) -> None:
        for line in str(message).splitlines() or [""]:
            print(f"\x01{level}\x02{line}", file=self.stream or sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("i", message)

    def error(self, message: str) -> None:
        self._write("e", message)

    def progress(self, value: float) -> None:
        self._write("p", str(min(max(float(value), 0.0), 1.0)))


def read_payload(stream=None) -> dict:
    raw = (stream if stream is not None else sys.stdin).read()
    if not raw.strip():
        raise ValueError("Stash did not provide plugin input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid plugin input: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Plugin input must be a JSON object")
    return payload


def _emit(envelope: dict, stream=None) -> None:
    target = stream if stream is not None else sys.stdout
    json.dump(envelope, target)
    target.write("\n")
    target.flush()


def emit_output(output: Any, stream=None) -> None:
    """Every backend answers with the same envelope: the result as an ASCII JSON string.

    Stash would pass a direct object through Go maps, which re-sort its keys; a string
    arrives unchanged. ASCII output cannot fail to encode on any console code page.
    """
    _emit({"output": json.dumps(output)}, stream)


def emit_error(error: Any, stream=None) -> None:
    _emit({"error": str(error)}, stream)


def configure_standard_streams() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="backslashreplace")
            except (OSError, ValueError):
                pass


def serve(name, run, *, default_mode=None, exit_code=None, public_error=str, quiet=False,
          reporter=None, clock=time.monotonic) -> int:
    """Serve one Stash request: read stdin, call run(payload, reporter), write one envelope.

    Failures are always logged for Stash's log; public_error chooses what the browser may
    see. quiet omits the per-request start/finish lines for operations a page polls.
    """
    configure_standard_streams()
    reporter = reporter or StashReporter()
    started = clock()
    mode = "unknown"

    def elapsed() -> int:
        return int((clock() - started) * 1000)

    try:
        payload = read_payload()
        args = payload.get("args")
        if isinstance(args, dict):
            mode = str(args.get("mode") or default_mode or "unknown")
        if not quiet:
            reporter.info(f"{name} backend started: mode={mode}")
        output = run(payload, reporter)
        if not quiet:
            reporter.info(f"{name} backend finished: mode={mode} in {elapsed()}ms")
        emit_output(output)
        return exit_code(output) if exit_code else 0
    except Exception as exc:
        reporter.error(f"{name} failed: mode={mode} after {elapsed()}ms: {exc}")
        emit_error(public_error(exc))
        return 1
