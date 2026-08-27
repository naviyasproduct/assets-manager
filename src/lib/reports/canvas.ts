/**
 * The editing chrome that turns the preview into a canvas.
 *
 * This is a string of plain browser JavaScript, injected into the preview HTML
 * and into nothing else. It never reaches the PDF: `renderReportHtml` only adds
 * it when the caller asked for an editable preview, and Puppeteer never does.
 *
 * Why it runs *inside* the preview rather than as an overlay drawn by React:
 * the controls have to sit exactly on top of a table cell, a heading, a group
 * card. Measuring all of that from the parent and keeping it in step through
 * every scroll, resize and re-render is a second layout engine. Inside the
 * document, `getBoundingClientRect` is simply the truth.
 *
 * The iframe stays sandboxed - `allow-scripts` and nothing else. That is an
 * opaque origin: this script cannot read the page around it, its cookies or its
 * storage, and the only thing it can do to the rest of the app is post a
 * message. The builder treats every message as untrusted input and checks the
 * ids in it against what it already knows, exactly as it would a URL parameter.
 *
 * The contract with reports/template.ts:
 *
 *   data-b   id of a block - a layout id, a group key, or a part of one
 *   data-bk  flow  - a top-level block; can be dragged and removed
 *            group - one group card; can be dragged among the other groups
 *            part  - a piece inside something; can be removed, not moved
 *   data-bl  what to call it on screen
 *   data-btext / data-bfield  editable text, and which field it writes back to
 *   data-tbl / data-col / data-min  a table, its columns, and each column floor
 *   data-row / data-rowkind  one row, and which tick list it belongs to
 */

export const CANVAS_STYLES = `
  .rc-hot { outline: 1px dashed #7f92b5; outline-offset: 2px; }
  .rc-sel { outline: 2px solid #1b3a6b; outline-offset: 2px; }
  .rc-drag { opacity: .4; }
  .rc-gone { display: none !important; }

  #rc-bar {
    position: absolute; z-index: 9999; display: none;
    align-items: center; gap: 2px;
    background: #1b3a6b; color: #fff; border-radius: 5px;
    padding: 2px 3px; box-shadow: 0 2px 8px rgba(16,32,46,.28);
    font: 550 10px 'Segoe UI', Arial, sans-serif; white-space: nowrap;
  }
  #rc-bar .rc-name {
    padding: 0 6px 0 3px; max-width: 210px; overflow: hidden; text-overflow: ellipsis;
  }
  #rc-bar button, #rc-bar .rc-grip {
    font: inherit; font-size: 11px; line-height: 18px; text-align: center; color: #fff;
    background: rgba(255,255,255,.14); border: 0; border-radius: 3px;
    width: 20px; height: 18px; padding: 0; cursor: pointer; display: block;
  }
  #rc-bar button:hover, #rc-bar .rc-grip:hover { background: rgba(255,255,255,.36); }
  #rc-bar .rc-x:hover { background: #c0392b; }
  #rc-bar .rc-grip { cursor: grab; }

  #rc-line {
    position: absolute; z-index: 9998; display: none;
    height: 3px; background: #1b3a6b; border-radius: 2px;
  }
  #rc-line::before {
    content: ''; position: absolute; left: -4px; top: -3px;
    width: 9px; height: 9px; border-radius: 50%; background: #1b3a6b;
  }

  #rc-rowx {
    position: absolute; z-index: 9997; display: none;
    width: 18px; height: 18px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
    background: #fff; color: #a4232b; box-shadow: 0 1px 5px rgba(16,32,46,.32);
    font: 700 10px 'Segoe UI', Arial, sans-serif;
  }
  tr.rc-rowhot > td { background: #fbe9ea; }

  th[data-col] { position: relative; }
  .rc-colx {
    position: absolute; top: 1px; right: 3px; display: none;
    width: 13px; height: 13px; border: 0; border-radius: 3px; padding: 0; cursor: pointer;
    background: #1b3a6b; color: #fff;
    font: 700 8px 'Segoe UI', Arial, sans-serif; line-height: 13px;
  }
  th[data-col]:hover .rc-colx { display: block; }
  .rc-colgrip {
    position: absolute; top: 0; bottom: 0; right: -5px; width: 11px;
    cursor: col-resize; z-index: 5;
  }
  .rc-colgrip::after {
    content: ''; position: absolute; left: 5px; top: 2px; bottom: 2px;
    width: 1px; background: transparent;
  }
  table.data:hover .rc-colgrip::after { background: #b8c2d4; }
  .rc-colgrip:hover::after { background: #1b3a6b; width: 3px; left: 4px; }

  .rc-editing {
    outline: 2px solid #1f7a4d !important; outline-offset: 2px;
    background: #f2fbf6; cursor: text;
  }

  /* An added block that has been emptied still has to be findable to refill. */
  .rc-empty { min-height: 13px; border: 1px dashed #c6cfdf; }
`;

