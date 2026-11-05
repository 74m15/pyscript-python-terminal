import sys
import js
from pyodide.console import PyodideConsole
from pyodide.ffi import create_proxy, to_js

MAX_REPR = 8000

console = None
namespace = None


def _write(text, kind):
    js.window.pyterm_write(str(text), kind)


def _clear():
    """Clear the terminal screen."""
    js.window.pyterm_clear()


class _ExitRequested(Exception):
    """Regular Exception used instead of SystemExit, which asyncio re-raises
    out of the event loop (causing an unhandled rejection)."""


class SafeConsole(PyodideConsole):
    async def runcode(self, source, code):
        try:
            return await super().runcode(source, code)
        except (SystemExit, KeyboardInterrupt) as e:
            raise _ExitRequested(str(e)) from None


class _Exit:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return f"Use {self.name}() or the Restart button to reset the interpreter"

    def __call__(self, code=None):
        raise _ExitRequested(code)


def make_console():
    global console, namespace
    namespace = {
        "__name__": "__main__",
        "__doc__": None,
        "clear": _clear,
        "cls": _clear,
        "exit": _Exit("exit"),
        "quit": _Exit("quit"),
    }
    console = SafeConsole(
        globals=namespace,
        stdout_callback=lambda s: _write(s, "out"),
        stderr_callback=lambda s: _write(s, "err"),
    )


def _short_repr(value):
    try:
        r = repr(value)
    except Exception as e:  # repr itself failed
        return f"<repr failed: {e!r}>"
    if len(r) > MAX_REPR:
        r = r[: MAX_REPR // 2] + f" ... [{len(r) - MAX_REPR} chars hidden] ... " + r[-MAX_REPR // 2 :]
    return r


async def push(line):
    fut = console.push(line)
    if fut.syntax_check == "incomplete":
        return "incomplete"
    if fut.syntax_check == "syntax-error":
        _write(fut.formatted_error, "err")
        return "complete"
    try:
        result = await fut
        if result is not None:
            namespace["_"] = result
            _write(_short_repr(result) + "\n", "result")
    except _ExitRequested:
        make_console()
        return "exit"
    except BaseException as e:
        msg = getattr(fut, "formatted_error", None) or f"{type(e).__name__}: {e}\n"
        _write(msg, "err")
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
    return "complete"


def complete(source):
    try:
        options, start = console.complete(source)
        return to_js([list(options), start])
    except Exception:
        return to_js([[], len(source)])


def reset_buffer():
    console.buffer = []


def restart():
    make_console()
    return True


make_console()

js.window.pyterm_push = create_proxy(push)
js.window.pyterm_complete = create_proxy(complete)
js.window.pyterm_reset_buffer = create_proxy(reset_buffer)
js.window.pyterm_restart = create_proxy(restart)
js.window.pyterm_ready(sys.version.split("\n")[0], sys.platform)
