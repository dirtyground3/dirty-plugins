"""Stash raw JSON and stderr protocols; domain dispatch stays in each plugin."""
from __future__ import annotations

import json
import sys
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


def read_payload(stream=None, *, error_type=RuntimeError,
                 invalid_json="Invalid plugin input: {}",
                 invalid_object="Plugin input must be a JSON object") -> dict:
    raw = (stream if stream is not None else sys.stdin).read()
    if not raw.strip():
        raise error_type("Stash did not provide plugin input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise error_type(invalid_json.format(exc)) from exc
    if not isinstance(payload, dict):
        raise error_type(invalid_object)
    return payload


def emit_output(output: Any, stream=None, *, nested=False, ensure_ascii=True, newline=False) -> None:
    target = stream if stream is not None else sys.stdout
    value = json.dumps(output, ensure_ascii=ensure_ascii) if nested else output
    json.dump({"output": value}, target, ensure_ascii=ensure_ascii)
    if newline:
        target.write("\n")
        target.flush()


def emit_error(error: Any, stream=None, *, ensure_ascii=True, newline=False) -> None:
    target = stream if stream is not None else sys.stdout
    json.dump({"error": str(error)}, target, ensure_ascii=ensure_ascii)
    if newline:
        target.write("\n")
        target.flush()


def configure_standard_streams(*, errors=None) -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                options = {"encoding": "utf-8"}
                if errors is not None:
                    options["errors"] = errors
                reconfigure(**options)
            except (OSError, ValueError):
                pass


def run_logged_backend(name, run, read, emit, fail, reporter, clock, *, requested_mode=None, exit_code=None):
    """Keep timing and protocol handling shared; callers retain dispatch and envelopes."""
    started = clock()
    context = ": mode=unknown" if requested_mode else ""
    try:
        payload = read()
        if requested_mode:
            context = f": mode={requested_mode(payload)}"
        reporter.info(f"{name} backend started{context}")
        output = run(payload, reporter)
        reporter.info(f"{name} backend finished{context} in {int((clock() - started) * 1000)}ms")
        emit(output)
        return exit_code(output) if exit_code else 0
    except Exception as exc:
        reporter.error(f"{name} failed{context} after {int((clock() - started) * 1000)}ms: {exc}")
        fail(exc)
        return 1
