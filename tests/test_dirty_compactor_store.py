from concurrent.futures import ThreadPoolExecutor
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_dirty_compactor import compactor
from test_dirty_rank import dirty_rank

records = compactor.records
storage = compactor.storage


class CompactorStoreTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.database = Path(self.folder.name) / "shared.sqlite3"

    def test_first_read_initializes_an_empty_store_and_established_reads_do_no_ddl(self):
        self.assertIsNone(records.get("run", "missing", path=self.database))
        records.put("run", "1", {"status": "queued"}, path=self.database)
        queries = []
        original = storage.connect
        def traced(path=None):
            connection = original(path)
            connection.set_trace_callback(queries.append)
            return connection
        with mock.patch.object(storage, "connect", side_effect=traced):
            self.assertEqual(records.get("run", "1", path=self.database), {"status": "queued", "_revision": 0})
            self.assertEqual(len(records.list_records("run", path=self.database)), 1)
        self.assertTrue(all(query.startswith("SELECT") for query in queries), queries)

    def test_polling_reads_while_another_connection_holds_the_writer_lock(self):
        records.put("run", "1", {"status": "queued"}, path=self.database)
        with storage.transaction(self.database) as writer:
            storage.set_plugin_settings_on_connection("example", {"value": 1}, writer)
            storage._put_metadata(writer, "dirtyCaptions.index", "state", '{"token":"active"}')
            self.assertEqual(records.get("run", "1", path=self.database)["status"], "queued")
            self.assertEqual(len(records.list_records("run", path=self.database)), 1)
        self.assertEqual(storage.get_plugin_settings("example", self.database), {"value": 1})

    def test_polling_overlaps_rank_votes_settings_saves_and_caption_heartbeats(self):
        records.put("run", "1", {"status": "queued"}, path=self.database)
        rank = dirty_rank.RatingRepository(self.database)
        settings = dirty_rank.normalize_settings({})
        def votes():
            for n in range(10):
                dirty_rank.record_battle(rank, {"leftId": "1", "rightId": "2", "battleId": "vote-" + str(n),
                    "categoryId": "appearance", "cohort": "FEMALE", "outcome": "left"}, settings)
        def saves():
            for n in range(10):
                storage.set_plugin_settings("example", {"value": n}, self.database)
        def heartbeats():
            for n in range(10):
                storage.update_json_metadata("dirtyCaptions.index", "state", lambda state: dict(state, checked=n), self.database)
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(work) for work in (votes, saves, heartbeats)]
            for n in range(40):
                self.assertEqual(records.get("run", "1", path=self.database)["_revision"], 0)
                self.assertEqual(len(records.list_records("run", path=self.database)), 1)
            for future in futures:
                future.result()
        self.assertEqual(rank.all_states()["revision"], 10)
        self.assertEqual(storage.get_plugin_settings("example", self.database), {"value": 9})
        self.assertEqual(storage.get_metadata("dirtyCaptions.index", "state", self.database), '{"checked": 9}')

    def test_concurrent_claims_and_revision_writes_remain_exclusive(self):
        records.get("run", "missing", path=self.database)
        def claim(n):
            try:
                return records.claim_run({"id": str(n), "status": "queued"}, path=self.database)
            except RuntimeError:
                return None
        with ThreadPoolExecutor(max_workers=4) as pool:
            claims = list(pool.map(claim, range(8)))
        self.assertEqual(sum(result is not None for result in claims), 1)
        records.put("decision", "1", {"accepted": False}, path=self.database)
        def decide(n):
            try:
                return records.put("decision", "1", {"accepted": bool(n)}, expected=0, path=self.database)
            except RuntimeError:
                return None
        with ThreadPoolExecutor(max_workers=4) as pool:
            decisions = list(pool.map(decide, range(8)))
        self.assertEqual(sum(result is not None for result in decisions), 1)
        self.assertEqual(records.get("decision", "1", path=self.database)["_revision"], 1)


if __name__ == "__main__":
    unittest.main()
