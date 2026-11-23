// ---------- New look for the rest of the app (Nov 18 2026) ----------
// On while Settings "New look" → "Use the new look on the other screens" is ticked (settings.newLook; on unless false).
// Unticked: every screen is exactly as before (nothing here runs). This file never changes data, tasks or emails:
// - "All open tasks" is drawn as facility cards (same filters, reminders, "Recently done" table).
// - "Corporates" is drawn as cards (same info, copy, Edit).
// - The facility page, corporate page and Settings are the same forms, regrouped into sections that open on click
//   (existing parts are moved into sections, never rebuilt, so every button, field and id still works).
// - Request forms get numbered steps (CSS only).
// Loaded after work.js, before ui.js.

const lookOn = () => st.settings.newLook !== false;

// ---------- completed steps (also used by My work) ----------
const STEP_SHORT = { corp: 'Corporate set up', added: 'Added to Brightree', pumps: 'Pumps', gdd: 'GDD orders', wr: 'FastCare', e3: 'Contacts received', ct: 'Contacts in portal',
  es: 'eSign info received', esp: 'eSign info in portal', emr: 'EMR info in portal', ps: 'Portal setup', sched: 'Scheduled', e1: 'Chicago handoff email', e2: 'Transfer notice' };
// the step a task belongs to (so it isn't listed twice)
const STEP_OF = { FASTCARE: 'wr', PORTAL_ADD: 'added', PUMPS: 'pumps', GDD: 'gdd', E3_REPLY: 'e3', EMAIL3_FOLLOW: 'e3', CONTACTS_PORTAL: 'ct', EMR_PORTAL: 'emr', EMR_CHECK: 'emr', EMR_FIX: 'emr',
  PORTAL_SETUP: 'ps', SCHEDULE: 'sched', ESIGN_PORTAL: 'esp', FAC_NOTICE: 'e2', PRICE: 'corp', EMR: 'corp' };
function doneSteps(f) {
  const out = [];
  PRE_ITEMS.forEach(([k]) => { let d = false; try { d = stepIsDone(f, k); } catch (_) { } if (d) out.push(STEP_SHORT[k] || k); else if (k === 'e3' && e3Skipped(f)) out.push(STEP_SKIPPED); });
  tasksOf(f).filter(t => t.status === 'Done' && !STEP_OF[t.type]).sort(wSort).forEach(t => out.push(wShort(t)));
  return [...new Set(out)];
}
// contacts never received and the facility is scheduled (Nov 23 2026): listed with the completed steps, gray, as skipped
const STEP_SKIPPED = 'Contacts received: skipped';
const doneHover = list => list.length ? `<div class="wdone"><button type="button" class="wdonebtn" data-wdone title="Hover to see completed steps">✓ <span>${list.length} completed</span></button><div class="wdonepop"><div class="in">${list.map(s => s === STEP_SKIPPED ? `<span class="pill p-wother" title="Never received. The facility was scheduled, so the app stopped following up.">– ${esc(s)}</span>` : `<span class="pill p-done">✓ ${esc(s)}</span>`).join('')}</div></div></div>` : '';

