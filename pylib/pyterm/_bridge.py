"""pyterm._bridge — requests from Python (in the worker) to the PyTerm page (main thread).

Every feature that needs the page (sign-in pop-ups, the programs list, …) goes through
``acall(name, args)``: the worker posts ``{type: 'rpc', name, args}`` to the page, the page
runs the handler registered under ``name`` and answers with JSON plus optional binary
blobs. New features only need a new handler on the page and a small Python wrapper.

Errors come back as ``BridgeError(code, message)``. When the user presses Stop while a
request is pending, the request is cancelled and ``KeyboardInterrupt`` is raised.
"""
import json

import pyterm_host as _host

from .console import _await, _flush

try:
    from pyodide.ffi import JsException
except ImportError:  # pragma: no cover - outside Pyodide
    JsException = Exception

__all__ = ["BridgeError", "acall", "call"]


class BridgeError(Exception):
    """A request to the page failed. ``code`` is a short machine-readable reason."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


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


async def acall(name, args=None, *, binary=False):
    """Ask the page to run handler ``name`` with the JSON-able ``args``.

    Returns the decoded JSON answer, or ``(answer, [bytes, ...])`` with ``binary=True``.
    """
    _flush()
    try:
        res = await _host.rpc(str(name), json.dumps(args or {}))
    except JsException as e:
        code, msg = _parse_error(e)
        if code == "interrupted":
            raise KeyboardInterrupt from None
        raise BridgeError(code, msg) from None
    raw = getattr(res, "json", None) if res is not None else None
    data = json.loads(str(raw)) if raw is not None else None
    if not binary:
        return data
    blobs = getattr(res, "blobs", None)
    return data, ([b.to_bytes() for b in blobs] if blobs is not None else [])


def call(name, args=None, *, binary=False):
    """Synchronous acall() (needs WebAssembly stack switching, like input())."""
    return _await(acall(name, args, binary=binary))
