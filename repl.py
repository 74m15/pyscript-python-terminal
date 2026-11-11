# PyTerm REPL core. Runs inside the background worker (py-worker.js), which loads Pyodide,
# registers the `pyterm_host` module and then reads the functions defined at the bottom.
import ast
import asyncio
import builtins
import inspect
import io
import os
import shutil
import sys
import tarfile
import time
import zipfile

import pyterm_host as host
from pyodide.console import PyodideConsole
from pyodide.ffi import to_js

HOME = "/home/pyodide"
BROWSER_DIR = HOME + "/browser"
MAX_REPR = 8000
VERSION = sys.version.split("\n")[0]

sys.path.insert(0, HOME + "/.pyterm")
os.makedirs(BROWSER_DIR, exist_ok=True)
os.chdir(HOME)
os.environ.setdefault("TERM", "xterm-256color")
os.environ.setdefault("COLORTERM", "truecolor")
os.environ["HOME"] = HOME

import pyterm  # noqa: E402  (the helper module written next to this file by the worker)

console = None
namespace = None


def _write(text, kind="out"):
    host.out(str(text), kind)


def _clear():
    """Clear the terminal screen."""
    pyterm.clear()


class _ExitRequested(Exception):
    """Regular Exception used instead of SystemExit (asyncio would re-raise SystemExit)."""


class _Interrupted(Exception):
    pass


class SafeConsole(PyodideConsole):
    async def runcode(self, source, code):
        try:
            return await super().runcode(source, code)
        except SystemExit as e:
            raise _ExitRequested(str(e)) from None
        except (KeyboardInterrupt, asyncio.CancelledError, pyterm.StopProgram):
            raise _Interrupted() from None


# Never let a stray Ctrl+C / exit escape the event loop as an unhandled error.
try:
    _loop = asyncio.get_event_loop()
    _loop._keyboard_interrupt_handler = lambda: None
    _loop._system_exit_handler = lambda code=None: None
except Exception:
    pass


# ---------------------------------------------------------------- stdin / input()
def _input(prompt=""):
    return pyterm.input(prompt)


class _Stdin(io.TextIOBase):
    encoding = "utf-8"
    name = "<stdin>"

    def readable(self):
        return True

    def isatty(self):
        return True

    def fileno(self):
        return 0

    def readline(self, size=-1):
        try:
            return pyterm.read_line() + "\n"
        except EOFError:
            return ""

    def read(self, size=-1):
        if size is not None and size >= 0:
            return self.readline()
        chunks = []
        while True:
            line = self.readline()
            if not line:
                return "".join(chunks)
            chunks.append(line)


builtins.input = _input
sys.stdin = sys.__stdin__ = _Stdin()

try:
    import getpass

    getpass.getpass = lambda prompt="Password: ", stream=None: pyterm.input(prompt, password=True)
except Exception:
    pass

_orig_sleep = time.sleep


def _sleep(seconds):
    """time.sleep that keeps output flowing, can be stopped, and works in the worker."""
    pyterm._flush()
    seconds = max(0.0, float(seconds))
    try:
        from pyodide.ffi import can_run_sync, run_sync

        jspi = can_run_sync()
    except Exception:
        jspi = False
    if jspi:
        # host.sleep resolves with 1 when the user presses Stop / Ctrl+C
        if int(run_sync(host.sleep(seconds * 1000)) or 0):
            raise KeyboardInterrupt
        return
    try:
        import js

        shared = bool(getattr(js, "crossOriginIsolated", False))
    except Exception:
        shared = False
    if shared:
        end = time.monotonic() + seconds
        cell = js.Int32Array.new(js.SharedArrayBuffer.new(4))
        while True:
            left = end - time.monotonic()
            if left <= 0:
                return
            js.Atomics.wait(cell, 0, 0, min(left, 0.1) * 1000)
            sum(())  # lets Pyodide deliver Ctrl+C from the interrupt buffer
    _orig_sleep(seconds)


time.sleep = _sleep


def set_size(cols, rows):
    os.environ["COLUMNS"] = str(int(cols))
    os.environ["LINES"] = str(int(rows))


# ---------------------------------------------------------------- demo
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
    w(f"{E}1mOSC 8 hyperlink:{E}0m \x1b]8;;https://pyodide.org\x07{E}4;34mpyodide.org{E}0m\x1b]8;;\x07\n\n")

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


# ---------------------------------------------------------------- running files / programs
_staged = {}


def stage_file(name, source, isolated=False):
    """Called from the worker: remember a script to run with __pyterm_run__()."""
    _staged["name"] = str(name)
    _staged["source"] = str(source)
    _staged["isolated"] = bool(isolated)


