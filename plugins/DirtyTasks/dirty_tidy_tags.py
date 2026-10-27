"""Fetch only scene tags in bounded batches and merge them through native ADD."""
from __future__ import annotations

import hashlib
import json
import re
import time

from dirty_tidy_tag_source import TaggerError, load_source
from dirty_tidy_tag_store import TagCheckCache

PAGE_SIZE = 100


def scene_pages(client):
    page, seen = 1, 0
    while True:
        data = client.call(
            "query DirtyTidyTagScenes($filter:FindFilterType!) { findScenes(filter:$filter) { count "
            "scenes { id stash_ids { endpoint stash_id } tags { id } files { fingerprints { type value } } } } }",
            {"filter": {"page": page, "per_page": PAGE_SIZE, "sort": "id", "direction": "ASC"}},
        ).get("findScenes") or {}
        scenes = data.get("scenes") or []
        if not scenes:
            return
        yield scenes, int(data.get("count") or 0)
        seen += len(scenes)
        if seen >= int(data.get("count") or 0):
            return
        page += 1


def scene_inputs(scene, endpoint):
    links = sorted({str(link["stash_id"]) for link in scene.get("stash_ids") or []
                    if link.get("endpoint") == endpoint and link.get("stash_id")})
    fingerprints = sorted({(str(fp.get("type") or "").upper(), str(fp.get("value") or ""))
                           for file in scene.get("files") or [] for fp in file.get("fingerprints") or []
                           if str(fp.get("type") or "").upper() in {"MD5", "OSHASH", "PHASH"} and fp.get("value")})
    return links, [{"algorithm": algorithm, "hash": value} for algorithm, value in fingerprints]


def check_identity(inputs, patterns):
    links, fingerprints = inputs
    # Moving files and unrelated metadata edits do not invalidate a check.
    value = [links, [] if links else fingerprints, patterns]
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class LocalTags:
    """Match source IDs first, then names and aliases, without per-tag reads."""
    def __init__(self, client, endpoint):
        self.client, self.endpoint = client, endpoint
        self.reload()

    def reload(self):
        self.ids, self.names, self.aliases = {}, {}, {}
        page, seen = 1, 0
        while True:
            data = self.client.call(
                "query DirtyTidyLocalTags($filter:FindFilterType!) { findTags(filter:$filter) { count "
                "tags { id name aliases stash_ids { endpoint stash_id } } } }",
                {"filter": {"page": page, "per_page": PAGE_SIZE, "sort": "id", "direction": "ASC"}},
            ).get("findTags") or {}
            rows = data.get("tags") or []
            for tag in rows:
                self.add(tag)
            seen += len(rows)
            if not rows or seen >= int(data.get("count") or 0):
                break
            page += 1

    def add(self, tag):
        tag_id = str(tag["id"])
        self.names.setdefault(tag["name"].strip().casefold(), set()).add(tag_id)
        for alias in tag.get("aliases") or []:
            self.aliases.setdefault(alias.strip().casefold(), set()).add(tag_id)
        for link in tag.get("stash_ids") or []:
            if link.get("endpoint") == self.endpoint and link.get("stash_id"):
                self.ids.setdefault(str(link["stash_id"]), set()).add(tag_id)

    def matched(self, tag):
        name = tag["name"].strip().casefold()
        values = self.ids.get(str(tag["id"])) or self.names.get(name) or self.aliases.get(name) or set()
        if len(values) > 1:
            raise TaggerError("A source tag matches multiple local tags; resolve the duplicate mapping first.")
        return next(iter(values), "")

    def resolve(self, tag):
        existing = self.matched(tag)
        if existing:
            return existing
        values = {"name": tag["name"].strip(), "stash_ids": [{"endpoint": self.endpoint, "stash_id": str(tag["id"])}]}
        try:
            result = self.client.call(
                "mutation DirtyTidyCreateTag($input:TagCreateInput!) { tagCreate(input:$input) { id } }",
                {"input": values},
            ).get("tagCreate") or {}
            if not result.get("id"):
                raise TaggerError("Stash did not return the created tag ID.")
        except Exception:
            # Another task may have created the same name since the snapshot.
            self.reload()
            existing = self.matched(tag)
            if existing:
                return existing
            raise
        self.add({**values, "id": str(result["id"])})
        return str(result["id"])


