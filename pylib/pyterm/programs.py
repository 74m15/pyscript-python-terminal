"""pyterm.programs — the programs of the list in use (an index.json: the built-in
programs/index.json, or one loaded from a URL).

    from pyterm import programs
    programs.list()                 # [{'id': 'calc', 'title': 'Calculator', ...}, ...]
    info = programs.prepare("calc") # download it (and its libraries) if missing, install packages
    programs.load("https://example.org/my-programs/index.json")   # use another list
    programs.source()               # {'url': ..., 'name': ..., 'builtin': False, 'count': 3, ...}
    programs.load(None)             # back to the site's default list

``run("calc")`` at the prompt uses ``prepare()`` and then runs the program.
"""
import os
import shutil

from . import _bridge
from .console import _await

__all__ = ["list", "alist", "find", "afind", "prepare", "aprepare", "load", "aload", "source", "asource", "LoadError"]

_list = list


class LoadError(Exception):
    """The programs list could not be loaded (bad address, not reachable, CORS, not JSON, …)."""


async def alist():
    """The programs of the list in use: id, title, description, autoplay, onexit."""
    return await _bridge.acall("programs.list")


def list():  # noqa: A001
    return _await(alist())


async def afind(query):
    """Look up a program by id, title or file name. Returns its manifest or None.

    The manifest has: id, title, path (where the program file goes), files (every file of the
    program and its libraries in the Python file system), paths (import paths), requires, onexit.
    """
    return await _bridge.acall("programs.manifest", {"query": str(query)})


def find(query):
    return _await(afind(query))


async def aprepare(query, *, refresh=False, quiet=False, animate=True):
    """Make a program ready to run, like the Programs menu does:

    1. download the program and its libraries into ~/programs if any file is missing
       (or always with ``refresh=True``);
    2. load the Pyodide packages they import;
    3. install the packages listed in ``requires`` with micropip.

    Returns the manifest (see ``find``). Raises LookupError for an unknown program.
    """
    m = await afind(query)
    if not m:
        src = await asource()
        raise LookupError(f"no program named {query!r} in {src.get('name') or 'the programs list'}")
    # ~/programs holds the files of one list at a time: another list's files are removed
    marker = m.get("marker")
    if marker and m.get("catalog"):
        try:
            with open(marker, encoding="utf-8") as fh:
                same = fh.read().strip() == m["catalog"]
        except OSError:
            same = not os.path.isdir(os.path.dirname(marker))
        if not same:
            shutil.rmtree(os.path.dirname(marker), ignore_errors=True)
    missing = [f for f in m["files"] if not os.path.exists(f)]
    if refresh or missing:
        data, blobs = await _bridge.acall("programs.fetch", {"query": m["id"]}, binary=True)
        for path, blob in zip(data["files"], blobs):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(blob)
    sources = []
    for f in m["files"]:
        if f.endswith(".py"):
            try:
                with open(f, encoding="utf-8") as fh:
                    sources.append(fh.read())
            except OSError:
                pass
    if any("import" in s for s in sources):
        # Pyodide packages they import (numpy, …), with "Loading …" messages in the terminal.
        # One file at a time: a file with top-level await (or any file that doesn't parse on
        # its own) must not stop the others from being scanned.
        try:
            import pyterm_host
        except ImportError:
            pyterm_host = None
        for src in sources:
            if pyterm_host is None or "import" not in src:
                continue
            try:
                await pyterm_host.load_imports(src)
            except Exception:
                pass
    if m.get("requires"):
        from .packages import ainstall

        if not await ainstall(m["requires"], label=m["id"], quiet=quiet, animate=animate):
            raise ImportError(f"{m['id']}: a required package could not be installed")
    return m


def prepare(query, *, refresh=False, quiet=False):
    # no spinner task: with stack switching the event loop is busy waiting for us
    return _await(aprepare(query, refresh=refresh, quiet=quiet, animate=False))


async def asource():
    """Where the programs list comes from:
    {"url", "base" (where its files are read), "name", "builtin", "via", "count"}.
    ``via`` is one of default, html, config, query, ui, api, parent, python."""
    return await _bridge.acall("programs.source")


def source():
    return _await(asource())


async def aload(url=None):
    """Use the index.json at ``url`` (a folder address gets ``index.json`` added; relative
    addresses start at PyTerm's page). ``None`` goes back to the site's default list.
    The Programs menu is updated and the choice is kept for this tab. Returns ``source()``.
    Raises LoadError when the list can't be loaded (the current list stays in use)."""
    try:
        return await _bridge.acall("programs.load", {"url": None if url is None else str(url)})
    except _bridge.BridgeError as e:
        raise LoadError(str(e)) from None


def load(url=None):
    return _await(aload(url))