// ---------- All open tasks as cards ----------
function allLookHtml(all, ts, flt, facOk) {
  const groups = {}; ts.forEach(t => (groups[wKey(t)] = groups[wKey(t)] || []).push(t));
  const blocks = Object.entries(groups).map(([k, arr]) => [k, arr.sort(wSort)]).sort((a, b) => cmp(a[1].slice().sort(cmp)[0], b[1].slice().sort(cmp)[0]));
  const hot = blocks.filter(([, arr]) => arr.some(t => !isWaiting(t) && st.today >= t.due)), rest = blocks.filter(b => !hot.includes(b));
  const idle = st.facs.filter(f => !f.complete && !f.archived && !f.deleted && !groups['f' + f.id] && (!facOk || facOk(f))).sort((a, b) => facName(a).localeCompare(facName(b)));
  return `<h1>All open tasks</h1><p class="sub">Anyone can open anyone's task and finish it. The app records who actually did it, and the person it was assigned to gets an FYI email. "Transition lead" shows every task on the facilities they run, whoever it's assigned to. Tasks that haven't started yet are on the facility page.</p>${flt}
  ${hot.length ? wSec('Overdue or due today', hot.length, hot.map(([k, arr]) => allCard(k, arr)).join('')) : ''}${wSec('Open', rest.length, rest.map(([k, arr]) => allCard(k, arr)).join('') || `<div class="wempty">${ts.length ? '' : 'No open tasks match.'}</div>`)}${idle.length ? wSec('Nothing to do right now', idle.length, idle.map(f => allCard('f' + f.id, [])).join('')) : ''}${doneTable()}`;
}
function allCard(k, arr) {
  const h = wHead(k); if (!h) return '';
  const rows = arr.map(t => { const l = wLate(t); return `<div class="wstep ${l === 'Overdue' ? 'late' : ''}" data-task="${esc(t.key)}" tabindex="0" role="button" title="Open: ${esc(taskTitle(t))}"><span class="nm">${esc(wShort(t))}</span><span class="wrow-r"><span class="pill ${t.assignee === me() ? 'p-ready' : 'p-wother'}" title="${esc(nameOf(t.assignee))}">${esc(nameOf(t.assignee) || 'Nobody')}</span>${mayRemind(t) && canRemind(t) ? `<button class="wremind" data-remind="${esc(t.key)}" title="Email ${esc(nameOf(t.assignee))} a reminder now" aria-label="Send ${esc(nameOf(t.assignee))} a reminder">Remind</button>` : ''}</span></div>`; });
  if (h.f) wWaits(h.f, true).forEach(x => rows.push(`<div class="wstep"><span class="nm">${esc(x.n)}</span><span class="wrow-r"><span class="pill ${x.k === 'wait' ? 'p-wwait' : 'p-wother'}" title="Waiting on ${esc(x.who)}">Waiting on ${esc(x.who)}</span>${x.e3 ? e3RemindLink(h.f) : ''}</span></div>`));
  const f = h.f, d = f ? f.dates : h.n ? h.n.dates : null;
  const lateT = arr.map(wLate).find(x => x === 'Overdue') || arr.map(wLate).find(Boolean) || '';
  const [s, c] = f ? stageOf(f) : h.n ? nfStage(h.n) : ['', ''];
  const foot = d || lateT ? `<div class="wfoot">${d ? `<span>DOS <b>${fmtS(d.dos)}</b></span><span>Delivery Date <b>${fmtS(d.del)}</b></span>` : ''}${lateT ? `<span class="wlate">${lateT}</span>` : ''}</div>` : '';
  const open = f ? `data-fac="${f.id}"` : h.n ? `data-nf="${h.n.id}"` : h.g && grp(h.g) ? `data-editgrp="${esc(grp(h.g).name)}"` : '';
  return `<div class="wcard wall" ${open} tabindex="0" role="button" aria-label="Open ${esc(h.title)}"><div><div class="wch"><h3>${esc(h.title)}</h3>${s ? `<span class="pill ${c}">${s}</span>` : ''}</div>${h.lines.map(l => `<div class="wsub">${esc(l)}</div>`).join('')}${f ? `<div class="wsub">Transition lead: ${esc(nameOf(amOf(f)))}${atRisk(f) ? ' · <span class="wlate">At risk</span>' : ''}</div>` : ''}</div>${rows.join('') || '<div class="wmore-row">Nothing open right now.</div>'}<div class="wbot">${f ? doneHover(doneSteps(f)) : ''}${foot}</div></div>`;
}

