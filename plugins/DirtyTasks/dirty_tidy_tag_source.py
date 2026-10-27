"""Bounded tag-only stash-box queries. Credentials remain in the Python backend."""

import json
import time
import urllib.error
import urllib.request

from dirty_tasks_metadata import CONSTANTS as ALL_CONSTANTS
CONSTANTS = ALL_CONSTANTS["organization"]


BATCH_SIZE = CONSTANTS["tagUpdate"]["batchSize"]
TAG_FIELDS = "id tags { id name }"


class TaggerError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def load_source(client, endpoint):
    data = client.call("""query DirtyTidyTagSource { configuration {
        general { stashBoxes { endpoint api_key max_requests_per_minute } }
        scraping { excludeTagPatterns }
    } }""").get("configuration") or {}
    boxes = (data.get("general") or {}).get("stashBoxes") or []
    selected = next((box for box in boxes if box.get("endpoint") == endpoint), None)
    if selected is None:
        raise TaggerError("The selected tagger source is no longer configured in Stash.")
    return TagSource(selected), (data.get("scraping") or {}).get("excludeTagPatterns") or []


class TagSource:
    def __init__(self, configuration):
        self.endpoint = configuration["endpoint"]
        self.headers = {"Content-Type": "application/json", "User-Agent": "DirtyTidy"}
        if configuration.get("api_key"):
            self.headers["ApiKey"] = str(configuration["api_key"])
        self.interval = 60 / max(1, int(configuration.get("max_requests_per_minute") or 240))
        self.next_request = 0.0
        self.requests = 0
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, query, variables):
        delay = self.next_request - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self.next_request = time.monotonic() + self.interval
        self.requests += 1
        request = urllib.request.Request(self.endpoint, json.dumps({"query": query, "variables": variables}).encode(),
                                         self.headers)
        try:
            with self.opener.open(request, timeout=120) as response:
                result = json.load(response)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            # urllib exceptions can contain credential-bearing URLs. Keep them private.
            raise TaggerError("Could not fetch tags from the selected source.") from None
        if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
            raise TaggerError("The tagger returned an invalid or unsuccessful response.")
        return result

    def by_ids(self, ids):
        results = {}
        for start in range(0, len(ids), BATCH_SIZE):
            batch = ids[start:start + BATCH_SIZE]
            definitions = ",".join(f"$id{i}:ID!" for i in range(len(batch)))
            fields = " ".join(f"scene{i}:findScene(id:$id{i}) {{ {TAG_FIELDS} }}" for i in range(len(batch)))
            try:
                result = self.call(f"query DirtyTidyRemoteTags({definitions}) {{ {fields} }}",
                                   {f"id{i}": scene_id for i, scene_id in enumerate(batch)})
                errors = result.get("errors") or []
                global_error = any(not error.get("path") for error in errors)
                failed = {error["path"][0] for error in errors if error.get("path")}
                for index, scene_id in enumerate(batch):
                    key = f"scene{index}"
                    if global_error or key in failed or key not in result["data"]:
                        results[scene_id] = TaggerError("The tagger could not fetch this scene's tags.")
                    else:
                        value = result["data"][key]
                        if value is not None and (not isinstance(value, dict) or str(value.get("id")) != scene_id):
                            results[scene_id] = TaggerError("The tagger returned an unexpected scene identity.")
                        else:
                            results[scene_id] = [] if value is None else [value]
            except TaggerError as exc:
                results.update((scene_id, exc) for scene_id in batch)
        return results

    def by_fingerprints(self, fingerprints):
        results = []
        for start in range(0, len(fingerprints), BATCH_SIZE):
            batch = fingerprints[start:start + BATCH_SIZE]
            try:
                value = self.call(
                    "query DirtyTidyFingerprintTags($fingerprints:[[FingerprintQueryInput!]!]!) { "
                    f"matches:findScenesBySceneFingerprints(fingerprints:$fingerprints) {{ {TAG_FIELDS} }} }}",
                    {"fingerprints": batch},
                )
                matches = value["data"].get("matches")
                if value.get("errors") or not isinstance(matches, list) or len(matches) != len(batch):
                    raise TaggerError("The tagger could not match this batch of scene fingerprints.")
                results.extend(matches)
            except TaggerError as exc:
                results.extend([exc] * len(batch))
        return results
