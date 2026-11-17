"""pyterm.programs — the programs listed in programs/index.json.

    from pyterm import programs
    programs.list()                 # [{'id': 'calc', 'title': 'Calculator', ...}, ...]
    info = programs.prepare("calc") # download it (and its libraries) if missing, install packages

``run("calc")`` at the prompt uses ``prepare()`` and then runs the program.
"""
import os

from . import _bridge
from .console import _await

__all__ = ["list", "alist", "find", "afind", "prepare", "aprepare"]

_list = list


async def alist():
    """The programs of programs/index.json: id, title, description, autoplay, onexit."""
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
        raise LookupError(f"no program named {query!r} in programs/index.json")
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
        # Pyodide packages they import (numpy, …), with "Loading …" messages in the terminal
        try:
            import pyterm_host

            await pyterm_host.load_imports("\n".join(sources))
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
