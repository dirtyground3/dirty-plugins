"""Manual unchanged-scan benchmark; synthetic database identities, no media I/O.

Run after npm run build: python -B tests/benchmark_captions_index.py
Use workspace-local TEMP/TMP if the sandbox restricts system temporary files.
"""
import json
import time
from unittest import mock

from test_dirty_captions_index import CaptionIndexTests, index, storage


def main():
    fixture = CaptionIndexTests()
    fixture.setUp()
    try:
        client = fixture.unchanged_client(1000)
        index.request_refresh(client)
        with mock.patch.object(storage, "connect", wraps=storage.connect) as connections, \
             mock.patch.object(client, "call", wraps=client.call) as graphql, \
             mock.patch.object(index, "fingerprint", side_effect=AssertionError("Media access")), \
             mock.patch.object(index, "tool_path", side_effect=AssertionError("Probe configuration")):
            started = time.perf_counter()
            result = index.worker(client, client.queued[-1]["token"])
            seconds = time.perf_counter() - started
        print(json.dumps({"scenes": 1000, "connections": connections.call_count, "graphql": graphql.call_count,
            "seconds": round(seconds, 4), "checked": result["checked"], "probed": result["probed"], "skipped": result["skipped"]}))
    finally:
        fixture.doCleanups()


if __name__ == "__main__":
    main()
