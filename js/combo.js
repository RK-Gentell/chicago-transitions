'use strict';
/* =====================================================================
   Type-to-search dropdowns. Any <select> with more than 4 choices gets a
   text box: type part of a name and pick from the matches (arrow keys +
   Enter work too). The real <select> stays in the page, hidden, and still
   holds the value, so everything that reads or saves it works as before.
   Loaded last; it watches the page and upgrades new dropdowns as they appear.
   ===================================================================== */
(function () {
  const MIN = 5; // choices (not counting the blank "Select…" one) before a dropdown gets search
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let cur = null; // the open list: { sel, inp, list, opts, active, typed }
  let seq = 0;

  const labelOf = sel => { const o = sel.options[sel.selectedIndex]; return o && o.value !== '' ? o.text : ''; };
  const blankOf = sel => [...sel.options].find(o => o.value === '');

  function enhance(sel) {
    if (sel.dataset.combo || sel.multiple || sel.closest('.combo')) return;
    const real = [...sel.options].filter(o => o.value !== '');
    if (real.length < MIN) return;
    sel.dataset.combo = '1';
    const wrap = document.createElement('span'); wrap.className = 'combo';
    const longest = Math.max(10, ...[...sel.options].map(o => o.text.length));
    wrap.style.setProperty('--cw', Math.min(longest, 34) + 'ch');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'combo-in'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.id = 'cb_' + (sel.id || 'x' + (++seq));
    inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-expanded', 'false');
    inp.placeholder = blankOf(sel) ? blankOf(sel).text : 'Type to search…';
    const al = sel.getAttribute('aria-label'); if (al) inp.setAttribute('aria-label', al);
    if (sel.id) document.querySelectorAll(`label[for="${CSS.escape(sel.id)}"]`).forEach(l => { l.htmlFor = inp.id; });
    inp.value = labelOf(sel); inp.disabled = sel.disabled;
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(inp); wrap.appendChild(sel);
    sel.classList.add('combo-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    // keep the box in step when the value changes from anywhere else
    sel.addEventListener('change', () => { if (!cur || cur.sel !== sel) inp.value = labelOf(sel); });
    let justFocused = false;
    inp.addEventListener('focus', () => { inp.value = labelOf(sel); inp.select(); justFocused = true; openList(sel, inp, ''); });
    inp.addEventListener('mouseup', e => { if (justFocused) { e.preventDefault(); justFocused = false; } }); // keep the text selected so typing replaces it
    inp.addEventListener('mousedown', () => { if (document.activeElement === inp && !cur) openList(sel, inp, ''); });
    inp.addEventListener('input', e => { e.stopPropagation(); openList(sel, inp, inp.value, true); });
    inp.addEventListener('change', e => e.stopPropagation()); // the box's own text isn't a value; only the select's is
    inp.addEventListener('keydown', e => keys(e, sel, inp));
    inp.addEventListener('blur', () => setTimeout(() => { if (cur && cur.inp === inp && document.activeElement !== inp) close(); }, 120));
  }

  function openList(sel, inp, q, typed) {
    if (sel.disabled) return;
    const words = norm(q).split(/\s+/).filter(Boolean);
    const all = [...sel.options];
    let opts = all.filter(o => o.value === '' ? !words.length : words.every(w => norm(o.text).includes(w)));
    if (!cur || cur.inp !== inp) { close(); const list = document.createElement('div'); list.className = 'combo-list'; list.setAttribute('role', 'listbox'); list.id = inp.id + '_list'; document.body.appendChild(list); cur = { sel, inp, list }; inp.setAttribute('aria-expanded', 'true'); inp.setAttribute('aria-controls', list.id); }
    cur.opts = opts; cur.typed = !!typed;
    const selIdx = opts.findIndex(o => o.value === sel.value && o.value !== '');
    cur.active = words.length ? (opts.findIndex(o => o.value !== '') ) : Math.max(0, selIdx);
    draw(); place();
  }
  function draw() {
    const { list, opts, active, sel } = cur;
    list.innerHTML = opts.length ? opts.map((o, i) => `<div class="combo-opt${i === active ? ' on' : ''}${o.value === sel.value && o.value !== '' ? ' picked' : ''}${o.value === '' ? ' blank' : ''}" role="option" id="${cur.inp.id}_o${i}" data-i="${i}" aria-selected="${o.value === sel.value}">${esc(o.text)}</div>`).join('') : '<div class="combo-none">No matches</div>';
    if (opts.length && active >= 0) { cur.inp.setAttribute('aria-activedescendant', cur.inp.id + '_o' + active); const el = list.children[active]; if (el) el.scrollIntoView({ block: 'nearest' }); }
  }
  function place() {
    if (!cur) return;
    const r = cur.inp.getBoundingClientRect(), below = innerHeight - r.bottom, h = Math.min(280, cur.list.scrollHeight + 2);
    cur.list.style.left = Math.max(4, Math.min(r.left, innerWidth - Math.max(r.width, 220) - 4)) + 'px';
    cur.list.style.minWidth = r.width + 'px';
    if (below < h + 8 && r.top > below) { cur.list.style.top = ''; cur.list.style.bottom = (innerHeight - r.top + 2) + 'px'; }
    else { cur.list.style.bottom = ''; cur.list.style.top = (r.bottom + 2) + 'px'; }
  }
  function pick(i) {
    const { sel, inp } = cur, o = cur.opts[i]; if (!o) return;
    close();
    inp.value = o.value === '' ? '' : o.text;
    if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function close() {
    if (!cur) return;
    const { list, inp, sel } = cur; cur = null;
    list.remove(); inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant');
    if (inp.isConnected && document.activeElement !== inp) inp.value = labelOf(sel);
  }
  function keys(e, sel, inp) {
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); if (cur && cur.inp === inp && cur.active >= 0) pick(cur.active); return; } // never submits the form
    if (k === 'Escape') { if (cur && cur.inp === inp) { e.preventDefault(); e.stopPropagation(); close(); inp.value = labelOf(sel); inp.select(); } return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!cur || cur.inp !== inp) { openList(sel, inp, ''); return; }
      const n = cur.opts.length; if (!n) return;
      cur.active = ((cur.active < 0 ? -1 : cur.active) + (k === 'ArrowDown' ? 1 : -1) + n) % n; draw(); return;
    }
    if (k === 'Tab' && cur && cur.inp === inp) { if (cur.typed && cur.active >= 0) pick(cur.active); else close(); }
  }
  // clicks in the list: pick on mousedown so the text box keeps focus until then
  document.addEventListener('mousedown', e => {
    if (!cur) return;
    const o = e.target.closest && e.target.closest('.combo-opt');
    if (o && cur.list.contains(o)) { e.preventDefault(); pick(+o.dataset.i); return; }
    if (e.target.closest && (e.target.closest('.combo-list') || e.target === cur.inp)) { if (e.target.closest('.combo-list')) e.preventDefault(); return; }
    close();
  }, true);
  document.addEventListener('scroll', e => { if (cur && !(e.target.closest && e.target.closest('.combo-list'))) place(); }, true);
  window.addEventListener('resize', () => place());

  // upgrade every dropdown on the page now and whenever the page changes
  const scan = root => (root.querySelectorAll ? root.querySelectorAll('select:not([data-combo])') : []).forEach(enhance);
  scan(document);
  new MutationObserver(ms => {
    if (cur && !cur.inp.isConnected) close();
    ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') enhance(n); else scan(n); }));
  }).observe(document.body, { childList: true, subtree: true });
  window.comboEnhance = scan; // for tests
})();
