"""Banner maker — big ASCII-art text with pyfiglet.

pyfiglet is not part of Pyodide: it comes from PyPI. This program lists it under
"requires" in programs/index.json, so PyTerm installs it with micropip (showing the
progress) before the program starts. Here it can simply be imported.
"""
import shutil

import pyfiglet

import pyterm

state = {"font": "standard", "color": "cyan"}
PALETTE = ["cyan", "green", "yellow", "magenta", "blue", "red", "white"]
FONTS = sorted(pyfiglet.FigletFont.getFonts())

app = pyterm.App("banner", intro=pyterm.style("Type some text to turn it into a banner. ", "grey")
                 + pyterm.style("help", "cyan") + pyterm.style(" lists the commands.", "grey"))


def render(text):
    width = shutil.get_terminal_size((80, 24)).columns
    art = pyfiglet.figlet_format(text, font=state["font"], width=width)
    return pyterm.style(art.rstrip("\n"), state["color"])


@app.default
def banner(line):
    return render(line)


@app.command
def font(name=None):
    "Show or change the font (a unique prefix is enough)"
    if name is None:
        return f"Current font: {state['font']}  ({len(FONTS)} fonts, see: fonts)"
    if name not in FONTS:
        matches = [f for f in FONTS if f.startswith(name)]
        if len(matches) != 1:
            return pyterm.style(f"No font {name!r}. Try: fonts {name}", "yellow")
        name = matches[0]
    state["font"] = name
    return render(name)


@app.command
def fonts(prefix=""):
    "List the fonts (optionally only those starting with a prefix)"
    names = [f for f in FONTS if f.startswith(prefix)]
    width = shutil.get_terminal_size((80, 24)).columns
    col = max(len(n) for n in names) + 2 if names else 10
    per = max(1, width // col)
    for i in range(0, len(names), per):
        print("".join(n.ljust(col) for n in names[i:i + per]))
    return pyterm.style(f"{len(names)} fonts", "grey")


@app.command
def color(name=None):
    "Change the colour (cyan, green, yellow, magenta, blue, red, white)"
    if name not in PALETTE:
        return "Colours: " + ", ".join(pyterm.style(c, c) for c in PALETTE)
    state["color"] = name


@app.command
def sample(*words):
    "Show the same text in a few random fonts"
    import random

    text = " ".join(words) or "PyTerm"
    for f in random.sample(FONTS, 4):
        print(pyterm.style(f"── {f}", "grey"))
        print(pyterm.style(pyfiglet.figlet_format(text, font=f).rstrip("\n"), state["color"]))


@app.command
def save(*words):
    "Save the banner of some text to ~/browser/banner.txt and download it"
    text = " ".join(words) or "PyTerm"
    path = pyterm.BROWSER_DIR + "/banner.txt"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(pyfiglet.figlet_format(text, font=state["font"]))
    pyterm.download(path)


print(render("Banner"))
app.run()
