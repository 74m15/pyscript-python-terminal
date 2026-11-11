"""pyterm — helpers for writing terminal programs that run inside PyTerm.

Plain ``input()`` / ``print()`` loops and ``cmd.Cmd`` subclasses already work in
PyTerm. This module adds a few conveniences on top:

    import pyterm

    app = pyterm.App("notes", intro="Type help to see the commands.")

    @app.command
    def add(*words):
        "Add a note"
        ...

    app.run()

See doc/custom-programs.md for the full guide.
"""

import builtins
import inspect
import os
import shlex
import sys
import traceback

import pyterm_host as _host

try:
    from pyodide.ffi import can_run_sync as _can_run_sync, run_sync as _run_sync, to_js as _to_js
except ImportError:  # pragma: no cover - outside Pyodide
    _can_run_sync = lambda: False  # noqa: E731
    _run_sync = None
    _to_js = lambda x: x  # noqa: E731

__all__ = [
    "App", "run", "input", "ainput", "confirm", "choose", "table", "style", "StopProgram",
    "clear", "title", "download", "HOME", "BROWSER_DIR",
    "RED", "GREEN", "YELLOW", "BLUE", "MAGENTA", "CYAN", "WHITE", "GREY", "BOLD", "DIM", "RESET",
]

HOME = "/home/pyodide"
BROWSER_DIR = HOME + "/browser"

# Current program context (set by App.run / the PyTerm launcher).
_context = {"history": None, "completions": None}


class StopProgram(BaseException):
    """Raised inside a program waiting for input when the user presses Stop.

    It derives from BaseException (like SystemExit), so ``except Exception`` and
    ``except KeyboardInterrupt`` don't swallow it and the program ends.
    """


def _check_status(status):
    if status == 2:
        raise EOFError
    if status == 3:
        raise KeyboardInterrupt
    if status == 4:
        raise StopProgram

# ---------------------------------------------------------------- colours
RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
_FG = {"black": 30, "red": 31, "green": 32, "yellow": 33, "blue": 34, "magenta": 35, "cyan": 36,
       "white": 37, "grey": 90, "gray": 90}
RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, GREY = (
    f"\x1b[{_FG[c]}m" for c in ("red", "green", "yellow", "blue", "magenta", "cyan", "white", "grey"))


def _color(c, bg=False):
    if c is None:
        return ""
    if isinstance(c, int):
        return f"\x1b[{48 if bg else 38};5;{c}m"
    if isinstance(c, tuple) and len(c) == 3:
        return f"\x1b[{48 if bg else 38};2;{c[0]};{c[1]};{c[2]}m"
    s = str(c).lower()
    if s.startswith("#") and len(s) == 7:
        r, g, b = int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16)
        return f"\x1b[{48 if bg else 38};2;{r};{g};{b}m"
    code = _FG.get(s)
    if code is None:
        raise ValueError(f"unknown colour {c!r}")
    return f"\x1b[{code + 10 if bg else code}m"


def style(text, fg=None, bg=None, *, bold=False, dim=False, italic=False, underline=False):
    """Return ``text`` wrapped in ANSI codes. Colours: names ("red"), 0-255, "#rrggbb" or (r, g, b)."""
    pre = _color(fg) + _color(bg, True)
    if bold:
        pre += "\x1b[1m"
    if dim:
        pre += "\x1b[2m"
    if italic:
        pre += "\x1b[3m"
    if underline:
        pre += "\x1b[4m"
    return f"{pre}{text}{RESET}" if pre else str(text)


# ---------------------------------------------------------------- terminal I/O
def _flush():
    for s in (sys.stdout, sys.stderr):
        try:
            s.flush()
        except Exception:
            pass
    _host.flush()


def read_line(password=False, completions=None, history=None):
    """Read one line typed in the terminal (no prompt is printed)."""
    _flush()
    if completions is None:
        completions = _context.get("completions")
        if callable(completions):
            try:
                completions = completions()
            except Exception:
                completions = None
    if history is None:
        history = _context.get("history")
    comps = _to_js([str(c) for c in completions]) if completions else None
    # Prefer stack switching: the worker stays responsive while waiting, so files in
    # ~/browser keep being saved. Shared-memory blocking is the fallback.
    if _can_run_sync():
        res = _run_sync(_host.input_async(bool(password), comps, history))
    elif _host.can_block():
        res = _host.read_input(bool(password), comps, history)
    else:
        raise RuntimeError(
            "input() can't pause Python in this browser (it lacks WebAssembly stack switching). "
            "Use `await pyterm.ainput()` instead, or open PyTerm in an up-to-date Chrome, Edge or Firefox."
        )
    status, text = int(res[0]), str(res[1])
    _check_status(status)
    return text


def input(prompt="", *, password=False, completions=None, history=None):  # noqa: A001
    """Like the built-in input(), plus Tab-completion words, password mode and a history name."""
    if prompt:
        sys.stdout.write(str(prompt))
    return read_line(password, completions, history)