export const CANVAS_SCRIPT = `
(function () {
  var doc = document, win = window;
  var state = { hot: null, sel: null, row: null, drag: null };

  function post(m) { m.rc = 1; try { win.parent.postMessage(m, '*'); } catch (e) {} }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { top: r.top + win.scrollY, left: r.left + win.scrollX, width: r.width, height: r.height };
  }

  function byId(id) {
    var all = doc.querySelectorAll('[data-b]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-b') === id) return all[i];
    return null;
  }

  function blockOf(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentNode : null);
    while (el && el !== doc.body) {
      if (el.hasAttribute && el.hasAttribute('data-b')) return el;
      el = el.parentNode;
    }
    return null;
  }

  // --- The chrome ---------------------------------------------------------

  var bar = doc.createElement('div');
  bar.id = 'rc-bar';
  bar.innerHTML =
    '<span class="rc-grip" data-a="grip" title="Drag to move">&#10303;</span>' +
    '<span class="rc-name"></span>' +
    '<button type="button" data-a="edit" title="Edit this block">&#9998;</button>' +
    '<button type="button" data-a="up" title="Move up">&#8593;</button>' +
    '<button type="button" data-a="down" title="Move down">&#8595;</button>' +
    '<button type="button" class="rc-x" data-a="remove" title="Take this off the report">&#10005;</button>';
  doc.body.appendChild(bar);

  var line = doc.createElement('div');
  line.id = 'rc-line';
  doc.body.appendChild(line);

  var rowx = doc.createElement('button');
  rowx.id = 'rc-rowx';
  rowx.type = 'button';
  rowx.title = 'Leave this row out of this report';
  rowx.innerHTML = '&#10005;';
  doc.body.appendChild(rowx);

  var name = bar.querySelector('.rc-name');

  function target() { return state.hot || state.sel || null; }

  function place() {
    var el = target();
    if (!el || el.classList.contains('rc-gone')) { bar.style.display = 'none'; return; }

    var movable = el.getAttribute('data-bk') !== 'part';
    bar.style.display = 'flex';
    name.textContent = el.getAttribute('data-bl') || 'Block';
    bar.querySelector('[data-a=grip]').style.display = movable ? 'block' : 'none';
    bar.querySelector('[data-a=up]').style.display = movable ? 'block' : 'none';
    bar.querySelector('[data-a=down]').style.display = movable ? 'block' : 'none';

    var box = rectOf(el);
    var top = box.top - bar.offsetHeight - 4;
    // A block at the very top of the sheet has nothing above it to hang from.
    if (top < win.scrollY + 2) top = box.top + 2;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(2, box.left) + 'px';
  }

  function setHot(el) {
    if (state.hot === el) return;
    if (state.hot) state.hot.classList.remove('rc-hot');
    state.hot = el && el !== state.sel ? el : null;
    if (state.hot) state.hot.classList.add('rc-hot');
    place();
  }

  function select(el, quiet) {
    if (state.sel) state.sel.classList.remove('rc-sel');
    state.sel = el || null;
    if (state.sel) {
      state.sel.classList.remove('rc-hot');
      if (state.hot === state.sel) state.hot = null;
      state.sel.classList.add('rc-sel');
    }
    if (!quiet) {
      post({
        t: 'select',
        id: el ? el.getAttribute('data-b') : null,
        kind: el ? el.getAttribute('data-bk') : null
      });
    }
    place();
  }

  // --- Hover --------------------------------------------------------------

  doc.addEventListener('mousemove', function (e) {
    if (state.drag) return;
    if (e.target === rowx || bar.contains(e.target)) return;
    setHot(blockOf(e.target));
    hoverRow(e.target);
  });

  doc.addEventListener('mouseleave', function () {
    if (state.drag) return;
    setHot(null);
    hoverRow(null);
  });

  function hoverRow(node) {
    var tr = node && node.nodeType === 1 ? node : null;
    while (tr && tr.nodeName !== 'TR') tr = tr.parentNode;
    if (tr && (!tr.getAttribute || !tr.getAttribute('data-row'))) tr = null;
    if (state.row === tr) return;

    if (state.row) state.row.classList.remove('rc-rowhot');
    state.row = tr;
    if (!tr) { rowx.style.display = 'none'; return; }

    tr.classList.add('rc-rowhot');
    var box = rectOf(tr);
    rowx.style.display = 'block';
    rowx.style.top = (box.top + box.height / 2 - 9) + 'px';
    rowx.style.left = (box.left + box.width - 7) + 'px';
  }

  rowx.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (!state.row) return;
    post({
      t: 'droprow',
      kind: state.row.getAttribute('data-rowkind'),
      id: state.row.getAttribute('data-row')
    });
    // Struck out straight away rather than waiting for the round trip, so a
    // list can be gone through at the speed it is read.
    state.row.classList.add('rc-gone');
    state.row.classList.remove('rc-rowhot');
    state.row = null;
    rowx.style.display = 'none';
  });

  // --- Selecting, and the bar above the block -----------------------------

  doc.addEventListener('click', function (e) {
    if (bar.contains(e.target) || e.target === rowx) return;
    select(blockOf(e.target));
  });

  bar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-a]');
    if (!btn) return;
    var action = btn.getAttribute('data-a');
    var el = target();
    if (!el || action === 'grip') return;

    var id = el.getAttribute('data-b');
    var kind = el.getAttribute('data-bk');

    if (action === 'remove') {
      post({ t: 'remove', id: id, kind: kind });
      el.classList.add('rc-gone');
      setHot(null);
      if (state.sel === el) select(null, true);
      bar.style.display = 'none';
      return;
    }
    if (action === 'edit') {
      select(el);
      post({ t: 'edit', id: id, kind: kind });
      return;
    }
    post({ t: 'nudge', id: id, kind: kind, delta: action === 'up' ? -1 : 1 });
  });

  // --- Dragging a block somewhere else ------------------------------------

  bar.querySelector('[data-a=grip]').addEventListener('pointerdown', function (e) {
    var el = target();
    if (!el || el.getAttribute('data-bk') === 'part') return;
    e.preventDefault();

    var kind = el.getAttribute('data-bk');
    var list = [].slice.call(doc.querySelectorAll('[data-bk="' + kind + '"]'));
    state.drag = { el: el, kind: kind, list: list, before: null, pointer: e.pointerId };
    el.classList.add('rc-drag');
    bar.style.display = 'none';

    // Capture on the root, which nothing re-renders during a drag, so the
    // pointer can leave the sheet and still be followed.
    try { doc.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
    doc.addEventListener('pointermove', onDrag, true);
    doc.addEventListener('pointerup', endDrag, true);
    doc.addEventListener('pointercancel', endDrag, true);
  });

  function onDrag(e) {
    var d = state.drag;
    if (!d) return;

    var y = e.clientY + win.scrollY;
    var before = null;
    for (var i = 0; i < d.list.length; i++) {
      var box = rectOf(d.list[i]);
      if (y < box.top + box.height / 2) { before = d.list[i]; break; }
    }
    d.before = before;

    var mark = before ? rectOf(before) : (d.list.length ? rectOf(d.list[d.list.length - 1]) : null);
    if (mark) {
      line.style.display = 'block';
      line.style.top = (before ? mark.top - 3 : mark.top + mark.height + 1) + 'px';
      line.style.left = mark.left + 'px';
      line.style.width = mark.width + 'px';
    }

    if (e.clientY < 46) win.scrollBy(0, -16);
    else if (e.clientY > win.innerHeight - 46) win.scrollBy(0, 16);
  }

  function endDrag() {
    var d = state.drag;
    if (!d) return;
    doc.removeEventListener('pointermove', onDrag, true);
    doc.removeEventListener('pointerup', endDrag, true);
    doc.removeEventListener('pointercancel', endDrag, true);
    try { doc.documentElement.releasePointerCapture(d.pointer); } catch (err) {}

    d.el.classList.remove('rc-drag');
    line.style.display = 'none';
    state.drag = null;

    if (d.before !== d.el) {
      post({
        t: 'move',
        kind: d.kind,
        id: d.el.getAttribute('data-b'),
        before: d.before ? d.before.getAttribute('data-b') : null
      });
    }
    place();
  }

  // --- Columns: drop one, or drag the join between two --------------------

  function decorateTables() {
    var tables = doc.querySelectorAll('table.data[data-tbl]');
    for (var t = 0; t < tables.length; t++) {
      var heads = tables[t].querySelectorAll('thead th[data-col]');
      for (var i = 0; i < heads.length; i++) {
        var th = heads[i];
        if (th.querySelector('.rc-colx')) continue;

        var x = doc.createElement('button');
        x.type = 'button';
        x.className = 'rc-colx';
        x.title = 'Remove this column';
        x.innerHTML = '&#10005;';
        th.appendChild(x);

        if (i < heads.length - 1) {
          var grip = doc.createElement('div');
          grip.className = 'rc-colgrip';
          grip.setAttribute('data-i', String(i));
          grip.title = 'Drag to move width between these two columns';
          th.appendChild(grip);
        }
      }
    }
  }

  doc.addEventListener('click', function (e) {
    var x = e.target.closest('.rc-colx');
    if (!x) return;
    e.preventDefault();
    e.stopPropagation();
    var th = x.closest('th[data-col]');
    var table = x.closest('table.data');
    post({ t: 'dropcol', table: table.getAttribute('data-tbl'), col: th.getAttribute('data-col') });
  }, true);

  doc.addEventListener('pointerdown', function (e) {
    var grip = e.target.closest('.rc-colgrip');
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();

    var table = grip.closest('table.data');
    var cols = [].slice.call(table.querySelectorAll('colgroup col'));
    var heads = [].slice.call(table.querySelectorAll('thead th[data-col]'));
    var index = parseInt(grip.getAttribute('data-i'), 10);
    var width = table.getBoundingClientRect().width;
    if (!width || cols.length !== heads.length) return;

    var startX = e.clientX;
    var base = cols.map(function (c) { return parseFloat(c.style.width) || 0; });
    var floors = heads.map(function (th) { return parseFloat(th.getAttribute('data-min')) || 3; });
    var latest = base.slice();

    var onMove = function (moveEvent) {
      var delta = ((moveEvent.clientX - startX) / width) * 100;
      delta = Math.max(delta, floors[index] - base[index]);
      delta = Math.min(delta, base[index + 1] - floors[index + 1]);

      var next = base.slice();
      next[index] = Math.round(base[index] + delta);
      // Taken from the neighbour rather than recalculated, so the row still
      // adds up to exactly 100 however far it is dragged.
      next[index + 1] = base[index] + base[index + 1] - next[index];
      latest = next;
      cols[index].style.width = next[index] + '%';
      cols[index + 1].style.width = next[index + 1] + '%';
    };

    var onUp = function () {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onUp, true);
      try { doc.documentElement.releasePointerCapture(e.pointerId); } catch (err) {}
      post({
        t: 'width',
        table: table.getAttribute('data-tbl'),
        keys: heads.map(function (th) { return th.getAttribute('data-col'); }),
        widths: latest
      });
    };

    try { doc.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onUp, true);
  }, true);

  // --- Typing straight onto the page --------------------------------------

  doc.addEventListener('dblclick', function (e) {
    var el = e.target.closest('[data-btext]');
    if (!el) return;
    e.preventDefault();

    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('rc-editing');
    el.focus();

    var finish = function (commit) {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      el.removeAttribute('contenteditable');
      el.classList.remove('rc-editing');
      if (commit) {
        post({
          t: 'settext',
          id: el.getAttribute('data-btext'),
          field: el.getAttribute('data-bfield') || 'text',
          text: el.innerText
        });
      }
    };
    var onBlur = function () { finish(true); };
    var onKey = function (keyEvent) {
      if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false); el.blur(); }
    };

    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  });

  // --- Keys that belong to the page around this one -----------------------
  //
  // Once anything in here has been clicked, the keyboard is inside this
  // document and the builder's own listener never sees it. Undo, redo and
  // delete would simply stop working halfway through laying a page out.

  doc.addEventListener('keydown', function (e) {
    var editingText = e.target && e.target.closest && e.target.closest('[contenteditable]');
    if (editingText) return;

    var key = (e.key || '').toLowerCase();

    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      post({ t: 'key', key: key, shift: !!e.shiftKey });
      return;
    }

    if ((key === 'delete' || key === 'backspace') && state.sel) {
      e.preventDefault();
      post({
        t: 'remove',
        id: state.sel.getAttribute('data-b'),
        kind: state.sel.getAttribute('data-bk')
      });
      state.sel.classList.add('rc-gone');
      select(null, true);
      bar.style.display = 'none';
    }
  });

  // --- Keeping the parent in step -----------------------------------------

  var scrollTimer = null;
  win.addEventListener('scroll', function () {
    if (scrollTimer) return;
    scrollTimer = win.setTimeout(function () {
      scrollTimer = null;
      post({ t: 'scroll', y: win.scrollY });
    }, 120);
  });

  win.addEventListener('resize', place);

  win.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.rc !== 2 || m.t !== 'restore') return;
    // Every edit replaces this document, so where the reader had scrolled to
    // and what they had selected have to be handed back, or the canvas jumps
    // to the top on every keystroke.
    if (typeof m.y === 'number') win.scrollTo(0, m.y);
    if (m.id) {
      var el = byId(m.id);
      if (el) select(el, true);
    }
  });

  decorateTables();
  post({ t: 'ready' });
})();
`;
