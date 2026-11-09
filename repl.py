import sys
import os
import asyncio
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


def set_size(cols, rows):
    os.environ["COLUMNS"] = str(int(cols))
    os.environ["LINES"] = str(int(rows))


os.environ.setdefault("TERM", "xterm-256color")
os.environ.setdefault("COLORTERM", "truecolor")


async def demo():
    """Show off the terminal's VT100 / ANSI escape sequence support."""
    w = sys.stdout.write
    E = "\x1b["
    w(f"{E}1mText styles{E}0m\n")
    w(f"  {E}1mbold{E}0m  {E}2mdim{E}0m  {E}3mitalic{E}0m  {E}4munderline{E}0m  "
      f"{E}4:3mcurly{E}0m  {E}9mstrike{E}0m  {E}7minverse{E}0m  {E}53moverline{E}0m  {E}5mblink{E}0m\n\n")
    w(f"{E}1m16 colours{E}0m\n  ")
    for i in range(8):
        w(f"{E}{40 + i}m   {E}0m")
    w("\n  ")
    for i in range(8):
        w(f"{E}{100 + i}m   {E}0m")
    w(f"\n\n{E}1m256 colours{E}0m\n  ")
    for i in range(16, 232):
        w(f"{E}48;5;{i}m {E}0m")
        if (i - 15) % 72 == 0:
            w("\n  ")
    for i in range(232, 256):
        w(f"{E}48;5;{i}m  {E}0m")
    w(f"\n\n{E}1mTruecolor{E}0m\n  ")
    for i in range(72):
        r = int(255 * (1 - i / 71)); g = int(255 * min(1, 2 * i / 71)) if i < 36 else int(255 * (2 - 2 * i / 71)); b = int(255 * i / 71)
        w(f"{E}48;2;{r};{g};{b}m {E}0m")
    w(f"\n\n{E}1mLine drawing (DEC special graphics){E}0m\n")
    w("\x1b(0  lqqqqqqqwqqqqqqqk\n  x       x       x\n  tqqqqqqqnqqqqqqqu\n  mqqqqqqqvqqqqqqqj\x1b(B\n\n")
    w(f"{E}1mOSC 8 hyperlink:{E}0m \x1b]8;;https://pyscript.net\x07{E}4;34mpyscript.net{E}0m\x1b]8;;\x07\n\n")

    w(f"{E}1mCarriage return (\\r) progress bar{E}0m\n")
    for p in range(0, 101, 2):
        bar = "█" * (p // 4) + "░" * (25 - p // 4)
        w(f"\r  {E}32m{bar}{E}0m {p:3d}%")
        await asyncio.sleep(0.03)
    w("\n")
    for i, frame in enumerate("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" * 3):
        w(f"\r  {E}36m{frame}{E}0m Working… step {i + 1}")
        await asyncio.sleep(0.05)
    w(f"\r{E}2K  {E}32m✔{E}0m Done\n\n")

    w(f"{E}1mCursor movement{E}0m\n")
    w("  line one\n  line two\n  line three\n")
    await asyncio.sleep(0.3)
    w(f"{E}3A{E}6C{E}33mONE{E}0m{E}1B{E}9D{E}33mTWO{E}0m{E}1B\r{E}8C{E}33mTHREE{E}0m\n")
    w(f"  insert: abcdef\x1b[4D{E}4h{E}35mXY{E}4l{E}0m   delete: 12345{E}3D{E}2P   erase: hello world{E}5D{E}K\n")
    return None


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
        "demo": demo,
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
js.window.pyterm_set_size = create_proxy(set_size)
js.window.pyterm_ready(sys.version.split("\n")[0], sys.platform)
