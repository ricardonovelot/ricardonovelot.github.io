// Hidden in-place editor.
// Open with Cmd/Ctrl+Shift+E (or add ?edit to the URL).
// First use on a browser: asks for a GitHub fine-grained token (contents
// read/write on this repo only) and a password of your choice. The token is
// AES-GCM encrypted with that password and kept in THIS browser's
// localStorage. Later sessions only ask for the password.
// Saving commits the edited page to the repo through the GitHub API.
(function () {
  var REPO = 'ricardonovelot/ricardonovelot.github.io';
  var LS_KEY = 'rln.editor.v1';
  var token = null;
  var editing = false;
  var edited = new Map(); // element -> original innerHTML

  function currentFile() {
    var p = location.pathname.replace(/^\//, '');
    return p === '' ? 'index.html' : p;
  }

  // ---- crypto helpers (PBKDF2 -> AES-GCM) ----
  function bufToB64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
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

  // ---- unlock flow ----
  function unlock() {
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

  // ---- edit mode ----
  var EDITABLE = 'main h1, main h2, main h3, main p, main li, main dd, main dt, .site-foot h2, .site-foot .smallprint';

  function enterEditMode() {
    if (editing) return;
    editing = true;
    document.querySelectorAll(EDITABLE).forEach(function (el) {
      if (el.closest('.rln-bar')) return;
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('input', function () {
        if (!edited.has(el)) edited.set(el, true);
        el.classList.add('rln-dirty');
      });
    });
    document.documentElement.classList.add('rln-edit-on');
    var bar = document.createElement('div');
    bar.className = 'rln-bar';
    bar.innerHTML = '<span>Edit mode</span><button id="rln-save">Save to site</button><button id="rln-exit">Exit</button>';
    document.body.appendChild(bar);
    document.getElementById('rln-save').onclick = save;
    document.getElementById('rln-exit').onclick = function () { location.reload(); };
    var st = document.createElement('style');
    st.textContent = '.rln-edit-on [contenteditable="true"]{outline:2px dashed var(--accent);outline-offset:4px;border-radius:4px;min-height:1em}' +
      '.rln-edit-on .rln-dirty{outline-style:solid}' +
      '.rln-bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:12px;align-items:center;background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;z-index:99;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}' +
      '.rln-bar button{font:inherit;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;background:var(--accent);color:#fff}' +
      '.rln-bar #rln-exit{background:transparent;color:var(--bg);text-decoration:underline}';
    document.head.appendChild(st);
  }

  function indexPath(el) {
    var path = [], n = el;
    while (n && n !== document.body) {
      path.unshift(Array.prototype.indexOf.call(n.parentNode.children, n));
      n = n.parentNode;
    }
    return path;
  }
  function nodeAtPath(doc, path) {
    var n = doc.body;
    for (var i = 0; i < path.length; i++) {
      n = n.children[path[i]];
      if (!n) return null;
    }
    return n;
  }

  function save() {
    var dirty = Array.from(document.querySelectorAll('.rln-dirty'));
    if (!dirty.length) { alert('No changes to save.'); return; }
    var file = currentFile();
    var api = 'https://api.github.com/repos/' + REPO + '/contents/' + file;
    var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    fetch(api, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('GitHub API: ' + r.status);
      return r.json();
    }).then(function (data) {
      var src = new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\n/g, '')), function (c) { return c.charCodeAt(0); }));
      var doc = new DOMParser().parseFromString(src, 'text/html');
      var missed = 0;
      dirty.forEach(function (el) {
        var clone = el.cloneNode(true);
        clone.removeAttribute('contenteditable');
        clone.classList.remove('rln-dirty');
        var target = nodeAtPath(doc, indexPath(el));
        if (target) { target.innerHTML = clone.innerHTML; } else { missed++; }
      });
      if (missed) { alert(missed + ' element(s) could not be matched; those edits were skipped.'); }
      var out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML + '\n';
      var b64 = btoa(Array.from(new TextEncoder().encode(out), function (b) { return String.fromCharCode(b); }).join(''));
      return fetch(api, {
        method: 'PUT', headers: headers,
        body: JSON.stringify({ message: 'Edit ' + file + ' via site editor', content: b64, sha: data.sha }),
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('GitHub API: ' + r.status);
      alert('Saved. The live site updates in about a minute.');
      location.reload();
    }).catch(function (e) {
      alert('Save failed: ' + e.message + '\nIf this keeps happening, the token may be wrong or expired. Clear it by running localStorage.removeItem("' + LS_KEY + '") in the console and try again.');
    });
  }

  // ---- triggers ----
  addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      if (!editing) unlock();
    }
  });
  if (new URLSearchParams(location.search).has('edit') && !editing) unlock();
})();
