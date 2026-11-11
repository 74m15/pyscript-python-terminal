// Upload dialog: copies files, folders and archives from your computer (or Puter Drive)
// into Python's file system, under /home/pyodide/<destination>.

const DEST_KEY = 'pyterm-upload-dests';
const BIG = 200 * 1024 * 1024;
const ARCHIVE_EXT = /\.(zip|tar|tgz|tbz2?|txz|tar\.gz|tar\.bz2|tar\.xz)$/i;
const ZIP_BASED = /\.(docx|xlsx|pptx|odt|ods|odp|jar|whl|apk|epub|xpi|nupkg|kmz)$/i;

const $ = (id) => document.getElementById(id);

export function human(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

function isArchiveBytes(buf, name) {
  if (ZIP_BASED.test(name)) return false;
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 300));
  const zip = b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
  const gz = b[0] === 0x1f && b[1] === 0x8b;
  const bz = b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68;
  const xz = b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58;
  const tar = b.length > 262 && String.fromCharCode(...b.slice(257, 262)) === 'ustar';
  if (zip || tar) return true;
  // compressed streams are only archives when they hold a tar
  if (gz || bz || xz) return ARCHIVE_EXT.test(name);
  return false;
}

function cleanDest(v) {
  let d = String(v || '').trim().replace(/\\/g, '/');
  d = d.replace(/^~\/?/, '').replace(/^\/home\/pyodide\/?/, '');
  d = d.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  return d || 'Upload';
}

async function readAllEntries(reader) {
  const all = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function walkEntry(entry, prefix, out) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    if (entry.name === '__MACOSX') return;
    const kids = await readAllEntries(entry.createReader());
    for (const k of kids) await walkEntry(k, prefix + entry.name + '/', out);
  }
}

/** Collect {file, path} items from a drop. Must be called synchronously inside the drop handler. */
export function collectDrop(dt) {
  const entries = [];
  if (dt.items) {
    for (const it of dt.items) {
      if (it.kind !== 'file') continue;
      const e = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (e) entries.push(e);
    }
  }
  const files = [...(dt.files || [])];
  return (async () => {
    const out = [];
    if (entries.length) {
      for (const e of entries) await walkEntry(e, '', out);
      if (out.length || entries.some((e) => e.isDirectory)) return { items: out, hasFolder: entries.some((e) => e.isDirectory) };
    }
    return { items: files.map((f) => ({ file: f, path: f.name })), hasFolder: false };
  })();
}

