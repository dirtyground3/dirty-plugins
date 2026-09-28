"""Standard-library Stash transport for Dirty plugin backends."""
import json
import urllib.request


def contain_child_process(process):
    """On Windows, close-on-parent-exit job handles stop orphaned encoders.

    Return an explicit cleanup callback. Keeping the handle alive until the
    child exits also covers Stash forcibly stopping the Python plugin process.
    """
    import os
    if os.name != "nt":
        return lambda: None
    import ctypes
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                    ("flags", wintypes.DWORD), ("min_working", ctypes.c_size_t), ("max_working", ctypes.c_size_t),
                    ("active_processes", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                    ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
    class Counters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]
    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", Counters), ("process_memory", ctypes.c_size_t),
                    ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, int(process._handle)):
        if handle:
            kernel.CloseHandle(handle)
        process.terminate()
        process.wait()
        raise RuntimeError("Could not contain the encoder process for safe cancellation")
    return lambda: kernel.CloseHandle(handle)


class StashClient:
    def __init__(self, connection):
        host = connection.get("Host") or "127.0.0.1"
        if host in ("0.0.0.0", "::"):
            host = "127.0.0.1"
        if ":" in host and not host.startswith("["):
            host = "[" + host + "]"
        self.url = "{}://{}:{}/graphql".format(connection.get("Scheme") or "http", host, connection.get("Port") or 9999)
        self.headers = {"Content-Type": "application/json"}
        cookie = connection.get("SessionCookie") or {}
        if cookie.get("Name") and cookie.get("Value"):
            self.headers["Cookie"] = cookie["Name"] + "=" + cookie["Value"]
        if connection.get("ApiKey"):
            self.headers["ApiKey"] = connection["ApiKey"]

    def call(self, query, variables=None):
        request = urllib.request.Request(self.url, json.dumps({"query": query, "variables": variables or {}}).encode(), self.headers)
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        if result.get("errors"):
            raise RuntimeError("; ".join(error["message"] for error in result["errors"]))
        return result.get("data") or {}

    def queue(self, plugin_id, args, description):
        return self.call("mutation($id:ID!,$args:Map,$description:String){runPluginTask(plugin_id:$id,args_map:$args,description:$description)}",
                         {"id": plugin_id, "args": args, "description": description})["runPluginTask"]