// ---------- Corporates as cards ----------
function groupsLookHtml() {
  const gs = Object.values(st.groups).sort((a, b) => a.name.localeCompare(b.name));
  const ruleTxt = g => partialRule(g) ? (ruleText(g) || 'none') : g.rep ? nameOf(g.rep) + ' / clinical ' + nameOf(g.clin) + (g.acct ? ' / account manager ' + nameOf(g.acct) : '') + ' / transition lead ' + nameOf(g.am) + (ctlSet(g) ? ' / Gentell WC Transition Lead ' + ctlLabel(g.ctl) : '') : ctlSet(g) ? 'Gentell WC Transition Lead ' + ctlLabel(g.ctl) : 'none';
  const row = (n, v, ok) => `<div class="wstep"><span class="nm">${esc(n)}</span><span class="pill ${ok ? 'p-done' : 'p-wother'}" title="${esc(v)}">${esc(v)}</span></div>`;
  const card = g => { const open = st.tasks.filter(t => !t.fac && !t.nf && lc(t.group) === lc(g.name) && !done(t) && !t.archived);
    return `<div class="wcard wcorp"><div><div class="wch"><h3>${esc(g.name)}</h3>${g.standalone ? '<span class="pill p-wother">Standalone</span>' : ''}</div><div class="wsub">${facsOfGroup(g.name).length} facilities</div></div>
    ${row('Rep rule', ruleTxt(g), ruleTxt(g) !== 'none')}${row('Areas of care', covKnown(g) ? AREAS.map(a => a + ': ' + g.cov[a]).join('; ') : 'Missing', covKnown(g))}${row('Price table', g.price || 'Missing', !!g.price)}${row('EMR login', g.emr || 'None yet', !!g.emr)}
    ${row('Corporate contacts', (g.contacts || []).length ? (g.contacts || []).map(c => ((c.first + ' ' + c.last).trim() + ' (' + c.dept + ') ' + c.email)).join('; ') : 'None', (g.contacts || []).length > 0)}${row('Corporate note', g.noteDone ? 'Done' : 'Not yet', !!g.noteDone)}
    ${open.length ? `<div class="wsub wlate">${open.length} open task${open.length > 1 ? 's' : ''}: ${open.map(t => esc(wShort(t) + ' (' + nameOf(t.assignee) + ')')).join(', ')}</div>` : ''}
    <div class="wbot"><div class="wcopy"><select data-copysrc="${esc(g.name)}" aria-label="Copy from corporate"><option value="">Copy from corporate…</option>${gs.filter(x => x !== g).map(x => `<option>${esc(x.name)}</option>`).join('')}</select><button class="btn sm" data-copy="${esc(g.name)}" title="Copies areas of care, price table, rep rule, account manager and transition lead from the picked corporate">Copy</button><button class="btn sm pri" data-editgrp="${esc(g.name)}">Edit</button></div></div></div>`; };
  return `<h1>Corporates</h1><p class="sub">Corporate info is entered once. Every facility under it picks it up. Click "Edit" to change anything. "Copy" copies areas of care, price table, rep rule, account manager and transition lead from the corporate you pick.</p>${wSec('Corporates', gs.length, gs.map(card).join('') || '<div class="wempty">No corporates yet. They\'re added by requests.</div>')}`;
}

// ---------- sections that open on click (facility page, corporate page, Settings) ----------
// Existing blocks are moved, never rebuilt: inputs keep their ids, values and handlers. Which sections are open is remembered.
const secState = {}; // section key -> open (only once someone opened or closed it)
function secWrap(key, title, nodes, open, tipNode, force) {
  const d = document.createElement('details'); d.className = 'wsect'; d.dataset.sec = key;
  d.open = force || (key in secState ? secState[key] : !!open);
  const s = document.createElement('summary'); const t = document.createElement('span'); t.className = 'wst'; t.textContent = title; s.appendChild(t); if (tipNode) s.appendChild(tipNode);
  const inn = document.createElement('div'); inn.className = 'in';
  nodes.filter(Boolean).forEach(n => inn.appendChild(n));
  d.append(s, inn); return d;
}
// a ".card" that starts with a bold title becomes a section titled with it
function cardSection(card, scope, open, title) {
  const b = card.firstElementChild; if (!b || b.tagName !== 'B') return null;
  const t = title || b.textContent.trim(), tipNode = b.nextElementSibling && b.nextElementSibling.classList.contains('infow') ? b.nextElementSibling : null;
  b.remove(); if (tipNode) tipNode.remove();
  card.classList.add('in-sec');
  return secWrap(scope + ':' + t, t, [card], open, tipNode);
}
document.addEventListener('toggle', e => { const d = e.target; if (!d.dataset || !d.dataset.sec) return; secState[d.dataset.sec] = d.open; }, true);

