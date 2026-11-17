"""pyterm.packages — install packages from PyPI (or Pyodide) with micropip, with progress.

    import pyterm
    await pyterm.packages.ainstall("pyfiglet", "rich==13.7.1")   # async code
    pyterm.packages.require("pyfiglet")                          # ordinary code

Both are also available as ``pyterm.ainstall`` / ``pyterm.require``.
"""
import asyncio
import importlib
import re
import sys
import time

from .console import DIM, GREEN, RESET, YELLOW, _await, _flush, style

__all__ = ["ainstall", "require", "installed_version"]

_REQ_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$")
_SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def _dist_name(req):
    m = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)", str(req))
    return m.group(1) if m else str(req)


def installed_version(name):
    """Version of an installed distribution, or None."""
    try:
        from importlib.metadata import version

        return version(name)
    except Exception:
        return None


def _flatten(items):
    out = []
    for it in items:
        if isinstance(it, (list, tuple, set)):
            out += _flatten(it)
        elif hasattr(it, "to_py"):
            out += _flatten(list(it.to_py()))
        elif it is not None and str(it).strip():
            out.append(str(it).strip())
    return list(dict.fromkeys(out))


async def _micropip():
    try:
        import micropip
    except ImportError:
        import pyodide_js

        await pyodide_js.loadPackage("micropip")
        import micropip
    return micropip


def _bar(frac, width=18):
    done = int(round(width * max(0.0, min(1.0, frac))))
    return f"\x1b[36m{'━' * done}\x1b[38;5;238m{'━' * (width - done)}{RESET}"


async def ainstall(*packages, label=None, quiet=False, animate=True):
    """Install packages with micropip and show the progress in the terminal.

    Accepts names ("pyfiglet"), pinned versions ("rich==13.7.1"), Pyodide packages ("numpy")
    and wheel URLs. Packages already installed are skipped. Returns True when all of them
    are available, False if one could not be installed (the error is printed).
    """
    reqs = _flatten(packages)
    todo = []
    for r in reqs:
        # a plain name that is already installed needs no work; anything with a version
        # specifier or a URL goes to micropip, which returns at once when it is satisfied
        if not (_REQ_NAME.match(r) and installed_version(r)):
            todo.append(r)
    if not todo:
        return True
    w = sys.stdout.write
    n = len(todo)
    if not quiet:
        what = f"{n} package{'s' if n != 1 else ''}"
        w(style(f"Installing {what}{' for ' + label if label else ''} with micropip…", "grey") + "\n")
        _flush()
    try:
        micropip = await _micropip()
    except asyncio.CancelledError:
        if not quiet:
            w(style("Installation cancelled.", "yellow") + "\n")
        return False
    except Exception as e:
        sys.stderr.write(f"Could not load micropip: {e}\n")
        return False
    t_all = time.monotonic()
    for i, req in enumerate(todo, 1):
        name = _dist_name(req)
        t0 = time.monotonic()
        state = {"k": 0}

        def frame():
            spin = _SPIN[state["k"] % len(_SPIN)]
            state["k"] += 1
            return (f"\r\x1b[2K  \x1b[36m{spin}{RESET} {_bar((i - 1) / n)} {DIM}{i}/{n}{RESET}  {req}"
                    f"  {DIM}{time.monotonic() - t0:.1f}s{RESET}")

        async def spinner():
            while True:
                w(frame())
                _flush()
                await asyncio.sleep(0.08)

        task = None
        if not quiet:
            if animate:
                task = asyncio.ensure_future(spinner())
            else:
                w(frame())
                _flush()
        try:
            await micropip.install(req)
        except asyncio.CancelledError:
            if not quiet:
                w(f"\r\x1b[2K  {YELLOW}■{RESET} {req} {DIM}cancelled{RESET}\n")
            return False
        except Exception as e:
            msg = str(e).strip().split("\n")[0] or type(e).__name__
            w("\r\x1b[2K")
            sys.stderr.write(f"  ✘ {req}: {msg}\n")
            if "pure Python" in msg or "wheel" in msg:
                sys.stderr.write("    Only pure-Python packages and packages built for Pyodide can be installed.\n")
            elif "fetch" in msg.lower() or "network" in msg.lower():
                sys.stderr.write("    Installing packages needs an internet connection.\n")
            return False
        finally:
            if task is not None:
                task.cancel()
        if not quiet:
            ver = installed_version(name)
            w(f"\r\x1b[2K  {GREEN}✔{RESET} {name}{' ' + ver if ver else ''}"
              f"  {DIM}{time.monotonic() - t0:.1f}s{RESET}\n")
            _flush()
    if not quiet:
        w(style(f"Ready in {time.monotonic() - t_all:.1f}s.", "grey") + "\n")
        _flush()
    importlib.invalidate_caches()
    return True


def require(*packages, quiet=False):
    """Install packages (if missing) before importing them, from ordinary non-async code:

        pyterm.require("pyfiglet")
        import pyfiglet

    Raises ImportError when a package can't be installed.
    """
    ok = _await(ainstall(*packages, quiet=quiet, animate=False))
    if not ok:
        raise ImportError("could not install: " + ", ".join(_flatten(packages)))
    return True
