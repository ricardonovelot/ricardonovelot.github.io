// Hidden in-place editor, v2: text editing plus block operations.
// Open with Cmd/Ctrl+Shift+E (or add ?edit to the URL).
//
// Blocks (sections, figures, image rows, diagrams, work list rows) get
// hover controls: move up, move down, add text section, add image,
// add paragraph, delete. Saving commits the whole page body to the repo
// through the GitHub API, so structural changes persist.
//
// Auth: first use on a browser asks for a GitHub fine-grained token
// (Contents read/write on this repo only) and a password. The token is
// AES-GCM encrypted with the password and kept in localStorage. Nothing
// secret is ever in the repo. On localhost the editor opens without auth
// for layout testing, but saving is disabled.
(function () {
  var REPO = 'ricardonovelot/ricardonovelot.github.io';
  var LS_KEY = 'rln.editor.v1';
  var token = null;
  var editing = false;
  var dirty = false;
  var baseSha = null; // repo version this edit session started from

  function currentFile() {
    var p = location.pathname.replace(/^\//, '');
    return p === '' ? 'index.html' : p;
  }

  // ---------- crypto (PBKDF2 -> AES-GCM) ----------
  function bufToB64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function b64ToBuf(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }
  function deriveKey(password, salt) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 150000, hash: 'SHA-256' },
          km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function encryptToken(tok, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(tok));
    }).then(function (ct) {
      localStorage.setItem(LS_KEY, JSON.stringify({ s: bufToB64(salt), i: bufToB64(iv), c: bufToB64(ct) }));
    });
  }
  function decryptToken(password) {
    var blob = JSON.parse(localStorage.getItem(LS_KEY));
    return deriveKey(password, new Uint8Array(b64ToBuf(blob.s))).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(blob.i)) }, key, b64ToBuf(blob.c));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }

  // ---------- unlock ----------
  function trigger() {
    if (editing) return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      enterEditMode(); // layout testing without auth; save disabled
      return;
    }
    if (token) { enterEditMode(); return; } // already unlocked this session
    if (localStorage.getItem(LS_KEY)) {
      var pw = prompt('Editor password:');
      if (!pw) return;
      decryptToken(pw).then(function (tok) { token = tok; enterEditMode(); })
        .catch(function () { alert('Wrong password.'); });
    } else {
      var tok = prompt('First time on this browser.\nPaste a GitHub fine-grained token for ' + REPO + '\n(Settings > Developer settings > Fine-grained tokens; only this repo; Contents: Read and write):');
      if (!tok) return;
      var pw1 = prompt('Choose an editor password for this browser:');
      if (!pw1) return;
      var pw2 = prompt('Repeat the password:');
      if (pw1 !== pw2) { alert('Passwords do not match.'); return; }
      encryptToken(tok.trim(), pw1).then(function () { token = tok.trim(); enterEditMode(); });
    }
  }

  // ---------- edit mode ----------
  function enterEditMode() {
    editing = true;
    hydrateFromSource().then(function (sha) {
      baseSha = sha;
      // Content swapped in after load never gets the reveal observer, so
      // show everything plainly while editing.
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
      splitProse();
      markEditable();
      addControls();
      injectChrome();
      suppressLinks();
      document.documentElement.classList.add('rln-edit-on');
    }).catch(function (e) {
      editing = false;
      alert('Could not load the latest version of this page: ' + e.message);
    });
  }

  // The page the browser shows can lag the repo by minutes (GitHub Pages and
  // its CDN cache). Editing that stale copy and saving would overwrite newer
  // saves, so edit mode always starts from the repo's current version.
  function hydrateFromSource() {
    var file = currentFile();
    var fetched;
    if (token) {
      var api = 'https://api.github.com/repos/' + REPO + '/contents/' + file;
      fetched = fetch(api, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' } })
        .then(function (r) { if (!r.ok) throw new Error('GitHub API: ' + r.status); return r.json(); })
        .then(function (data) {
          var src = new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\n/g, '')), function (c) { return c.charCodeAt(0); }));
          return { src: src, sha: data.sha };
        });
    } else {
      fetched = fetch(file + '?nocache=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (src) { return { src: src, sha: null }; });
    }
    return fetched.then(function (res) {
      var doc = new DOMParser().parseFromString(res.src, 'text/html');
      var m = doc.querySelector('main');
      var f = doc.querySelector('.site-foot');
      if (m && document.querySelector('main')) document.querySelector('main').innerHTML = m.innerHTML;
      if (f && document.querySelector('.site-foot')) document.querySelector('.site-foot').innerHTML = f.innerHTML;
      document.querySelectorAll('[contenteditable]').forEach(function (el) { el.removeAttribute('contenteditable'); });
      return res.sha;
    });
  }

  // Leave edit mode without reloading: a reload would show the stale cached
  // page and make a just-saved edit look lost.
  function exitEditModeInPlace() {
    document.querySelectorAll('.rln-ctl, .rln-bar').forEach(function (n) { n.remove(); });
    document.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });
    document.querySelectorAll('.rln-block').forEach(function (n) { n.classList.remove('rln-block', 'rln-flash'); });
    document.documentElement.classList.remove('rln-edit-on');
    editing = false;
    dirty = false;
    baseSha = null;
  }

  // While editing, links must not navigate: the work list titles live inside
  // <a> wrappers, so a click to place the caret would otherwise leave the page.
  // Cmd/Ctrl+click still opens a link, for checking where it goes.
  function suppressLinks() {
    document.addEventListener('click', function (e) {
      if (!editing) return;
      if (e.target.closest('.rln-ctl') || e.target.closest('.rln-bar')) return;
      var a = e.target.closest('a');
      if (a && !e.metaKey && !e.ctrlKey) e.preventDefault();
    }, true);
  }

  // Split each big .prose container into one .prose.sec per h2 group, so
  // sections become independent, movable blocks.
  function splitProse() {
    document.querySelectorAll('main .prose:not(.sec)').forEach(function (pr) {
      var groups = [], cur = null;
      Array.from(pr.children).forEach(function (ch) {
        if (ch.tagName === 'H2' || cur === null) { cur = []; groups.push(cur); }
        cur.push(ch);
      });
      if (groups.length <= 1) { pr.classList.add('sec'); return; }
      groups.forEach(function (g) {
        var d = document.createElement('div');
        d.className = 'prose sec';
        g.forEach(function (n) { d.appendChild(n); });
        pr.parentNode.insertBefore(d, pr);
      });
      pr.remove();
    });
  }

  var TEXT_SEL = 'main h1, main h2, main h3, main p, main li, main dd, main dt, main figcaption, .site-foot h2, .site-foot .smallprint';
  function markEditable() {
    document.querySelectorAll(TEXT_SEL).forEach(function (el) {
      if (el.closest('.rln-ctl') || el.closest('.rln-bar')) return;
      if (el.getAttribute('contenteditable') === 'true') return;
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('input', function () { dirty = true; });
      // Paste plain text only. Pasting from a browser or a doc otherwise drags
      // in fonts and hardcoded colors (white text that vanishes in light mode).
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    });
  }

  var BLOCK_SEL = 'main > .prose.sec, main > figure.media, main > .mediarow, main > .diagram, main > section, main .worklist > .workrow';
  var SKIP_SEL = '.case-hero, .meta, .next';
  function blocks() {
    return Array.from(document.querySelectorAll(BLOCK_SEL)).filter(function (b) {
      return !b.matches(SKIP_SEL);
    });
  }

  function addControls() {
    blocks().forEach(function (b) {
      if (b.querySelector(':scope > .rln-ctl')) return;
      b.classList.add('rln-block');
      var isRow = b.matches('.workrow');
      var isProse = b.matches('.prose.sec');
      var c = document.createElement('div');
      c.className = 'rln-ctl';
      c.setAttribute('contenteditable', 'false');
      var btns = [
        ['up', '↑', 'Move up'],
        ['down', '↓', 'Move down'],
      ];
      if (!isRow) {
        btns.push(['addtext', 'T+', 'Add a text section below']);
        btns.push(['addimg', '▣+', 'Add an image below']);
      }
      if (isProse) btns.push(['addpara', '¶+', 'Add a paragraph to this section']);
      btns.push(['del', '✕', 'Delete this block']);
      c.innerHTML = btns.map(function (x) {
        return '<button type="button" data-act="' + x[0] + '" title="' + x[2] + '">' + x[1] + '</button>';
      }).join('');
      c.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (btn) doAction(btn.getAttribute('data-act'), b);
      });
      b.appendChild(c);
    });
    addFigureControls();
  }

  // Each image inside a photo row gets its own controls, so a single column
  // can be removed or reordered without touching the rest of the row.
  function addFigureControls() {
    document.querySelectorAll('main .mediarow > figure.media').forEach(function (f) {
      if (f.querySelector(':scope > .rln-ctl')) return;
      f.classList.add('rln-block');
      var c = document.createElement('div');
      c.className = 'rln-ctl in';
      c.setAttribute('contenteditable', 'false');
      c.innerHTML = '<button type="button" data-fact="left" title="Move left">&larr;</button>' +
        '<button type="button" data-fact="right" title="Move right">&rarr;</button>' +
        '<button type="button" data-fact="del" title="Remove this image">&#10005;</button>';
      c.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        figAction(btn.getAttribute('data-fact'), f);
      });
      f.appendChild(c);
    });
  }

  // Keep the row's column count honest after removals: 3+ images use the
  // default grid, 2 get .two, 1 gets .one, 0 removes the row itself.
  function normalizeRow(row) {
    var figs = row.querySelectorAll(':scope > figure.media');
    row.classList.remove('one', 'two', 'four');
    if (figs.length === 0) { row.remove(); return; }
    if (figs.length === 1) row.classList.add('one');
    else if (figs.length === 2) row.classList.add('two');
    else if (figs.length >= 4) row.classList.add('four');
  }

  function figAction(act, f) {
    var row = f.parentElement;
    if (act === 'del') {
      if (!confirm('Remove this image? (Save afterwards to make it permanent)')) return;
      f.remove(); normalizeRow(row); dirty = true;
    } else if (act === 'left') {
      var prev = f.previousElementSibling;
      while (prev && !prev.matches('figure.media')) prev = prev.previousElementSibling;
      if (prev) { row.insertBefore(f, prev); dirty = true; flash(f); }
    } else if (act === 'right') {
      var next = f.nextElementSibling;
      while (next && !next.matches('figure.media')) next = next.nextElementSibling;
      if (next) { row.insertBefore(next, f); dirty = true; flash(f); }
    }
  }

  function siblingBlock(b, dir) {
    var n = dir < 0 ? b.previousElementSibling : b.nextElementSibling;
    while (n && !n.classList.contains('rln-block')) {
      n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
    }
    return n;
  }

  function doAction(act, b) {
    if (act === 'up') {
      var prev = siblingBlock(b, -1);
      if (prev) { b.parentNode.insertBefore(b, prev); flash(b); dirty = true; }
    } else if (act === 'down') {
      var next = siblingBlock(b, 1);
      if (next) { b.parentNode.insertBefore(next, b); flash(b); dirty = true; }
    } else if (act === 'del') {
      if (confirm('Delete this block? (Save afterwards to make it permanent)')) { b.remove(); dirty = true; }
    } else if (act === 'addpara') {
      var p = document.createElement('p');
      p.textContent = 'New paragraph.';
      b.insertBefore(p, b.querySelector(':scope > .rln-ctl'));
      dirty = true; markEditable(); p.focus();
    } else if (act === 'addtext') {
      var sec = document.createElement('div');
      sec.className = 'prose sec';
      sec.innerHTML = '<h2>New section</h2><p>New paragraph.</p>';
      var node = sec;
      if (b.tagName === 'SECTION') {
        node = document.createElement('section');
        node.className = 'shell';
        node.appendChild(sec);
      }
      b.parentNode.insertBefore(node, b.nextSibling);
      dirty = true; markEditable(); addControls(); flash(sec);
    } else if (act === 'addimg') {
      var url = prompt('Image URL (upload the file to the repo first, or paste any public image URL):');
      if (!url) return;
      var alt = prompt('Describe the image (alt text):') || '';
      var fig = document.createElement('figure');
      fig.className = 'media board';
      fig.innerHTML = '<img src="' + url.replace(/"/g, '&quot;') + '" alt="' + alt.replace(/"/g, '&quot;') + '" loading="lazy">';
      b.parentNode.insertBefore(fig, b.nextSibling);
      dirty = true; addControls(); flash(fig);
    }
  }

  function flash(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('rln-flash');
    setTimeout(function () { el.classList.remove('rln-flash'); }, 700);
  }

  function injectChrome() {
    var bar = document.createElement('div');
    bar.className = 'rln-bar';
    bar.innerHTML = '<span>Edit mode' + (token ? '' : ' (local test, saving disabled)') + '</span>' +
      '<button id="rln-save">Save to site</button><button id="rln-exit">Exit</button>';
    document.body.appendChild(bar);
    document.getElementById('rln-save').onclick = save;
    document.getElementById('rln-exit').onclick = function () {
      if (!dirty || confirm('Discard unsaved changes?')) location.reload();
    };
    if (document.getElementById('rln-style')) return;
    var st = document.createElement('style');
    st.id = 'rln-style';
    st.textContent =
      '.rln-edit-on [contenteditable="true"]{outline:1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent);outline-offset:4px;border-radius:4px;min-height:1em}' +
      '.rln-edit-on [contenteditable="true"]:focus{outline-style:solid;outline-color:var(--accent)}' +
      '.rln-block{position:relative}' +
      '.rln-ctl{position:absolute;top:-14px;right:0;display:none;gap:4px;z-index:60}' +
      '.rln-ctl.in{top:8px;right:8px}' +
      '.rln-block:hover > .rln-ctl{display:flex}' +
      '.rln-ctl button{font:600 12px/1 Inter,system-ui,sans-serif;background:var(--ink);color:var(--bg);border:0;border-radius:7px;padding:6px 9px;cursor:pointer;opacity:.92}' +
      '.rln-ctl button:hover{background:var(--accent);color:#fff;opacity:1}' +
      '.rln-flash{outline:2px solid var(--accent);outline-offset:6px;border-radius:8px}' +
      '.rln-bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:12px;align-items:center;background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;z-index:99;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}' +
      '.rln-bar button{font:inherit;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;background:var(--accent);color:#fff}' +
      '.rln-bar #rln-exit{background:transparent;color:var(--bg);text-decoration:underline}';
    document.head.appendChild(st);
  }

  // ---------- save: persist main + footer wholesale ----------
  function cleanClone(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.rln-ctl, .rln-bar').forEach(function (n) { n.remove(); });
    // Editor state must never reach the published file: a persisted
    // contenteditable would let any visitor type into the page.
    clone.removeAttribute('contenteditable');
    clone.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });
    clone.querySelectorAll('.rln-block').forEach(function (n) { n.classList.remove('rln-block', 'rln-flash'); });
    clone.querySelectorAll('.reveal.in').forEach(function (n) { n.classList.remove('in'); });
    clone.querySelectorAll('[style=""], [class=""]').forEach(function (n) {
      if (!n.getAttribute('style')) n.removeAttribute('style');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    // Drop anything that was emptied out: paragraphs, headings, list items,
    // then lists and sections left with nothing in them.
    clone.querySelectorAll('p, h1, h2, h3, li, dd, dt').forEach(function (n) {
      if (!n.textContent.trim() && !n.querySelector('img,video,a')) n.remove();
    });
    clone.querySelectorAll('ul, ol').forEach(function (l) {
      if (!l.children.length) l.remove();
    });
    clone.querySelectorAll('.mediarow').forEach(function (r) {
      if (!r.querySelector('figure')) r.remove();
    });
    clone.querySelectorAll('.prose.sec').forEach(function (s) {
      if (!s.textContent.trim() && !s.querySelector('img,video')) s.remove();
    });
    return clone;
  }

  function save() {
    if (!token) { alert('Local test mode: saving is disabled here. Use the live site.'); return; }
    if (!dirty) { alert('No changes to save.'); return; }
    var file = currentFile();
    var api = 'https://api.github.com/repos/' + REPO + '/contents/' + file;
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    fetch(api, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('GitHub API: ' + r.status);
      return r.json();
    }).then(function (data) {
      if (baseSha && data.sha !== baseSha) {
        if (!confirm('This page was saved from somewhere else (another tab or device) after you started editing here. Saving now will overwrite that version. Continue?')) {
          throw new Error('__cancelled__');
        }
      }
      var src = new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\n/g, '')), function (c) { return c.charCodeAt(0); }));
      var doc = new DOMParser().parseFromString(src, 'text/html');
      var liveMain = document.querySelector('main');
      var liveFoot = document.querySelector('.site-foot');
      if (liveMain && doc.querySelector('main')) doc.querySelector('main').innerHTML = cleanClone(liveMain).innerHTML;
      if (liveFoot && doc.querySelector('.site-foot')) doc.querySelector('.site-foot').innerHTML = cleanClone(liveFoot).innerHTML;
      // Last line of defence before anything is written to the repo.
      doc.querySelectorAll('[contenteditable], .rln-ctl, .rln-bar, .rln-block').forEach(function (n) {
        if (n.classList.contains('rln-ctl') || n.classList.contains('rln-bar')) { n.remove(); return; }
        n.removeAttribute('contenteditable');
        n.classList.remove('rln-block', 'rln-flash');
        if (!n.getAttribute('class')) n.removeAttribute('class');
      });
      var out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML + '\n';
      if (out.indexOf('contenteditable') !== -1) {
        throw new Error('internal: editor state leaked into the page; save aborted');
      }
      var b64 = btoa(Array.from(new TextEncoder().encode(out), function (b) { return String.fromCharCode(b); }).join(''));
      return fetch(api, {
        method: 'PUT', headers: headers,
        body: JSON.stringify({ message: 'Edit ' + file + ' via site editor', content: b64, sha: data.sha }),
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('GitHub API: ' + r.status);
      exitEditModeInPlace();
      alert('Saved. What you see now is your saved version. The public page catches up in a minute or two, so do not worry if a refresh briefly shows the old text.\nTo keep editing, just press Cmd+Shift+E again.');
    }).catch(function (e) {
      if (e.message === '__cancelled__') return;
      alert('Save failed: ' + e.message + '\nIf this keeps happening, the token may be wrong or expired. Reset it: localStorage.removeItem("' + LS_KEY + '") in the console, then set up again.');
    });
  }

  // ---------- triggers ----------
  addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      trigger();
    }
  });
  if (new URLSearchParams(location.search).has('edit')) trigger();
})();
