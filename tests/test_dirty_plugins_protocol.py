from plugin_paths import runtime_path
import io
import json
import sys
import unittest
from unittest.mock import Mock, patch
import urllib.error

sys.path.insert(0, str(runtime_path("DirtyPlugins")))
import dirty_plugins_protocol as protocol
from dirty_plugins_client import StashClient


class SharedProtocolTests(unittest.TestCase):
    def test_logged_backend_preserves_messages_output_and_exit_policy(self):
        for mode, result, code in [(None, {"copied": 1}, 0), ("execute", {"failed": 1}, 1)]:
            with self.subTest(mode=mode):
                logs = io.StringIO()
                reporter = protocol.StashReporter(logs)
                run, emit, fail = Mock(return_value=result), Mock(), Mock()
                times = iter([10, 10.125])
                self.assertEqual(protocol.run_logged_backend(
                    "Plugin", run, lambda: {"args": {}}, emit, fail, reporter, lambda: next(times),
                    requested_mode=(lambda _: mode) if mode else None,
                    exit_code=lambda output: int(bool(output.get("failed"))),
                ), code)
                context = f": mode={mode}" if mode else ""
                self.assertEqual(logs.getvalue(), f"\x01i\x02Plugin backend started{context}\n"
                                 f"\x01i\x02Plugin backend finished{context} in 125ms\n")
                run.assert_called_once_with({"args": {}}, reporter)
                emit.assert_called_once_with(result)
                fail.assert_not_called()

    def test_logged_backend_reports_read_and_dispatch_failures(self):
        for mode, read_failure in [(None, True), ("preview", True), ("preview", False)]:
            with self.subTest(mode=mode, read_failure=read_failure):
                logs, output = io.StringIO(), io.StringIO()
                times = iter([10, 10.125])
                error = ValueError("été")
                read = Mock(side_effect=error) if read_failure else Mock(return_value={})
                run, emit = Mock(side_effect=error), Mock()
                self.assertEqual(protocol.run_logged_backend(
                    "Plugin", run, read, emit, lambda exc: protocol.emit_error(exc, output),
                    protocol.StashReporter(logs), lambda: next(times),
                    requested_mode=(lambda _: mode) if mode else None,
                ), 1)
                context = (": mode=unknown" if read_failure else f": mode={mode}") if mode else ""
                self.assertIn(f"\x01e\x02Plugin failed{context} after 125ms: été\n", logs.getvalue())
                self.assertEqual(json.loads(output.getvalue()), {"error": "été"})
                emit.assert_not_called()
                if read_failure:
                    run.assert_not_called()

    def test_unicode_envelopes_and_error_stream_separation(self):
        self.assertEqual(protocol.read_payload(io.StringIO('{"name":"été"}')), {"name": "été"})
        for nested in (False, True):
            output = io.StringIO()
            protocol.emit_output({"name": "été"}, output, nested=nested, newline=True)
            envelope = json.loads(output.getvalue())
            value = json.loads(envelope["output"]) if nested else envelope["output"]
            self.assertEqual(value, {"name": "été"})
        logs = io.StringIO()
        reporter = protocol.StashReporter(logs)
        reporter.error("one\ntwo")
        reporter.progress(2)
        self.assertEqual(logs.getvalue(), "\x01e\x02one\n\x01e\x02two\n\x01p\x021.0\n")
        with self.assertRaisesRegex(ValueError, "JSON object"):
            protocol.read_payload(io.StringIO("[]"), error_type=ValueError)

    def test_transport_connection_headers_unicode_and_timeout(self):
        client = StashClient({"Host": "::1", "Port": 9999, "ApiKey": 123,
                              "SessionCookie": {"Name": "session", "Value": "value"}}, timeout=60)
        self.assertEqual(client.url, "http://[::1]:9999/graphql")
        self.assertEqual(client.headers["ApiKey"], "123")
        self.assertEqual(client.headers["Cookie"], "session=value")
        with patch("urllib.request.urlopen") as opened:
            opened.return_value.__enter__.return_value = io.BytesIO(b'{"data":{"ok":true}}')
            self.assertEqual(client.call("query", {"name": "été"}), {"ok": True})
            request = opened.call_args.args[0]
            self.assertEqual(json.loads(request.data.decode("utf-8"))["variables"], {"name": "été"})
            self.assertEqual(opened.call_args.kwargs["timeout"], 60)
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            with self.assertRaisesRegex(RuntimeError, "Could not contact Stash GraphQL"):
                client.call("query")
        with patch("urllib.request.urlopen") as opened:
            opened.return_value.__enter__.return_value = io.BytesIO(b'{"errors":[{"message":"denied"}]}')
            with self.assertRaisesRegex(RuntimeError, "denied"):
                client.call("query")
