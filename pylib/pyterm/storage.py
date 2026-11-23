"""pyterm.storage — folders of your computer under /storage/local/<name>.

    from pyterm import storage

    m = storage.mount("photos")        # the user picks a folder → /storage/local/photos
    os.listdir(m.path)                 # or os.listdir("/storage/local/photos")
    open(f"{m.path}/notes.txt", "w").write("hello")    # written back to the computer
    storage.unmount("photos")          # saves what is left and removes /storage/local/photos

How it works
------------
``mount(name)`` asks the page to show a small dialog; its button opens the browser's folder
picker (browsers only open it from a click). The chosen folder is copied into Python's file
system at ``/storage/local/<name>``. Changes made by Python are written back to the folder
on the computer after every command, while a program waits for input, when ``save()`` is
called and when the folder is unmounted. Only changes made by Python are written: files
added to the folder on the computer meanwhile are never deleted. ``refresh(name)`` reads
the changes made on the computer since the folder was mounted.

Needs the File System Access API (Chrome, Edge, Opera on a computer) and a page that isn't
inside a frame of another site. Mounted folders last until the page is reloaded or Python
is hard-restarted. The whole folder is held in memory, so pick folders of reasonable size.

Every function has an async twin (``amount``, ``aunmount``, ``asave``, ``arefresh``) for
code that uses ``await``; the plain ones need WebAssembly stack switching, like ``input()``.
"""
import json
import os
import re

import pyterm_host as _host

from .console import HOME, LOCAL_DIR, STORAGE_DIR, _await, _flush

try:
    from pyodide.ffi import JsException
except ImportError:  # pragma: no cover - outside Pyodide
    JsException = Exception

__all__ = [
    "StorageError", "Mount", "LOCAL_DIR", "STORAGE_DIR",
    "mount", "amount", "unmount", "aunmount", "save", "asave", "refresh", "arefresh",
    "mounts", "get", "is_mounted", "path", "supported", "asupported",
]

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class StorageError(Exception):
    """A storage operation failed. ``code`` is one of: invalid_name, already_mounted,
    not_empty, not_mounted, unsupported, blocked, cancelled, denied, busy, save_failed, error."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Mount:
    """A folder of the computer mounted at ``path`` (= /storage/local/<name>).

    Attributes: name, path, folder (the folder's name on the computer), since (Unix time).
    A Mount can be used wherever a path is expected: ``open(os.path.join(m, "a.txt"))``.
    """

    def __init__(self, data):
        self.name = data.get("name")
        self.path = data.get("path")
        self.folder = data.get("folder")
        self.since = float(data.get("since") or 0)

    def __fspath__(self):
        return self.path

    def __str__(self):
        return self.path

    def __eq__(self, other):
        return isinstance(other, Mount) and other.name == self.name and other.path == self.path

    def __hash__(self):
        return hash((self.name, self.path))

    def __repr__(self):
        return f"<Mount {self.name!r} at {self.path} ← folder {self.folder!r}>"

    def save(self):
        return save(self.name)

    def refresh(self):
        return refresh(self.name)

    def unmount(self, save=True):  # noqa: A002 - mirrors unmount()
        return unmount(self.name, save=save)


# ---------------------------------------------------------------- helpers
def _check_name(name):
    n = str(name or "").strip()
    if not _NAME.match(n):
        raise StorageError(
            "invalid_name",
            f"invalid name {n!r}: use letters, digits, '.', '_' or '-' "
            "(at most 64 characters, starting with a letter or a digit)",
        )
    return n


def path(name):
    """The mount point of ``name``: /storage/local/<name> (mounted or not)."""
    return f"{LOCAL_DIR}/{_check_name(name)}"


def _parse_error(e):
    s = str(e)
    i = s.find("{")
    if i >= 0:
        try:
            d = json.loads(s[i:])
            return str(d.get("code") or "error"), str(d.get("message") or s)
        except ValueError:
            pass
    return "error", s.split(": ", 1)[-1]


async def _call(fn, *args):
    _flush()
    try:
        res = await fn(*args)
    except JsException as e:
        code, msg = _parse_error(e)
        if code == "interrupted":
            raise KeyboardInterrupt from None
        raise StorageError(code, msg) from None
    return json.loads(str(res)) if res is not None else None


def _leave(p):
    """Move the current directory out of ``p`` before it disappears."""
    try:
        cwd = os.getcwd()
    except OSError:
        return
    if cwd == p or cwd.startswith(p + "/"):
        os.chdir(HOME)


# ---------------------------------------------------------------- functions
def mounts():
    """The mounted folders: [Mount, …]."""
    return [Mount(d) for d in json.loads(str(_host.local_list()))]


def get(name):
    """The Mount called ``name``, or None."""
    n = _check_name(name)
    return next((m for m in mounts() if m.name == n), None)


def is_mounted(name):
    return get(name) is not None


async def asupported():
    """{"supported": bool, "framed": bool}: whether this browser can open folders of the
    computer, and whether PyTerm runs inside a frame (where browsers may block the picker)."""
    from . import _bridge

    return await _bridge.acall("storage.supported")


def supported():
    return _await(asupported())


async def amount(name):
    """Ask the user for a folder of the computer and mount it at /storage/local/<name>.

    A dialog appears; its button opens the browser's folder picker. Returns a Mount.
    Raises StorageError: already_mounted, not_empty (/storage/local/<name> already has
    files), unsupported (browser without the File System Access API), blocked (the picker
    isn't allowed inside this frame), cancelled (no folder chosen) or denied.
    """
    n = _check_name(name)
    if is_mounted(n):
        raise StorageError("already_mounted", f"{LOCAL_DIR}/{n} is already mounted")
    return Mount(await _call(_host.local_mount, n))


def mount(name):
    n = _check_name(name)
    return _await(amount(n))


async def aunmount(name, save=True):  # noqa: A002
    """Unmount /storage/local/<name>. With ``save=True`` (the default) Python's last
    changes are written to the computer first; ``save=False`` drops them. Returns the Mount."""
    n = _check_name(name)
    if not is_mounted(n):
        raise StorageError("not_mounted", f"nothing is mounted at {LOCAL_DIR}/{n}")
    _leave(f"{LOCAL_DIR}/{n}")
    return Mount(await _call(_host.local_unmount, n, bool(save)))


def unmount(name, save=True):  # noqa: A002
    n = _check_name(name)
    if not is_mounted(n):
        raise StorageError("not_mounted", f"nothing is mounted at {LOCAL_DIR}/{n}")
    return _await(aunmount(n, save=save))


async def asave(name=None):
    """Write Python's changes to the computer now (one folder, or all with None).
    Returns {"written": files written, "removed": entries deleted on the computer}."""
    n = _check_name(name) if name is not None else None
    if n is not None and not is_mounted(n):
        raise StorageError("not_mounted", f"nothing is mounted at {LOCAL_DIR}/{n}")
    return await _call(_host.local_save, n)


def save(name=None):
    if name is not None:
        _check_name(name)
    return _await(asave(name))


async def arefresh(name):
    """Read the changes made to the folder on the computer since it was mounted (Python's
    own changes are saved first, so nothing is lost). Returns {"read": …, "removed": …}."""
    n = _check_name(name)
    if not is_mounted(n):
        raise StorageError("not_mounted", f"nothing is mounted at {LOCAL_DIR}/{n}")
    return await _call(_host.local_refresh, n)


def refresh(name):
    n = _check_name(name)
    if not is_mounted(n):
        raise StorageError("not_mounted", f"nothing is mounted at {LOCAL_DIR}/{n}")
    return _await(arefresh(n))