async def ainput(prompt="", *, password=False, completions=None, history=None):
    """Asynchronous input(): works in every browser (use with ``await``)."""
    if prompt:
        sys.stdout.write(str(prompt))
    _flush()
    comps = _to_js([str(c) for c in completions]) if completions else None
    res = await _host.input_async(bool(password), comps, history or _context.get("history"))
    status, text = int(res[0]), str(res[1])
    _check_status(status)
    return text


def confirm(question, default=False):
    """Ask a yes/no question. Enter alone returns ``default``."""
    hint = "[Y/n]" if default else "[y/N]"
    while True:
        ans = input(f"{question} {style(hint, 'grey')} ", completions=["yes", "no"]).strip().lower()
        if not ans:
            return default
        if ans in ("y", "yes"):
            return True
        if ans in ("n", "no"):
            return False
        print(style("Please answer yes or no.", "yellow"))


def choose(prompt, options):
    """Show a numbered list and return the chosen option."""
    options = list(options)
    for i, o in enumerate(options, 1):
        print(f"  {style(str(i), 'cyan', bold=True)}  {o}")
    while True:
        ans = input(f"{prompt} {style(f'[1-{len(options)}]', 'grey')} ",
                    completions=[str(o) for o in options]).strip()
        if ans.isdigit() and 1 <= int(ans) <= len(options):
            return options[int(ans) - 1]
        for o in options:
            if str(o).lower() == ans.lower():
                return o
        print(style("Pick one of the numbers above.", "yellow"))


def _vlen(s):
    import re
    return len(re.sub(r"\x1b\[[0-9;:]*m", "", s))


def table(rows, headers=None, *, padding=2):
    """Print rows (lists/tuples) as an aligned table."""
    rows = [[str(c) for c in r] for r in rows]
    all_rows = ([[str(h) for h in headers]] if headers else []) + rows
    if not all_rows:
        return
    n = max(len(r) for r in all_rows)
    widths = [max((_vlen(r[i]) for r in all_rows if i < len(r)), default=0) for i in range(n)]
    gap = " " * padding

    def line(r):
        return gap.join(c + " " * (widths[i] - _vlen(c)) for i, c in enumerate(r)).rstrip()

    if headers:
        print(style(line(all_rows[0]), bold=True))
        print(style(gap.join("─" * w for w in widths), "grey"))
    for r in rows:
        print(line(r))


def clear():
    """Clear the terminal screen."""
    _flush()
    _host.clear()


def title(text=""):
    """Set the terminal / window title ('' restores the default)."""
    _flush()
    _host.title(str(text))


def download(path, name=None):
    """Send a file (or a whole folder, zipped) from Python to your computer / Puter Drive."""
    path = os.path.expanduser(str(path))
    if os.path.isdir(path):
        import io
        import zipfile
        buf = io.BytesIO()
        root = os.path.abspath(path)
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for dirpath, _dirs, files in os.walk(root):
                for f in files:
                    full = os.path.join(dirpath, f)
                    zf.write(full, os.path.relpath(full, os.path.dirname(root)))
        data = buf.getvalue()
        name = name or (os.path.basename(root.rstrip("/")) or "folder") + ".zip"
        mime = "application/zip"
    else:
        with open(path, "rb") as fh:
            data = fh.read()
        name = name or os.path.basename(path)
        mime = ""
    _flush()
    _host.download(name, _to_js(data), mime)
    return name


def _await(value):
    if inspect.isawaitable(value):
        if _can_run_sync():
            return _run_sync(value)
        raise RuntimeError("async commands need a browser with WebAssembly stack switching; use App.arun()")
    return value


def _print_error(e):
    tb = traceback.format_exception(type(e), e, e.__traceback__)
    # hide the App machinery frames, keep the user's own
    text = "".join(tb[:1] + [t for t in tb[1:] if "pyterm.py" not in t])
    sys.stderr.write(text)


# ---------------------------------------------------------------- App
class _Stop(Exception):
    pass


