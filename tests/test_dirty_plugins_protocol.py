import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plugins" / "DirtyPlugins"))
import dirty_plugins_protocol as protocol
from dirty_plugins_client import StashClient


class SharedProtocolTests(unittest.TestCase):
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
