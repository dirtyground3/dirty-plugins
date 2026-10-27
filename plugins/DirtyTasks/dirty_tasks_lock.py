"""A durable reservation coordinates organization with queued encoder workers."""
import json
import dirty_plugins_storage as storage

NAMESPACE = "dirtyTasks.work"


def acquire(kind, owner):
    with storage.transaction() as connection:
        raw = storage.get_metadata(NAMESPACE, "active", connection=connection)
        current = json.loads(raw) if raw else None
        wanted = {"kind": kind, "owner": owner}
        if current and (current["kind"], current["owner"]) != (kind, owner):
            raise RuntimeError("Another file task is active. Finish, cancel, or recover it before starting this task.")
        storage._put_metadata(connection, NAMESPACE, "active", json.dumps(wanted))


def release(kind, owner):
    with storage.transaction() as connection:
        raw = storage.get_metadata(NAMESPACE, "active", connection=connection)
        current = json.loads(raw) if raw else {}
        if current.get("kind") == kind and current.get("owner") == owner:
            connection.execute("DELETE FROM dirty_metadata WHERE namespace=? AND key='active'", (NAMESPACE,))


def queue_pending(client):
    for key in ("pendingOrganization", "pendingOrganization:scan", "pendingOrganization:generate"):
        raw = storage.get_metadata(NAMESPACE, key)
        if raw:
            args = json.loads(raw)
            client.queue("dirtyTasks", args, "DirtyTasks: organization: deferred automatic task")
            storage.delete_metadata(NAMESPACE, key, expected=raw)


def defer_organization(args):
    storage.set_metadata(NAMESPACE, "pendingOrganization:" + args["automationTrigger"], json.dumps(args))


def interrupted_organization(client):
    """Return the exact abandoned reservation only after checking Stash's queue."""
    raw = storage.get_metadata(NAMESPACE, "active")
    if not raw or json.loads(raw).get("kind") != "organization":
        return None
    state = client.call("{jobQueue{id status description}}")
    # Stash returns null for an empty queue. A missing field is not an answer.
    jobs = state.get("jobQueue")
    if "jobQueue" not in state or (jobs is not None and not isinstance(jobs, list)):
        raise RuntimeError("Could not check the organization task status. Try again.")
    if any(j.get("status") not in ("FINISHED", "FAILED", "CANCELLED")
           and "DirtyTasks: organization:" in str(j.get("description", "")) for j in jobs or []):
        return None
    return raw if storage.get_metadata(NAMESPACE, "active") == raw else None


def organization_recovery_status(client):
    return {"required": bool(interrupted_organization(client))}


def recover_organization(client):
    expected = interrupted_organization(client)
    if not expected:
        return False
    with storage.transaction() as connection:
        raw = storage.get_metadata(NAMESPACE, "active", connection=connection)
        if raw == expected:
            connection.execute("DELETE FROM dirty_metadata WHERE namespace=? AND key='active'", (NAMESPACE,))
            return True
    return False
