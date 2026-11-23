# Files & Upload

Python in PyTerm has its own file system. Your home folder is `/home/pyodide` (also `~`), and that is the current directory when Python starts.

- [Where files live](#where-files-live)
- [The Upload dialog](#the-upload-dialog)
- [Archives (ZIP, tar)](#archives-zip-tar)
- [When a file already exists](#when-a-file-already-exists)
- [The saved /storage/browser folder](#the-saved-storagebrowser-folder)
- [Folders of your computer (/storage/local)](#folders-of-your-computer-storagelocal)
- [Getting files out](#getting-files-out)
- [Working with uploaded files](#working-with-uploaded-files)
- [Limits](#limits)

---

## Where files live

| Path | Stored in | Survives a reload? |
|---|---|---|
| `/storage/browser` (also `~/browser` and `~/storage/browser`) | IndexedDB in this browser | **Yes** |
| `/storage/local/<name>` | A folder of your computer, mounted with `pyterm.storage.mount(name)` | On the computer, yes; the mount itself lasts until reload |
| Anything else (`~/Upload`, `/tmp`, …) | Memory | No |

`/storage` holds the folders kept outside Python's memory. Two links in the home folder lead there:

| Link | Points to |
|---|---|
| `~/browser` | `/storage/browser` |
| `~/storage` | `/storage` |

So `open("browser/notes.txt")`, `open("storage/browser/notes.txt")` and `open("/storage/browser/notes.txt")` open the same file. `os.path.realpath("browser")` gives `/storage/browser`.

Files are private to this browser and this site. Nothing is uploaded to a server: "Upload" means copying from your computer *into Python*.

## The Upload dialog

Open it with the **Upload** toolbar button, **Ctrl/Cmd + U**, *File → Upload Files…* in Puter, or by dropping files on the window.

1. **Add files**: *Choose files*, *Choose folder* (keeps the folder structure), *Puter Drive* (inside Puter), or drop files and folders on the dashed area. Remove entries with ×. The list shows the total size; archives are tagged.
2. **Destination folder**: a path inside `/home/pyodide`, default `Upload`. Type a new one (sub-folders like `data/raw` are fine; `..` is removed) or click a recent one. `browser` (or `storage/browser`) saves the files permanently in `/storage/browser`.
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

### Uploading while code runs

Upload works at any time, also while a program or a long command is running. The files are written at once and the running code can open them straight away, so a program can, for example, wait in `input("File name? ")` while you upload the file it should read.

- The summary appears as a notice in the top-right corner instead of in the terminal, so it doesn't break into the program's output or full-screen display. It is printed in the terminal (without the folder tree) when the code finishes.
- Python receives the files whenever the code is waiting: `input()`, `time.sleep()`, `await …`, network requests. Code that computes without pausing receives them when it ends; the progress bar waits until then. (On cross-origin isolated hostings, where Python waits with shared memory, a blocking `input()` or `time.sleep()` also delays them; `await` doesn't.)
- Dropping one `.py` file while code runs queues it to run afterwards, as before. Dropping anything else opens the Upload dialog.

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

## The saved /storage/browser folder

`/storage/browser` is an IndexedDB-backed folder (Emscripten IDBFS), reached from the home folder through the `~/browser` link. It is:

- loaded when Python starts;
- saved after every command, upload and program step, while a program is waiting for input, and when the tab is hidden or closed;
- kept across **Restart** and across automatic restarts after **Stop**.

The status bar shows **~/browser saved** when it's active. If the browser blocks IndexedDB (some private modes), the folder still works but is not saved and the badge is hidden.

Clearing the site's data in the browser settings deletes it.

Earlier versions kept this folder directly at `/home/pyodide/browser`. On the first start of the new version, PyTerm moves those files into `/storage/browser` once (only if `/storage/browser` is still empty) and replaces the old folder with the link, so paths like `browser/todo.json` keep working.

```python
>>> open("browser/hello.txt", "w").write("still here tomorrow")
>>> # reload the page…
>>> open("browser/hello.txt").read()
'still here tomorrow'
```

## Folders of your computer (/storage/local)

Python can work directly on a folder of your computer:

```python
>>> from pyterm import storage
>>> m = storage.mount("photos")          # a dialog asks you to choose a folder
>>> m
<Mount 'photos' at /storage/local/photos ← folder 'Holiday 2024'>
>>> os.listdir("/storage/local/photos")
['beach.jpg', 'notes.txt']
>>> open("/storage/local/photos/notes.txt", "a").write("seen\n")   # saved to the computer
>>> storage.unmount("photos")
```

- The name is the folder under `/storage/local` (letters, digits, `.`, `_`, `-`).
- Python's changes (new, changed and deleted files) are written to the computer after every command, while a program waits for input, with `storage.save()` and when the folder is unmounted. Files added on the computer in the meantime are never deleted; `storage.refresh(name)` reads them.
- `storage.mounts()` lists the mounted folders. Mounts last until the page is reloaded or Python is hard-restarted; mount again afterwards.
- It needs a browser with the File System Access API (Chrome, Edge or Opera on a computer). Inside a frame of another site the browser may refuse the folder picker: open PyTerm in its own tab.
- The folder is copied into memory, so choose folders of reasonable size.

The full API is in [Custom Programs](custom-programs.md#folders-of-the-computer-pytermstorage).

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

- Files are held in memory (plus IndexedDB for `/storage/browser`). Uploads over **200 MB** show a warning; very large uploads can make the tab slow or crash it.
- Folder upload with *Choose folder* needs a Chromium, Firefox or Safari version that supports folder pickers; dropping folders works in all current browsers.
- Empty folders inside a dropped folder are not recreated (archives do recreate them).
- Files in `/storage/browser` count against the site's browser storage quota.
