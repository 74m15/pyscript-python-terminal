# Files & Upload

Python in PyTerm has its own file system. Your home folder is `/home/pyodide` (also `~`), and that is the current directory when Python starts.

- [Where files live](#where-files-live)
- [The Upload dialog](#the-upload-dialog)
- [Archives (ZIP, tar)](#archives-zip-tar)
- [When a file already exists](#when-a-file-already-exists)
- [The saved ~/browser folder](#the-saved-browser-folder)
- [Getting files out](#getting-files-out)
- [Working with uploaded files](#working-with-uploaded-files)
- [Limits](#limits)

---

## Where files live

| Path | Stored in | Survives a reload? |
|---|---|---|
| `/home/pyodide/browser` (`~/browser`) | IndexedDB in this browser | **Yes** |
| Anything else (`~/Upload`, `/tmp`, …) | Memory | No |

Files are private to this browser and this site. Nothing is uploaded to a server: "Upload" means copying from your computer *into Python*.

## The Upload dialog

Open it with the **Upload** toolbar button, **Ctrl/Cmd + U**, *File → Upload Files…* in Puter, or by dropping files on the window.

1. **Add files**: *Choose files*, *Choose folder* (keeps the folder structure), *Puter Drive* (inside Puter), or drop files and folders on the dashed area. Remove entries with ×. The list shows the total size; archives are tagged.
2. **Destination folder**: a path inside `/home/pyodide`, default `Upload`. Type a new one (sub-folders like `data/raw` are fine; `..` is removed) or click a recent one. `browser` saves the files permanently.
3. **If a file already exists**: keep both, replace, or skip (see below).
4. **Extract archives** (on by default) and **Into a folder named after each archive** (off by default).
5. **Upload**. A progress bar shows each file. Cancel stops after the current file.

When it's done the terminal shows a summary and the folder tree:

```
⬆ Uploaded 3 files and 1 archive extracted (12 files) to ~/Upload — 1 renamed to avoid overwriting
/home/pyodide/Upload
├── images/
│   ├── cat.png 84.2 KB
│   └── dog.png 91.0 KB
├── data.csv 2.1 KB
└── notes.txt 120 B
```

### Drag & drop shortcut

Dropping **one `.py` file** anywhere runs it (as before). Dropping anything else — several files, a folder, an archive, data files — opens the Upload dialog with those items.

## Archives (ZIP, tar)

With *Extract archives* on, these are unpacked instead of copied:

| Format | Detected by |
|---|---|
| ZIP (`.zip`) | `PK` signature |
| tar (`.tar`) | `ustar` header |
| gzip / bzip2 / xz tar (`.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`) | Compression signature + tar extension |

Files that are ZIPs inside but aren't meant to be unpacked (`.docx`, `.xlsx`, `.pptx`, `.odt`, `.jar`, `.whl`, `.epub`, `.apk`…) are copied as they are.

Safety rules:

- Entries with absolute paths or `..` are refused (no writing outside the destination).
- Symbolic links, hard links and device files in tar archives are never created.
- `__MACOSX/` folders and `.DS_Store` files are skipped.
- ZIP names that aren't marked UTF-8 are decoded as CP437 (Windows / old macOS archives) when possible.

The summary counts *unsafe archive entries ignored*.

With **Into a folder named after each archive**, `photos.zip` is extracted into `~/Upload/photos/` (or `photos (1)` if that exists and *Keep both* is selected).

## When a file already exists

| Option | Behaviour |
|---|---|
| **Keep both (rename)** *(default)* | The new file gets a free name: `data (1).csv`, `data (2).csv`… (`archive (1).tar.gz` keeps its double extension) |
| **Replace it** | The existing file is overwritten |
| **Skip it** | The existing file stays; the new one is not written |

The rule applies to files inside archives too.

## The saved ~/browser folder

`/home/pyodide/browser` is an IndexedDB-backed folder (Emscripten IDBFS). It is:

- loaded when Python starts;
- saved after every command, upload and program step, while a program is waiting for input, and when the tab is hidden or closed;
- kept across **Restart** and across automatic restarts after **Stop**.

The status bar shows **~/browser saved** when it's active. If the browser blocks IndexedDB (some private modes), the folder still works but is not saved and the badge is hidden.

Clearing the site's data in the browser settings deletes it.

```python
>>> open("browser/hello.txt", "w").write("still here tomorrow")
>>> # reload the page…
>>> open("browser/hello.txt").read()
'still here tomorrow'
```

## Getting files out

```python
>>> download("Upload/result.csv")          # one file
>>> download("browser")                    # a whole folder, as browser.zip
>>> download("report.txt", name="final.txt")
```

Outside Puter the browser downloads the file. Inside Puter a **Save** dialog lets you put it on your Drive. `pyterm.download()` is the same function, for use inside programs.

## Working with uploaded files

```python
>>> import os
>>> os.listdir("Upload")
['data.csv', 'images', 'notes.txt']
>>> import csv
>>> rows = list(csv.DictReader(open("Upload/data.csv")))
>>> import pandas as pd            # loaded automatically on import
>>> pd.read_csv("Upload/data.csv").describe()
>>> run("Upload/tool.py", "--help")   # run an uploaded script as a program
```

Relative paths start at `/home/pyodide`, so `"Upload/data.csv"` and `"~/Upload/data.csv"` (with `os.path.expanduser`) mean the same file.

## Limits

- Files are held in memory (plus IndexedDB for `~/browser`). Uploads over **200 MB** show a warning; very large uploads can make the tab slow or crash it.
- Folder upload with *Choose folder* needs a Chromium, Firefox or Safari version that supports folder pickers; dropping folders works in all current browsers.
- Empty folders inside a dropped folder are not recreated (archives do recreate them).
- Files in `~/browser` count against the site's browser storage quota.
