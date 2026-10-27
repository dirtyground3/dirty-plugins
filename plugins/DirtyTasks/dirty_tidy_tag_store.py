"""DirtyTidy's successful tag checks in the shared DirtyPlugins database."""

import time

import dirty_plugins_storage as storage
from dirty_tasks_metadata import CONSTANTS as ALL_CONSTANTS
CONSTANTS = ALL_CONSTANTS["organization"]


CACHE_SECONDS = CONSTANTS["tagUpdate"]["cacheSeconds"]


class TagCheckCache:
    def __init__(self, endpoint):
        self.endpoint = endpoint
        with storage.transaction() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS dirty_tidy_tag_checks (
                endpoint TEXT NOT NULL, scene_id TEXT NOT NULL,
                identity TEXT NOT NULL, checked_at REAL NOT NULL,
                PRIMARY KEY(endpoint, scene_id)
            )""")

    def fresh(self, identities, now=None):
        if not identities:
            return set()
        now = time.time() if now is None else now
        ids = list(identities)
        with storage.transaction(immediate=False) as connection:
            rows = connection.execute(
                "SELECT scene_id, identity FROM dirty_tidy_tag_checks WHERE endpoint=? "
                "AND checked_at>? AND checked_at<=? AND scene_id IN (" + ",".join("?" for _ in ids) + ")",
                [self.endpoint, now - CACHE_SECONDS, now, *ids],
            )
            return {row["scene_id"] for row in rows if identities[row["scene_id"]] == row["identity"]}

    def save(self, checks):
        if not checks:
            return
        with storage.transaction() as connection:
            connection.executemany(
                """INSERT INTO dirty_tidy_tag_checks(endpoint, scene_id, identity, checked_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(endpoint, scene_id) DO UPDATE SET identity=excluded.identity, checked_at=excluded.checked_at
                   WHERE excluded.checked_at >= dirty_tidy_tag_checks.checked_at""",
                [(self.endpoint, scene_id, identity, checked_at) for scene_id, identity, checked_at in checks],
            )