function lookFac(L, f) {
  const dr = L.querySelector('.drawer[aria-label="Facility"]'); if (!dr || dr.dataset.look) return; dr.dataset.look = '1'; dr.classList.add('lookfac');
  const body = dr.querySelector('.body'), head = dr.querySelector('header');
  // the action buttons go in an "Actions" menu at the top
  const acts = [...body.children].find(x => x.classList.contains('row') && x.querySelector('[data-fact]'));
  if (acts && acts.children.length) {
    const m = document.createElement('div'); m.className = 'lmenu';
    m.innerHTML = '<button type="button" class="btn sm" data-lmenu aria-expanded="false" aria-haspopup="true">Actions ▾</button><div class="lmlist" hidden></div>';
    const list = m.querySelector('.lmlist'); [...acts.children].forEach(b => { b.classList.remove('pri', 'sm'); b.removeAttribute('style'); list.appendChild(b); }); acts.remove();
    head.insertBefore(m, head.lastElementChild);
  }
  const kids = [...body.children];
  const ed = kids.find(x => x.id === 'fdetbox'), kv = kids.find(x => x.classList.contains('kv'));
  const h2s = kids.filter(x => x.tagName === 'H2');
  const after = h => { const out = []; let n = h && h.nextElementSibling; while (n && n.tagName !== 'H2') { out.push(n); n = n.nextElementSibling; } return out; };
  const tasksH = h2s.find(h => /^Tasks/.test(h.textContent)), inH = h2s.find(h => /^Mailbox/.test(h.textContent)), outH = h2s.find(h => /^Emails/.test(h.textContent));
  const label = (txt, el) => { const p = document.createElement('div'); p.className = 'wptitle'; p.innerHTML = '<span>' + esc(txt) + '</span>'; return p; };
  const secs = [];
  // your open tasks on this facility, first
  const mine = st.tasks.filter(t => t.fac === f.id && !done(t) && !t.archived && !isWaiting(t) && t.assignee === me()).sort(wSort);
  if (mine.length) { const box = document.createElement('div'); box.className = 'lmine'; box.innerHTML = `<div class="wptitle"><span>Your tasks</span><span>${mine.length}</span></div>` + mine.map(t => `<button type="button" class="wbox closed" data-task="${esc(t.key)}"><span class="tt">${esc(wShort(t))}</span>${wLate(t) ? `<span class="wlate">${wLate(t)}</span>` : '<span class="pill p-ready">Ready</span>'}</button>`).join(''); secs.push(box); }
  if (tasksH) { const rest = after(tasksH); tasksH.remove(); const w = wWaits(f, true).filter(x => x.k === 'wait'); const wd = document.createElement('div'); if (w.length) { wd.className = 'meta'; wd.textContent = 'Waiting on: ' + w.map(x => x.n + ' (' + x.who + ')').join(' · '); }
    secs.push(secWrap('fac:stands', 'Where it stands', [w.length ? wd : null, ...rest], true)); }
  if (kv || ed) secs.push(secWrap('fac:details', 'Details', [kv, ed], false, null, ui.editOpen === f.id));
  const cards = kids.filter(x => x.classList && x.classList.contains('card') && x.id !== 'fdetbox' && x.id !== 'fsteps');
  const byTitle = re => cards.find(c => c.firstElementChild && c.firstElementChild.tagName === 'B' && re.test(c.firstElementChild.textContent));
  const dates = byTitle(/^(Dates|Recommended dates)/), areas = byTitle(/^Areas of care/), contacts = byTitle(/^Contacts/), files = byTitle(/^Attachments/), notes = byTitle(/^Transition lead notes/);
  if (dates) secs.push(cardSection(dates, 'fac', false, 'Dates'));
  if (areas) secs.push(cardSection(areas, 'fac'));
  if (contacts) secs.push(cardSection(contacts, 'fac'));
  if (inH || outH) { const nodes = []; if (inH) { nodes.push(label('Came in'), ...after(inH)); inH.remove(); } if (outH) { const r = after(outH); nodes.push(label('From the app'), ...r); outH.remove(); } secs.push(secWrap('fac:emails', 'Emails', nodes)); }
  if (files) secs.push(cardSection(files, 'fac'));
  cards.filter(c => ![dates, areas, contacts, files, notes].includes(c) && c.isConnected && c.parentNode === body).forEach(c => { const s = cardSection(c, 'fac'); if (s) secs.push(s); });
  const steps = kids.find(x => x.id === 'fsteps'); if (steps) { steps.classList.add('wsect-like'); secs.push(steps); }
  secs.filter(Boolean).forEach(s => body.appendChild(s));
  if (notes) body.insertBefore(notes, body.firstChild); // transition lead notes stay at the top, always open
  if (ui.editOpen === f.id && ed) setTimeout(() => ed.scrollIntoView({ block: 'start' }), 0);
}
function lookCorp(L) {
  const dr = L.querySelector('.drawer[aria-label="Corporate"]'); if (!dr || dr.dataset.look) return; dr.dataset.look = '1';
  const form = dr.querySelector('#gf'); if (!form) return;
  const kids = [...form.children], cards = kids.filter(x => x.classList.contains('card'));
  const apply = cards.find(c => /^Apply/.test((c.firstElementChild || {}).textContent || ''));
  const portal = kids.filter(x => !x.classList.contains('card') && x.id !== 'gf_err' && !x.querySelector('button[type=submit]'));
  const err = form.querySelector('#gf_err'), submit = [...form.children].find(x => x.querySelector && x.querySelector('button[type=submit]'));
  const secs = cards.filter(c => c !== apply).map((c, i) => cardSection(c, 'corp', i === 0));
  secs.push(secWrap('corp:portal', 'Portal and contacts', portal));
  if (apply) secs.push(cardSection(apply, 'corp'));
  secs.filter(Boolean).forEach(s => form.insertBefore(s, err));
  if (submit) form.appendChild(submit);
}
function lookSettings(m) {
  const form = m.querySelector('#setf'); if (!form || form.dataset.look) return; form.dataset.look = '1'; form.classList.add('lookset');
  [...form.children].filter(x => x.classList.contains('card')).forEach(c => { const s = cardSection(c, 'set'); if (s) form.insertBefore(s, form.querySelector('#set_err')); });
  [...m.children].filter(x => x.classList.contains('card')).forEach(c => { const s = cardSection(c, 'set'); if (s) m.appendChild(s); });
}

// ---------- after every draw ----------
function lookAfter() {
  document.body.classList.toggle('newlook', lookOn());
  if (!lookOn()) return;
  const L = document.getElementById('layer');
  if (ui.openFac && !ui.openWork) { const f = facById(ui.openFac); if (f) lookFac(L, f); }
  if (ui.openGroup && !ui.openWork) lookCorp(L);
  if (ui.view === 'settings') lookSettings(document.getElementById('main'));
}
// Actions menu on the facility page
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-lmenu]');
  document.querySelectorAll('.lmenu .lmlist:not([hidden])').forEach(l => { if (!b || !l.parentNode.contains(b)) { l.hidden = true; l.parentNode.querySelector('[data-lmenu]').setAttribute('aria-expanded', 'false'); } });
  if (b) { e.stopPropagation(); const l = b.parentNode.querySelector('.lmlist'); l.hidden = !l.hidden; b.setAttribute('aria-expanded', String(!l.hidden)); }
}, true);
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.wcard.wall, .wstep[data-task]')) { e.preventDefault(); e.target.click(); } });
