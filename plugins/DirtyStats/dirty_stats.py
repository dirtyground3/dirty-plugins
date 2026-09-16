"""Read-only source filesystem capacity for DirtyStats; standard library only."""

import ctypes
import json
import os
import shutil
import sys


def volume_identity(path):
    path = os.path.realpath(path)
    if os.name != "nt":
        return str(os.stat(path).st_dev)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    root = ctypes.create_unicode_buffer(32768)
    get_root = kernel.GetVolumePathNameW
    get_root.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
    get_root.restype = ctypes.c_int
    if not get_root(path, root, len(root)):
        raise ctypes.WinError(ctypes.get_last_error())
    name = ctypes.create_unicode_buffer(32768)
    get_name = kernel.GetVolumeNameForVolumeMountPointW
    get_name.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
    get_name.restype = ctypes.c_int
    # Network shares may not expose a volume GUID; use the resolved share root.
    identity = name.value if get_name(root.value, name, len(name)) else root.value
    return os.path.normcase(identity)


def capacities(paths, identity=volume_identity, usage=shutil.disk_usage):
    volumes, errors = {}, []
    for path in dict.fromkeys(paths):
        try:
            key = identity(path)
            if key in volumes:
                volumes[key]["sources"].append(path)
                continue
            disk = usage(path)
            volumes[key] = {"sources": [path], "total": disk.total}
        except (OSError, ValueError) as exc:
            errors.append({"path": path, "error": str(exc)})
    return {"total": sum(volume["total"] for volume in volumes.values()),
            "volumes": list(volumes.values()), "errors": errors}


def main():
    try:
        payload = json.load(sys.stdin)
        args = payload.get("args") or {}
        if args.get("mode") != "capacity":
            raise ValueError("Unsupported DirtyStats operation")
        paths = args.get("paths")
        if not isinstance(paths, list) or not all(isinstance(path, str) and path for path in paths):
            raise ValueError("Source paths must be a list of nonempty strings")
        json.dump({"output": json.dumps(capacities(paths))}, sys.stdout)
        return 0
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