def fetch_page(source, scenes, inputs):
    remote_ids = sorted({remote_id for scene in scenes for remote_id in inputs[str(scene["id"])][0]})
    linked = source.by_ids(remote_ids)
    unlinked = [scene for scene in scenes if not inputs[str(scene["id"])][0] and inputs[str(scene["id"])][1]]
    matched = source.by_fingerprints([inputs[str(scene["id"])][1] for scene in unlinked])
    fingerprints = {str(scene["id"]): value for scene, value in zip(unlinked, matched)}
    results = {}
    for scene in scenes:
        scene_id = str(scene["id"])
        links = inputs[scene_id][0]
        candidates = [linked[remote_id] for remote_id in links] if links else [fingerprints.get(scene_id, [])]
        error = next((value for value in candidates if isinstance(value, Exception)), None)
        if error:
            results[scene_id] = error
        elif any(not isinstance(value, list) for value in candidates):
            results[scene_id] = TaggerError("The tagger returned an invalid scene match.")
        elif any(len(value) != 1 for value in candidates):
            results[scene_id] = None  # Missing or ambiguous matches make no scene writes.
        else:
            tags = []
            for matches in candidates:
                value = matches[0]
                if not isinstance(value, dict) or not isinstance(value.get("tags"), list):
                    error = TaggerError("The tagger returned an incomplete tag list.")
                    break
                tags.extend(value["tags"])
            if any(not isinstance(tag, dict) or not tag.get("id") or not isinstance(tag.get("name"), str)
                   or not tag["name"].strip() for tag in tags):
                error = TaggerError("The tagger returned an invalid tag.")
            results[scene_id] = error or tags
    return results


def exclusion_patterns(patterns, reporter):
    compiled = []
    for pattern in patterns:
        try:
            # Stash lowercases both patterns and names before matching.
            compiled.append(re.compile(pattern.lower()))
        except re.error:
            reporter.error("DirtyTidy ignored an invalid tag-exclusion pattern.")
    return compiled


def update_scene_tags(client, endpoint, reporter, *, force=False):
    source, patterns = load_source(client, endpoint)
    exclusions = exclusion_patterns(patterns, reporter)
    checks = TagCheckCache(endpoint)
    local_tags = None
    result = {"completed": 0, "failed": 0, "skipped": 0, "unchanged": 0, "cached": 0, "tags_added": 0}
    processed = 0
    for scenes, total in scene_pages(client):
        inputs = {str(scene["id"]): scene_inputs(scene, endpoint) for scene in scenes}
        identities = {scene_id: check_identity(value, patterns) for scene_id, value in inputs.items()}
        fresh = set() if force else checks.fresh(identities)
        pending = [scene for scene in scenes if str(scene["id"]) not in fresh]
        fetched = fetch_page(source, pending, inputs)
        successful = []
        for scene in scenes:
            scene_id = str(scene["id"])
            if scene_id in fresh:
                result["cached"] += 1
            else:
                try:
                    tags = fetched[scene_id]
                    if isinstance(tags, Exception):
                        raise tags
                    if tags is None:
                        result["skipped"] += 1
                    else:
                        tags = [tag for tag in tags if not any(pattern.search(tag["name"].lower()) for pattern in exclusions)]
                        if tags and local_tags is None:
                            local_tags = LocalTags(client, endpoint)
                        existing = {str(tag["id"]) for tag in scene.get("tags") or []}
                        additions = sorted({local_tags.resolve(tag) for tag in tags} - existing)
                        if additions:
                            updated = client.call(
                                "mutation DirtyTidyMergeTags($input:BulkSceneUpdateInput!) { bulkSceneUpdate(input:$input) { id } }",
                                {"input": {"ids": [scene_id], "tag_ids": {"ids": additions, "mode": "ADD"}}},
                            ).get("bulkSceneUpdate") or []
                            if not any(str(item.get("id")) == scene_id for item in updated):
                                raise TaggerError("Stash did not confirm the scene tag update.")
                            result["completed"] += 1
                            result["tags_added"] += len(additions)
                        else:
                            result["unchanged"] += 1
                    successful.append((scene_id, identities[scene_id], time.time()))
                except Exception as exc:
                    result["failed"] += 1
                    reporter.error(f"DirtyTidy could not update tags for scene {scene_id}: {exc}")
            processed += 1
            reporter.progress(processed / max(total, processed))
        # Cache writes share one transaction per fetched page, outside network I/O.
        checks.save(successful)
    result["requests"] = source.requests
    reporter.progress(1)
    reporter.info("DirtyTidy tag merge finished: " + ", ".join(f"{key}={value}" for key, value in result.items()))
    return result