class App:
    """A small command-line program: register commands, then call ``run()``.

    Built-in commands: ``help``, ``clear`` and ``exit`` (also ``quit``; Ctrl+D works too).
    Arguments are split like a shell (quotes group words) and passed to your function.
    """

    def __init__(self, name="app", *, prompt=None, intro=None, history=True, color="cyan"):
        self.name = name
        self.prompt = prompt if prompt is not None else style(f"{name}> ", color, bold=True)
        self.intro = intro
        self.history = name if history is True else (history or None)
        self.commands = {}
        self._aliases = {}
        self._default = None
        self._exit_handlers = []
        self.running = False
        self.command(self._help, name="help", help="Show the commands (help <command> for details)")
        self.command(clear, name="clear", help="Clear the screen")
        self.command(self.stop, name="exit", aliases=("quit",), help="Leave the program")

    # -- registration
    def command(self, fn=None, *, name=None, aliases=(), help=None):  # noqa: A002
        """Decorator registering a command. The docstring's first line is its help text."""
        def deco(f):
            n = name or f.__name__.rstrip("_").replace("_", "-")
            doc = help or (inspect.getdoc(f) or "").strip().split("\n")[0]
            self.commands[n] = (f, doc)
            for a in aliases:
                self._aliases[a] = n
            return f
        return deco(fn) if fn is not None else deco

    def default(self, fn):
        """Decorator: called with the whole line when it isn't a known command."""
        self._default = fn
        return fn

    def on_exit(self, fn):
        """Decorator: called when the program ends (exit, Ctrl+D or an error)."""
        self._exit_handlers.append(fn)
        return fn

    def names(self):
        return sorted(list(self.commands) + list(self._aliases))

    # -- built-ins
    def stop(self):
        """Leave the program."""
        self.running = False
        raise _Stop

    def _usage(self, n):
        f = self.commands[n][0]
        try:
            sig = inspect.signature(f)
        except (TypeError, ValueError):
            return n
        parts = [n]
        for p in sig.parameters.values():
            if p.kind is p.VAR_POSITIONAL:
                parts.append(f"[{p.name}...]")
            elif p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
                parts.append(f"<{p.name}>" if p.default is p.empty else f"[{p.name}]")
        return " ".join(parts)

    def _help(self, command=None):
        """Show the commands."""
        if command:
            n = self._aliases.get(command, command)
            if n not in self.commands:
                print(style(f"No command named {command!r}.", "yellow"))
                return
            f, doc = self.commands[n]
            print(style(self._usage(n), bold=True))
            full = inspect.getdoc(f)
            if full:
                print(full)
            return
        rows = [(style(self._usage(n), "cyan"), doc) for n, (_f, doc) in sorted(self.commands.items())]
        table(rows)

    # -- execution
    def execute(self, line):
        line = line.strip()
        if not line or line.startswith("#"):
            return
        try:
            args = shlex.split(line)
        except ValueError as e:
            print(style(f"Could not read that line: {e}", "red"))
            return
        n = self._aliases.get(args[0], args[0])
        if n not in self.commands:
            if self._default:
                result = _await(self._default(line))
                if result is not None:
                    print(result)
            else:
                print(style(f"Unknown command {args[0]!r}. Type help to see the commands.", "yellow"))
            return
        f = self.commands[n][0]
        try:
            inspect.signature(f).bind(*args[1:])
        except TypeError:
            print(style(f"Usage: {self._usage(n)}", "yellow"))
            return
        except ValueError:
            pass
        result = _await(f(*args[1:]))
        if result is not None:
            print(result)

    def run(self):
        """Start the prompt loop. Returns when the user types exit or presses Ctrl+D."""
        old = dict(_context)
        _context["history"] = self.history
        _context["completions"] = self.names
        if self.intro:
            print(self.intro)
        title(self.name)
        self.running = True
        try:
            while self.running:
                try:
                    line = input(self.prompt)
                except KeyboardInterrupt:
                    continue
                except EOFError:
                    break
                try:
                    self.execute(line)
                except _Stop:
                    break
                except KeyboardInterrupt:
                    print(style("Interrupted", "yellow"))
                except Exception as e:  # keep the program alive on errors
                    _print_error(e)
        finally:
            self.running = False
            for h in self._exit_handlers:
                try:
                    h()
                except Exception as e:
                    _print_error(e)
            _context.update(old)
            title("")

    async def arun(self):
        """Async version of run(): works in every browser."""
        if self.intro:
            print(self.intro)
        title(self.name)
        self.running = True
        try:
            while self.running:
                try:
                    line = await ainput(self.prompt, completions=self.names(), history=self.history)
                except KeyboardInterrupt:
                    continue
                except EOFError:
                    break
                try:
                    line = line.strip()
                    if not line:
                        continue
                    args = shlex.split(line)
                    n = self._aliases.get(args[0], args[0])
                    if n in self.commands:
                        r = self.commands[n][0](*args[1:])
                        if inspect.isawaitable(r):
                            r = await r
                        if r is not None:
                            print(r)
                    else:
                        self.execute(line)
                except _Stop:
                    break
                except Exception as e:
                    _print_error(e)
        finally:
            self.running = False
            for h in self._exit_handlers:
                h()
            title("")


def run(handler, *, prompt="> ", intro=None, history=None, completions=None):
    """Simplest program loop: ``handler(line)`` is called for every line typed.

    Return False from the handler (or type exit / press Ctrl+D) to stop.
    Whatever else the handler returns (if not None) is printed.
    """
    if intro:
        print(intro)
    while True:
        try:
            line = input(prompt, completions=completions, history=history)
        except KeyboardInterrupt:
            continue
        except EOFError:
            break
        if line.strip() in ("exit", "quit"):
            break
        try:
            r = _await(handler(line))
        except KeyboardInterrupt:
            print(style("Interrupted", "yellow"))
            continue
        except Exception as e:
            _print_error(e)
            continue
        if r is False:
            break
        if r is not None:
            print(r)
