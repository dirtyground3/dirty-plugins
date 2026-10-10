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
    def serve(self, run, stdin, **options):
        """Run protocol.serve with captured streams and a fixed 125 ms clock."""
        logs, output = io.StringIO(), io.StringIO()
        times = iter([10, 10.125])
        with patch("sys.stdin", io.StringIO(stdin)), patch("sys.stdout", output):
            code = protocol.serve("Plugin", run, reporter=protocol.StashReporter(logs),
                                  clock=lambda: next(times), **options)
        return code, logs.getvalue(), json.loads(output.getvalue())

    def test_serve_logs_timing_writes_one_envelope_and_applies_the_exit_policy(self):
        for args, result, code in [({}, {"copied": 1}, 0), ({"mode": "execute"}, {"failed": 1}, 1)]:
            with self.subTest(args=args):
                run = Mock(return_value=result)
                status, logs, envelope = self.serve(run, json.dumps({"args": args}), default_mode="preview",
                                                    exit_code=lambda output: int(bool(output.get("failed"))))
                mode = args.get("mode", "preview")
                self.assertEqual(status, code)
                self.assertEqual(logs, f"\x01i\x02Plugin backend started: mode={mode}\n"
                                 f"\x01i\x02Plugin backend finished: mode={mode} in 125ms\n")
                self.assertEqual(run.call_args.args[0], {"args": args})
                self.assertEqual(json.loads(envelope["output"]), result, "the result travels as a JSON string")

    def test_serve_reports_read_and_run_failures(self):
        for stdin, mode in [("", "unknown"), ("[]", "unknown"), ('{"args":{"mode":"preview"}}', "preview")]:
            with self.subTest(stdin=stdin):
                run = Mock(side_effect=ValueError("été"))
                status, logs, envelope = self.serve(run, stdin, public_error=lambda error: "safe: " + str(error))
                self.assertEqual(status, 1)
                self.assertIn(f"\x01e\x02Plugin failed: mode={mode} after 125ms: ", logs)
                self.assertTrue(envelope["error"].startswith("safe: "), "the browser sees only the public message")
                if mode == "unknown":
                    run.assert_not_called()

    def test_quiet_serve_logs_only_failures(self):
        status, logs, envelope = self.serve(lambda payload, reporter: {"ok": True}, "{}", quiet=True)
        self.assertEqual((status, logs, json.loads(envelope["output"])), (0, "", {"ok": True}))
        status, logs, _envelope = self.serve(Mock(side_effect=RuntimeError("broken")), "{}", quiet=True)
        self.assertEqual(status, 1)
        self.assertIn("Plugin failed: mode=unknown after 125ms: broken", logs)

    def test_envelopes_are_ascii_and_survive_legacy_code_pages(self):
        self.assertEqual(protocol.read_payload(io.StringIO('{"name":"été"}')), {"name": "été"})
        expected = {"scene_title": "日本語のシーン 🎬", "z": 1, "a": 2}
        buffer = io.BytesIO()
        stream = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict")
        protocol.emit_output(expected, stream)
        envelope = json.loads(buffer.getvalue().decode("ascii"))
        self.assertEqual(json.loads(envelope["output"]), expected)
        self.assertEqual(list(json.loads(envelope["output"])), ["scene_title", "z", "a"], "key order is preserved")
        error = io.StringIO()
        protocol.emit_error(ValueError("été"), error)
        self.assertEqual(json.loads(error.getvalue()), {"error": "été"})
        logs = io.StringIO()
        reporter = protocol.StashReporter(logs)
        reporter.error("one\ntwo")
        reporter.progress(2)
        self.assertEqual(logs.getvalue(), "\x01e\x02one\n\x01e\x02two\n\x01p\x021.0\n")
        with self.assertRaisesRegex(ValueError, "JSON object"):
            protocol.read_payload(io.StringIO("[]"))

    def test_standard_streams_are_reconfigured_including_stdin(self):
        calls = []

        class FakeStream:
            def reconfigure(self, **kwargs):
                calls.append(kwargs)

        with patch("sys.stdin", FakeStream()), patch("sys.stdout", FakeStream()), patch("sys.stderr", FakeStream()):
            protocol.configure_standard_streams()
        self.assertEqual(calls, [{"encoding": "utf-8", "errors": "backslashreplace"}] * 3)

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