async def _run_staged():
    """Run the staged script. Scripts share the REPL namespace (like `python -i script.py`);
    programs (isolated) get a fresh one. Top-level await is allowed."""
    name = _staged.pop("name", "<script>")
    source = _staged.pop("source", "")
    isolated = _staged.pop("isolated", False)
    code = compile(source, name, "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT, dont_inherit=True)
    ns = {"__name__": "__main__", "__file__": name, "__builtins__": builtins} if isolated else namespace
    if not isolated:
        namespace["__file__"] = name
    old_argv = sys.argv
    sys.argv = [name]
    try:
        res = eval(code, ns)
        if inspect.iscoroutine(res):
            await res
    except pyterm.StopProgram:
        pass  # Stop pressed while the program waited for input: just end it
    except (SystemExit, _ExitRequested) as e:
        code_ = getattr(e, "code", None) if isinstance(e, SystemExit) else (e.args[0] if e.args else None)
        if code_ not in (None, 0, "None", ""):
            _write(f"{name} exited with status {code_}\n", "info")
    finally:
        sys.argv = old_argv
        pyterm.title("")
    return None


def run(path, *args):
    """Run a .py file as a program in a fresh namespace, e.g. run("Upload/app.py", "--verbose").
    input() works inside it. Relative paths start in /home/pyodide."""
    p = _resolve(path)
    with open(p, encoding="utf-8") as fh:
        source = fh.read()
    code = compile(source, p, "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT, dont_inherit=True)
    ns = {"__name__": "__main__", "__file__": p, "__builtins__": builtins}
    old_argv, old_path = sys.argv, list(sys.path)
    sys.argv = [p, *map(str, args)]
    sys.path.insert(0, os.path.dirname(p))
    try:
        res = eval(code, ns)
        if inspect.iscoroutine(res):
            from pyodide.ffi import can_run_sync, run_sync

            if can_run_sync():
                run_sync(res)
            else:
                return res  # await it at the prompt
    except SystemExit as e:
        if e.code not in (None, 0):
            _write(f"{os.path.basename(p)} exited with status {e.code}\n", "info")
    finally:
        sys.argv = old_argv
        sys.path[:] = old_path
        pyterm.title("")
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
        "download": pyterm.download,
        "run": run,
        "__pyterm_run__": _run_staged,
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
    except Exception as e:
        return f"<repr failed: {e!r}>"
    if len(r) > MAX_REPR:
        r = r[: MAX_REPR // 2] + f" ... [{len(r) - MAX_REPR} chars hidden] ... " + r[-MAX_REPR // 2 :]
    return r


_outer_tasks = set()


async def push(line):
    """Feed one line to the console (called by the worker)."""
    task = asyncio.current_task()
    if task is not None:
        _outer_tasks.add(task)
    try:
        return await _push(line)
    finally:
        _outer_tasks.discard(task)


async def _push(line):
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
    except (_Interrupted, KeyboardInterrupt, asyncio.CancelledError):
        _write("\nKeyboardInterrupt\n", "err")
    except BaseException as e:
        msg = getattr(fut, "formatted_error", None) or f"{type(e).__name__}: {e}\n"
        if "_Interrupted" in msg:
            msg = "\nKeyboardInterrupt\n"
        _write(msg, "err")
    finally:
        pyterm._flush()
    return "complete"


def interrupt():
    """Ctrl+C / Stop: cancel whatever user code is awaiting (not the push() wrappers)."""
    try:
        loop = asyncio.get_event_loop()
        for t in list(asyncio.all_tasks(loop)):
            if t not in _outer_tasks and not t.done():
                t.cancel()
    except Exception:
        pass


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


# ---------------------------------------------------------------- uploads
def _resolve(path):
    path = os.path.expanduser(str(path or "").strip()) or HOME
    if not os.path.isabs(path):
        path = os.path.join(HOME, path)
    return os.path.normpath(path)


def _free_name(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    if base.endswith(".tar"):
        base, ext = base[:-4], ".tar" + ext
    i = 1
    while os.path.exists(f"{base} ({i}){ext}"):
        i += 1
    return f"{base} ({i}){ext}"


def _place(path, policy):
    """Return the final path for a new file, or None to skip it."""
    if os.path.exists(path):
        if policy == "skip":
            return None
        if policy == "overwrite":
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path)
            return path
        return _free_name(path)
    return path


def _safe_join(root, member):
    member = member.replace("\\", "/")
    parts = [p for p in member.split("/") if p not in ("", ".")]
    if not parts or ".." in parts or parts[0] == "__MACOSX" or parts[-1] == ".DS_Store":
        return None
    target = os.path.normpath(os.path.join(root, *parts))
    if not (target == root or target.startswith(root.rstrip("/") + "/")):
        return None
    return target


def _to_bytes(data):
    return data.to_bytes() if hasattr(data, "to_bytes") else bytes(data)


def save_upload(path, data, policy="rename"):
    """Write uploaded bytes to `path` (relative paths are inside HOME). Returns the final path or None."""
    target = _resolve(path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    final = _place(target, policy)
    if final is None:
        return None
    with open(final, "wb") as fh:
        fh.write(_to_bytes(data))
    return final


def _archive_kind(raw, name):
    if raw[:4] == b"PK\x03\x04" or raw[:4] == b"PK\x05\x06":
        return "zip"
    if raw[:2] == b"\x1f\x8b" or raw[:3] == b"BZh" or raw[:6] == b"\xfd7zXZ\x00":
        return "tar"
    if len(raw) > 262 and raw[257:262] == b"ustar":
        return "tar"
    return None


def _archive_stem(name):
    n = os.path.basename(name)
    for ext in (".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz", ".zip", ".tar"):
        if n.lower().endswith(ext):
            return n[: -len(ext)] or "archive"
    return os.path.splitext(n)[0] or "archive"


def extract_upload(name, data, dest, policy="rename", subfolder=False):
    """Extract a ZIP / tar(.gz/.bz2/.xz) archive safely. Returns a summary dict."""
    raw = _to_bytes(data)
    kind = _archive_kind(raw, name)
    if not kind:
        raise ValueError(f"{name} is not a ZIP or tar archive")
    root = _resolve(dest)
    if subfolder:
        root = os.path.join(root, _archive_stem(name))
        if policy == "rename" and os.path.exists(root):
            root = _free_name(root)
    os.makedirs(root, exist_ok=True)
    written, skipped, renamed, blocked = 0, 0, 0, 0
    members = []
    if kind == "zip":
        zf = zipfile.ZipFile(io.BytesIO(raw))
        for info in zf.infolist():
            fname = info.filename
            if not (info.flag_bits & 0x800):
                try:
                    fname = fname.encode("cp437").decode("utf-8")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            members.append((fname, info.is_dir(), lambda i=info: zf.read(i)))
    else:
        tf = tarfile.open(fileobj=io.BytesIO(raw), mode="r:*")
        for m in tf.getmembers():
            if m.isdir():
                members.append((m.name, True, None))
            elif m.isfile():
                members.append((m.name, False, lambda m=m: tf.extractfile(m).read()))
            else:
                blocked += 1  # links and devices are never extracted
    total = len(members)
    for i, (mname, is_dir, read) in enumerate(members):
        target = _safe_join(root, mname)
        if target is None:
            if mname.replace("\\", "/").strip("/").split("/")[0] not in ("__MACOSX",) and not mname.endswith(".DS_Store"):
                blocked += 1
            continue
        if is_dir:
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        final = _place(target, policy)
        if final is None:
            skipped += 1
            continue
        if final != target:
            renamed += 1
        with open(final, "wb") as fh:
            fh.write(read())
        written += 1
        if i % 25 == 0:
            host.progress(i + 1, total, mname)
    return to_js({"dest": root, "files": written, "skipped": skipped, "renamed": renamed,
                  "blocked": blocked, "kind": kind}, dict_converter=__import__("js").Object.fromEntries)


def tree(path, limit=60, colored=True):
    """Print a folder tree (used after uploads)."""
    root = _resolve(path)
    B, D, R = ("\x1b[1;34m", "\x1b[2m", "\x1b[0m") if colored else ("", "", "")
    if not os.path.exists(root):
        _write(f"{root} does not exist\n", "err")
        return
    lines = [f"{B}{root}{R}"]
    shown = [0]
    more = [0]

    def walk(d, prefix):
        try:
            entries = sorted(os.scandir(d), key=lambda e: (not e.is_dir(), e.name.lower()))
        except OSError:
            return
        for i, e in enumerate(entries):
            last = i == len(entries) - 1
            if shown[0] >= limit:
                more[0] += 1
                if e.is_dir():
                    for _r, _ds, fs in os.walk(e.path):
                        more[0] += len(fs)
                continue
            branch = "└── " if last else "├── "
            if e.is_dir():
                lines.append(f"{prefix}{D}{branch}{R}{B}{e.name}/{R}")
                shown[0] += 1
                walk(e.path, prefix + ("    " if last else "│   "))
            else:
                try:
                    size = e.stat().st_size
                except OSError:
                    size = 0
                lines.append(f"{prefix}{D}{branch}{R}{e.name} {D}{_human(size)}{R}")
                shown[0] += 1

    walk(root, "")
    if more[0]:
        lines.append(f"{D}… and {more[0]} more{R}")
    _write("\n".join(lines) + "\n", "out")


def _human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def read_for_download(path):
    import js

    p = _resolve(path)
    if os.path.isdir(p):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for dirpath, _d, files in os.walk(p):
                for f in files:
                    full = os.path.join(dirpath, f)
                    zf.write(full, os.path.relpath(full, os.path.dirname(p)))
        data, name = buf.getvalue(), os.path.basename(p) + ".zip"
    else:
        with open(p, "rb") as fh:
            data = fh.read()
        name = os.path.basename(p)
    arr = js.Uint8Array.new(len(data))
    arr.assign(data)
    out = js.Object.new()
    out.name = name
    out.data = arr
    return out


make_console()