export function createUploader({ engine, inPuter, P, log, isReady, onOpen, onClose }) {
  const dlg = $('upload');
  let items = [];
  let running = false;
  let cancelled = false;

  const recent = () => { try { return JSON.parse(sessionStorage.getItem(DEST_KEY) || '[]'); } catch { return []; } };
  function remember(d) {
    const list = [d, ...recent().filter((x) => x !== d)].slice(0, 6);
    try { sessionStorage.setItem(DEST_KEY, JSON.stringify(list)); } catch {}
  }

  function renderRecent() {
    const box = $('up-recent');
    box.innerHTML = '';
    const list = recent();
    if (!list.includes('Upload')) list.push('Upload');
    if (!list.includes('browser')) list.push('browser');
    for (const d of list.slice(0, 7)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = '~/' + d;
      b.title = d === 'browser' ? 'Saved in this browser — survives reloads' : '/home/pyodide/' + d;
      b.onclick = () => { $('up-dest').value = d; updateWarn(); };
      box.appendChild(b);
    }
  }

  function updateWarn() {
    const total = items.reduce((s, i) => s + i.file.size, 0);
    const w = $('up-warn');
    const msgs = [];
    if (total > BIG) msgs.push(`That's ${human(total)}. Python keeps files in memory, so very large uploads can slow down or crash the tab.`);
    if (cleanDest($('up-dest').value).split('/')[0] === 'browser') msgs.push('Files in ~/browser are saved in this browser and are still there after a reload.');
    w.textContent = msgs.join(' ');
    w.classList.toggle('hidden', !msgs.length);
    w.classList.toggle('text-amber-300', total > BIG);
    w.classList.toggle('text-slate-400', total <= BIG);
  }

  function renderList() {
    const list = $('up-list');
    list.innerHTML = '';
    $('up-empty').classList.toggle('hidden', items.length > 0);
    list.classList.toggle('hidden', !items.length);
    const total = items.reduce((s, i) => s + i.file.size, 0);
    $('up-count').textContent = items.length
      ? `${items.length} file${items.length === 1 ? '' : 's'} · ${human(total)}`
      : '';
    items.slice(0, 200).forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'up-row';
      const arch = ARCHIVE_EXT.test(it.path) && !ZIP_BASED.test(it.path);
      row.innerHTML = `<span class="truncate flex-1 mono"></span><span class="tag ${arch ? '' : 'hidden'}">archive</span><span class="text-slate-500 shrink-0"></span><button type="button" class="x" title="Remove">×</button>`;
      row.children[0].textContent = it.path;
      row.children[2].textContent = human(it.file.size);
      row.children[3].onclick = () => { items.splice(idx, 1); renderList(); };
      list.appendChild(row);
    });
    if (items.length > 200) {
      const more = document.createElement('div');
      more.className = 'up-row text-slate-500';
      more.textContent = `… and ${items.length - 200} more`;
      list.appendChild(more);
    }
    $('up-start').disabled = !items.length || running;
    updateWarn();
  }

  function add(newItems) {
    const seen = new Set(items.map((i) => i.path));
    for (const it of newItems) {
      if (it.path.split('/').some((p) => p === '__MACOSX' || p === '.DS_Store')) continue;
      if (seen.has(it.path)) items = items.filter((x) => x.path !== it.path);
      items.push(it);
      seen.add(it.path);
    }
    renderList();
  }

  function setProgress(frac, text) {
    $('up-progress').classList.remove('hidden');
    $('up-bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    if (text != null) $('up-progress-text').textContent = text;
  }

  function open(initial = []) {
    if (!running) {
      items = [];
      $('up-progress').classList.add('hidden');
      $('up-bar').style.width = '0%';
    }
    renderRecent();
    add(initial);
    $('up-drive-btn').classList.toggle('hidden', !inPuter);
    dlg.classList.remove('hidden');
    dlg.classList.add('flex');
    onOpen && onOpen();
    setTimeout(() => (items.length ? $('up-start') : $('up-files-btn')).focus(), 0);
  }

  function close() {
    if (running) { cancelled = true; return; }
    dlg.classList.add('hidden');
    dlg.classList.remove('flex');
    onClose && onClose();
  }

  async function start() {
    if (running || !items.length) return;
    if (!isReady()) { $('up-progress-text').textContent = 'Python is still starting — try again in a moment.'; $('up-progress').classList.remove('hidden'); return; }
    running = true;
    cancelled = false;
    $('up-start').disabled = true;
    $('up-cancel').textContent = 'Cancel';
    const dest = cleanDest($('up-dest').value);
    $('up-dest').value = dest;
    const policy = $('up-policy').value;
    const extract = $('up-extract').checked;
    const subfolder = $('up-subfolder').checked;
    const queue = items.slice();
    const total = queue.reduce((s, i) => s + i.file.size, 0) || 1;
    let done = 0;
    const r = { files: 0, archives: 0, extracted: 0, skipped: 0, renamed: 0, blocked: 0, errors: [] };
    setProgress(0, 'Waiting for Python…');
    for (let i = 0; i < queue.length; i++) {
      if (cancelled) break;
      const it = queue[i];
      setProgress(done / total, `${i + 1} / ${queue.length} · ${it.path}`);
      try {
        const buf = await it.file.arrayBuffer();
        const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '';
        let handled = false;
        if (extract && isArchiveBytes(buf, it.file.name)) {
          try {
            const copy = buf.slice(0);
            const res = await engine.call('extract', {
              name: it.file.name, data: copy, dest: dir ? `${dest}/${dir}` : dest, policy, subfolder,
            }, [copy]);
            r.archives++;
            r.extracted += res.files;
            r.skipped += res.skipped;
            r.renamed += res.renamed;
            r.blocked += res.blocked;
            handled = true;
          } catch (e) {
            if (!/archive|tar|zip|read/i.test(String(e.message))) throw e;
          }
        }
        if (!handled) {
          const res = await engine.call('save', { path: `${dest}/${it.path}`, data: buf, policy }, [buf]);
          if (res == null) r.skipped++;
          else {
            r.files++;
            const base = String(res).split('/').pop();
            if (base !== it.path.split('/').pop()) r.renamed++;
          }
        }
      } catch (e) {
        r.errors.push(`${it.path}: ${e && e.message || e}`);
        if (/stopped|not running/i.test(String(e && e.message))) break;
      }
      done += it.file.size;
      setProgress(done / total);
    }
    remember(dest);
    running = false;
    const parts = [];
    if (r.files) parts.push(`${r.files} file${r.files === 1 ? '' : 's'}`);
    if (r.archives) parts.push(`${r.archives} archive${r.archives === 1 ? '' : 's'} extracted (${r.extracted} file${r.extracted === 1 ? '' : 's'})`);
    let msg = `⬆ Uploaded ${parts.join(' and ') || 'nothing'} to ~/${dest}`;
    const extra = [];
    if (r.renamed) extra.push(`${r.renamed} renamed to avoid overwriting`);
    if (r.skipped) extra.push(`${r.skipped} skipped (already there)`);
    if (r.blocked) extra.push(`${r.blocked} unsafe archive entr${r.blocked === 1 ? 'y' : 'ies'} ignored`);
    if (cancelled) extra.push('cancelled');
    if (extra.length) msg += ` — ${extra.join(', ')}`;
    log(msg + '\n', 'info');
    for (const e of r.errors.slice(0, 10)) log(`  ✗ ${e}\n`, 'err');
    if (r.files || r.extracted) {
      try { await engine.call('tree', { path: dest, limit: 40 }); } catch {}
      if (dest.split('/')[0] !== 'browser') log(`Open them in Python with paths like open("${dest}/…"). Use ~/browser to keep files after a reload.\n`, 'info');
      try { await engine.call('sync'); } catch {}
    }
    items = [];
    $('up-start').disabled = false;
    close();
  }

  // wiring
  $('up-close').onclick = close;
  $('up-cancel').onclick = close;
  $('up-start').onclick = start;
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  $('up-dest').addEventListener('input', updateWarn);
  $('up-dest').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } });
  $('up-files-btn').onclick = () => $('multi-input').click();
  $('up-folder-btn').onclick = () => $('folder-input').click();
  $('multi-input').addEventListener('change', (e) => {
    add([...e.target.files].map((f) => ({ file: f, path: f.name })));
    e.target.value = '';
  });
  $('folder-input').addEventListener('change', (e) => {
    add([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    e.target.value = '';
  });
  $('up-drive-btn').onclick = async () => {
    try {
      const picked = await P.ui.showOpenFilePicker({ multiple: true }).undefinedOnCancel;
      if (!picked) return;
      const list = Array.isArray(picked) ? picked : [picked];
      const got = [];
      for (const item of list) {
        if (item.isDir) continue;
        const blob = await item.read();
        got.push({ file: new File([blob], item.name), path: item.name });
      }
      add(got);
    } catch (e) {
      log(`Could not read from Puter Drive: ${e && e.message || e}\n`, 'err');
    }
  };
  const zone = $('up-drop');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    const { items: got } = await collectDrop(e.dataTransfer);
    add(got);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dlg.classList.contains('hidden')) close();
  });

  return { open, close, add, isOpen: () => !dlg.classList.contains('hidden'), isRunning: () => running };
}
