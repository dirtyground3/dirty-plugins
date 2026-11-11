"""Time schedules: open Stash tabs ask what is due; missed slots wait for the user's answer.

Each scheduled action keeps the last slot it handled. A slot is handled once across tabs:
it runs automatically when a tab notices it within GRACE_SECONDS, otherwise it is listed as
missed until someone runs or skips it. Changing a schedule starts it afresh from now.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import time
import uuid

import dirty_plugins_storage as storage
import dirty_tasks_settings as settings

NAMESPACE = "dirtyTasks.schedule"
GRACE_SECONDS = 600
LABELS = {"move": "Move into folders", "rename": "Rename files", "tags": "Update scene tags",
          "backup": "Back up library data"}


def _slots(schedule, now, step):
    """Slot times from now's day in one direction (step -1 or 1), local server time."""
    hours, minutes = (int(part) for part in schedule["time"].split(":"))
    today = datetime.fromtimestamp(now).replace(hour=hours, minute=minutes, second=0, microsecond=0)
    for offset in range(8):
        slot = today + timedelta(days=offset * step)
        if slot.weekday() in schedule["days"]:
            yield slot.timestamp()


def latest_slot(schedule, now):
    return next((slot for slot in _slots(schedule, now, -1) if slot <= now), None)


def next_slot(schedule, now):
    return next((slot for slot in _slots(schedule, now, 1) if slot > now), None)


def scheduled():
    """{key: (label, schedule)} for every enabled action set to run on a schedule."""
    execution = settings.get_section("execution")
    organization = settings.get_section("organization")
    enabled = {"move": organization.get("moveEnabled", True), "rename": organization.get("renameEnabled", False),
               "tags": organization.get("tagUpdateEnabled") and organization.get("taggerEndpoint"), "backup": True}
    result = {key: (LABELS[key], execution["schedules"][key]) for key in settings.ACTIONS
              if execution[key] == "schedule" and enabled[key] and key in execution["schedules"]}
    for rule in settings.get_section("encoding").get("rules", []):
        key = "encoding:" + str(rule["id"])
        if rule.get("enabled") and execution["encoding"].get(str(rule["id"])) == "schedule" and key in execution["schedules"]:
            result[key] = (rule.get("name") or "Encoding rule", execution["schedules"][key])
    return result


def _fingerprint(schedule):
    return json.dumps(schedule, sort_keys=True, separators=(",", ":"))


def _state(key, schedule, now):
    """The saved slot, starting a new or changed schedule at now so nothing before it is due."""
    fingerprint = _fingerprint(schedule)
    return storage.update_json_metadata(
        NAMESPACE, key, lambda current: current if current.get("schedule") == fingerprint
        else {"schedule": fingerprint, "slot": now})


def _claim(key, schedule, slot):
    """Mark slot handled; only one tab gets True for each slot."""
    token = uuid.uuid4().hex
    fingerprint = _fingerprint(schedule)

    def update(current):
        if current.get("schedule") == fingerprint and current.get("slot", 0) < slot:
            return {"schedule": fingerprint, "slot": slot, "claim": token, "previous": current.get("slot", 0)}
        return current
    return storage.update_json_metadata(NAMESPACE, key, update).get("claim") == token


def _release(key, slot):
    """Make a slot due again after its task could not be queued."""
    storage.update_json_metadata(NAMESPACE, key, lambda current: dict(current, slot=current.get("previous", 0))
                                 if current.get("slot") == slot else current)


def due(now=None):
    """Due actions split into on-time (run now) and missed, plus the next slot time."""
    now = time.time() if now is None else now
    on_time, missed, upcoming = [], [], []
    for key, (label, schedule) in scheduled().items():
        state = _state(key, schedule, now)
        latest = latest_slot(schedule, now)
        if latest is not None and latest > state["slot"]:
            item = {"key": key, "label": label, "slot": latest}
            (on_time if now - latest <= GRACE_SECONDS else missed).append(item)
        upcoming.append(next_slot(schedule, now))
    upcoming = [slot for slot in upcoming if slot is not None]
    return on_time, missed, (min(upcoming) if upcoming else None)


def check(client, reporter, queue, now=None):
    """Run what is due now; report missed slots for the browser to ask about."""
    on_time, missed, upcoming = due(now)
    queued = run(client, reporter, queue, on_time)
    return {"queued": queued, "missed": missed, "next": upcoming}


def resolve(client, reporter, queue, choices, now=None):
    """Run or skip missed slots the user answered; slots another tab handled are ignored."""
    current = scheduled()
    selected, skipped = [], []
    for choice in choices if isinstance(choices, list) else []:
        if not isinstance(choice, dict) or choice.get("key") not in current or not isinstance(choice.get("slot"), (int, float)):
            continue
        item = {"key": choice["key"], "label": current[choice["key"]][0], "slot": float(choice["slot"])}
        (selected if choice.get("run") else skipped).append(item)
    for item in skipped:
        if _claim(item["key"], current[item["key"]][1], item["slot"]):
            reporter.info("DirtyTasks skipped the missed " + item["label"] + " run scheduled for " + _when(item["slot"]) + ".")
    return {"queued": run(client, reporter, queue, selected), "skipped": [item["key"] for item in skipped]}


def run(client, reporter, queue, items):
    """Claim each slot, then queue its actions; one failed queue does not stop the others."""
    current = scheduled()
    claimed = [item for item in items if item["key"] in current and _claim(item["key"], current[item["key"]][1], item["slot"])]
    groups = {}
    for item in claimed:
        group = "organization" if item["key"] in ("move", "rename") else "encoding" if item["key"].startswith("encoding:") \
            else item["key"]
        groups.setdefault(group, []).append(item)
    queued, errors = [], []
    for group, members in groups.items():
        slot = max(item["slot"] for item in members)
        try:
            queue(client, reporter, group, [item["key"] for item in members], slot)
            queued += [item["key"] for item in members]
        except Exception as error:
            for item in members:
                _release(item["key"], item["slot"])
            errors.append(str(error))
    if errors:
        raise RuntimeError("; ".join(errors))
    return queued


def _when(slot):
    return time.strftime("%a %Y-%m-%d %H:%M", time.localtime(slot))
