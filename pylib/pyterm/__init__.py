"""pyterm — PyTerm's Python library.

Sub-modules:

    pyterm.console    terminal I/O: input/ainput, confirm, choose, table, style, clear,
                      title, download, App, run, StopProgram
    pyterm.packages   install PyPI packages with micropip, with progress (ainstall, require)
    pyterm.programs   the programs of programs/index.json (list, find, prepare)
    pyterm.sso        Google / Microsoft sign-in and OAuth access tokens

For convenience (and compatibility with older programs) everything in ``console`` plus
``ainstall`` / ``require`` is also available directly on ``pyterm``:

    import pyterm
    name = pyterm.input("Name? ")          # same as pyterm.console.input

New areas are added as new sub-modules; requests that need the PyTerm page go through
``pyterm._bridge`` (see doc/python-bridge.md).
"""
from . import console
from .console import *  # noqa: F401,F403
from .console import __all__ as _console_all
from .console import _await, _flush, read_line  # noqa: F401  (used by PyTerm itself)
from . import packages
from .packages import ainstall, require
from . import programs
from . import sso

__all__ = list(_console_all) + ["ainstall", "require", "console", "packages", "programs", "sso"]
__version__ = "2.0"
