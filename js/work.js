// ---------- "My work" screen (Nov 17 2026) ----------
// Replaces the old "My tasks" list when Settings "Use the new My work screen" is ticked (settings.newWork; on unless set to false).
// Unticking it brings the old "My tasks" back for everyone, with nothing else changed: this file only adds screens, it never
// changes how tasks are made, saved or emailed. Every task still opens with its own full form (TT[type].form), the same one as before.
// - Transition leads (Team "Transition lead" ticked): a grid of facility cards ("Ready for you" / "Waiting on others").
//   Clicking a card opens the facility's work panel: one box per open task of theirs, in flow order (the first one open),
//   then Where it stands / Details / Emails / Notes, closed until clicked.
// - Everyone else: their tasks as cards grouped by task type, oldest first. Pumps and GDD are answered right on the card;
//   other tasks open their usual form.
// Loaded right before ui.js: it only uses ui.js's helpers when something is drawn or clicked.

const workOn = () => st.settings.newWork !== false;
const isLeadView = () => isAm(forWho());

// short step names for cards (the full title is still on the task itself)
const WSHORT = {
  RULE: 'Pick the reps', AREAS: 'Areas of care', PRICE: 'Price table', CORP_NOTE: 'Corporate note', EMR: 'EMR access', EMR_ADD: 'EMR login', PORTAL_ADD: 'Add to Brightree',
  PUMPS: 'Pumps', GDD: 'GDD orders', GDD_PORTAL: 'GDD warehouse in portal', FASTCARE: 'FastCare', BRIGHTREE: 'Brightree report',
  PORTAL_SETUP: 'Portal setup', LEAD_NOTE: 'Changed after the handoff email', EMR_CHECK: 'Check EMR access', EMR_PORTAL: 'EMR info in portal', EMR_FIX: 'EMR access problem',
  CONTACTS_PORTAL: 'Contacts into portal', SCHEDULE: 'Schedule', ADDRESS: 'Address', ESIGN_PORTAL: 'eSign info into portal',
  E3_REPLY: 'Contacts reply', EMAIL3_FOLLOW: 'Contacts follow-up', PORTAL_UPDATE: 'Update the portal', FAC_NOTICE: 'Send the transfer notice',
  CHICAGO_FOLLOW: 'Chicago facility email', NF_SCHEDULE: 'Schedule', NF_REPS: 'Pick the reps', NF_RECAL: 'Fix the Ordering Calendar'
};
// the order the steps are usually done in (boxes in the panel and rows on a card follow it)
const WORDER = ['RULE', 'AREAS', 'PRICE', 'CORP_NOTE', 'EMR', 'FASTCARE', 'ADDRESS', 'PORTAL_ADD', 'EMR_ADD', 'PUMPS', 'GDD', 'BRIGHTREE', 'PORTAL_SETUP', 'EMR_FIX', 'EMR_CHECK', 'EMR_PORTAL', 'GDD_PORTAL',
  'SCHEDULE', 'NF_REPS', 'NF_SCHEDULE', 'NF_RECAL', 'CHICAGO_FOLLOW', 'E3_REPLY', 'EMAIL3_FOLLOW', 'CONTACTS_PORTAL', 'ESIGN_PORTAL', 'FAC_NOTICE', 'PORTAL_UPDATE', 'LEAD_NOTE'];
const wShort = t => WSHORT[t.type] || taskTitle(t);
const wOrd = t => { const i = WORDER.indexOf(t.type); return i < 0 ? 99 : i; };
const wSort = (a, b) => wOrd(a) - wOrd(b) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
const wLate = t => st.today > t.due ? 'Overdue' : st.today === t.due ? 'Due today' : '';
// the key a task's card is under: facility, new facility or corporate
const wKey = t => t.fac ? 'f' + t.fac : t.nf ? 'n' + t.nf : 'g' + lc(t.group || '__nocorp');
const myOpen = () => openTasksFor(forWho()).filter(t => !isWaiting(t));

// ---------- what a facility is waiting on (people outside the app, or someone else on the team) ----------
function wWaits(f, noTasks) {
  const w = [];
  if (f.hold) return [{ n: 'On hold', who: 'Put on hold', k: 'other' }];
  if (!noTasks) st.tasks.filter(t => t.fac === f.id && !done(t) && !t.archived && !isWaiting(t) && t.assignee !== forWho()).sort(wSort)
    .forEach(t => w.push({ n: wShort(t), who: nameOf(t.assignee) || 'nobody yet', k: 'other' }));
  if (!noTasks) st.tasks.filter(t => !t.fac && !t.nf && f.group && lc(t.group) === lc(f.group) && !done(t) && !t.archived && !isWaiting(t) && t.assignee !== forWho())
    .forEach(t => w.push({ n: wShort(t), who: nameOf(t.assignee) || 'nobody yet', k: 'other' }));
  if (hasPrice(G(f)) && !f.inPortal && !fTask(f, 'PORTAL_ADD')) w.push({ n: 'Add to Brightree', who: roleName('portal'), k: 'other' });
  if (ctlNeeded(f) && !w.some(x => x.n === 'Pick the reps')) w.push({ n: 'Gentell WC Transition Lead', who: roleName('rules'), k: 'other' });
  if (f.email3 && !f.e3Done && !f.e3Reply) w.push({ n: 'Contacts', who: e3Names(f).join(', ') || 'wound rep and regional', k: 'wait' });
  if (f.esignAsk && !f.esignGot && !f.esignDone) w.push({ n: 'Provider and eSign info', who: esGreet(), k: 'wait' });
  return w;
}
// steps done on the facility: from its steps (tasks, "Already done", Mark steps done) and any other finished task (doneSteps, look.js)
const wDoneSteps = f => doneSteps(f);

// ---------- screen ----------
function workHtml() {
  const admin = isAdmin(me()), demo = STORE.mode === 'demo', F = ui.myF;
  const who = admin && !demo ? `<label class="meta" for="forwho">Show tasks for</label><select id="forwho">${[...new Set([me(), ...sortedPeople().map(p => lc(p.email)).filter(Boolean)])].map(e => `<option value="${esc(e)}" ${e === forWho() ? 'selected' : ''}>${esc(nameOf(e))}${e === me() ? ' (me)' : ''}</option>`).join('')}</select>` : '';
  const all = myOpen(), ts = all.filter(t => (!F.fac || t.fac === +F.fac) && (!F.corp || corpKey(t) === F.corp));
  const flt = `<div class="filters">${who}${facSel('mt_fac', all, F.fac)}${corpSel('mt_corp', all, F.corp)}${F.fac || F.corp ? '<button class="btn sm" data-clearf="my">Clear filters</button>' : ''}</div>`;
  return isLeadView() ? leadWorkHtml(ts, all, flt) : quickWorkHtml(ts, all, flt);
}
const wSec = (title, n, body, tipTxt) => `<section class="wsec"><div class="wsech">${esc(title)}<span class="wn">${n}</span>${tipTxt ? tip(esc(tipTxt)) : ''}</div><div class="wsecb">${body}</div></section>`;

// transition leads: facility cards
function leadWorkHtml(ts, all, flt) {
  const F = ui.myF, groups = {};
  ts.forEach(t => { (groups[wKey(t)] = groups[wKey(t)] || []).push(t); });
  const ready = Object.entries(groups).map(([k, arr]) => [k, arr.sort(wSort)]).sort((a, b) => cmp(a[1].slice().sort(cmp)[0], b[1].slice().sort(cmp)[0]));
  const others = st.facs.filter(f => amOf(f) === forWho() && !f.complete && !f.archived && !f.deleted && !groups['f' + f.id]
    && (!F.fac || f.id === +F.fac) && (!F.corp || lc(f.group || '__nocorp') === F.corp)).sort((a, b) => facName(a).localeCompare(facName(b)));
  const empty = all.length ? 'No tasks match these filters.' : 'Nothing for you to do right now.';
  return `<h1>My work</h1>${flt}${wSec('Ready for you', ready.length, ready.map(([k, arr]) => wCard(k, arr)).join('') || `<div class="wempty">${empty}</div>`)}${others.length ? wSec('Waiting on others', others.length, others.map(f => wCard('f' + f.id, [])).join('')) : ''}`;
}
const W_ROWS = 4;
function wHead(k) {
  if (k[0] === 'f') { const f = facById(+k.slice(1)); return f ? { title: facName(f), lines: ['Chicago name: ' + f.name, f.group || 'Corporate not known yet'], f } : null; }
  if (k[0] === 'n') { const n = nfById(+k.slice(1)); return n ? { title: n.name, lines: ['New facility', n.group || ''].filter(Boolean), n } : null; }
  const g = k.slice(1); return { title: g === '__nocorp' ? 'Corporate not known yet' : 'Corporate: ' + ((grp(g) || {}).name || g), lines: [], g };
}
function wCard(k, mine) {
  const h = wHead(k); if (!h) return '';
  const rows = mine.map(t => { const l = wLate(t); return `<div class="wstep ready ${l === 'Overdue' ? 'late' : ''}"><span class="nm">${esc(wShort(t))}</span><span class="pill p-ready">Ready</span></div>`; });
  if (h.f) wWaits(h.f).forEach(x => rows.push(`<div class="wstep"><span class="nm">${esc(x.n)}</span><span class="pill ${x.k === 'wait' ? 'p-wwait' : 'p-wother'}" title="Waiting on ${esc(x.who)}">Waiting on ${esc(x.who)}</span></div>`));
  const shown = rows.length > W_ROWS ? rows.slice(0, W_ROWS - 1).join('') + `<div class="wmore-row">+${rows.length - W_ROWS + 1} more. Open to see all</div>` : rows.join('') || '<div class="wmore-row">Nothing open right now.</div>';
  const doneList = h.f ? wDoneSteps(h.f) : [];
  const lateT = mine.map(wLate).find(x => x === 'Overdue') || mine.map(wLate).find(Boolean) || '';
  const d = h.f ? h.f.dates : h.n ? h.n.dates : null;
  const foot = d || lateT ? `<div class="wfoot">${d ? `<span>DOS <b>${fmtS(d.dos)}</b></span><span>Delivery Date <b>${fmtS(d.del)}</b></span>` : ''}${lateT ? `<span class="wlate">${lateT}</span>` : ''}</div>` : '';
  const doneBtn = doneList.length ? `<div class="wdone"><button type="button" class="wdonebtn" data-wdone title="Hover to see completed steps">✓ <span>${doneList.length} completed</span></button><div class="wdonepop"><div class="in">${doneList.map(s => `<span class="pill p-done">✓ ${esc(s)}</span>`).join('')}</div></div></div>` : '';
  return `<div class="wcard ${ui.openWork === k ? 'sel' : ''}" data-work="${esc(k)}" tabindex="0" role="button" aria-label="Open ${esc(h.title)}">
    <div><h3>${esc(h.title)}</h3>${h.lines.map(l => `<div class="wsub">${esc(l)}</div>`).join('')}</div>${shown}${doneBtn || foot ? `<div class="wbot">${doneBtn}${foot}</div>` : ''}</div>`;
}

// ---------- the work panel (one facility, new facility or corporate) ----------
function workTasks(k) { return myOpen().filter(t => wKey(t) === k).sort(wSort); }
function workPanel(k) {
  const h = wHead(k); if (!h) return '';
  const ts = workTasks(k);
  if (!ts.some(t => t.key === ui.openTask)) ui.openTask = ts.length ? ts[0].key : null;
  const seen = ui.workSeen && ui.workSeen.k === k ? ui.workSeen.keys : null;
  const boxes = ts.map(t => {
    const isNew = seen && !seen.has(t.key), l = wLate(t);
    const tag = isNew ? '<span class="wnew">Ready now</span>' : l ? `<span class="wlate">${l}</span>` : '';
    const name = h.g ? taskTitle(t) : wShort(t); // the facility's name is already at the top of the panel
    if (t.key !== ui.openTask) return `<button type="button" class="wbox closed" data-wopen="${esc(t.key)}"><span class="tt">${esc(name)}</span>${tag}</button>`;
    return `<div class="wbox ${l === 'Overdue' ? 'late' : ''}"><div class="wbh"><span class="tt">${esc(name)}</span>${tag}</div>${taskBody(t, true)}</div>`;
  }).join('');
  ui.workSeen = { k, keys: new Set([...(seen || []), ...ts.map(t => t.key)]) };
  const f = h.f, d = f ? f.dates : h.n ? h.n.dates : null;
  const sub = [...h.lines, d ? 'DOS ' + fmtS(d.dos) + ' · Delivery Date ' + fmtS(d.del) : ''].filter(Boolean);
  const link = f ? `<a class="linkish faclink" href="?${STORE.mode === 'demo' ? 'demo&' : ''}fac=${f.id}" data-facpage="${f.id}">Facility page</a>` : h.n ? `<button class="linkish" data-nf="${h.n.id}">New facility page</button>` : h.g && grp(h.g) ? `<button class="linkish" data-editgrp="${esc(grp(h.g).name)}">Corporate page</button>` : '';
  const waits = f ? wWaits(f) : [];
  const nothing = !ts.length ? `<div class="wquiet"><b>Nothing for you here right now.</b>${waits.length ? `<div class="meta">Waiting on: ${waits.map(x => esc(x.n + ' (' + x.who + ')')).join(' · ')}</div>` : ''}</div>` : '';
  return `<div class="scrim" data-close></div><div class="drawer wpanel" role="dialog" aria-label="${esc(h.title)}"><header><div style="flex:1;min-width:0"><h1 style="font-size:17px;margin:0 0 2px">${esc(h.title)}</h1>${sub.map(s => `<div class="meta">${esc(s)}</div>`).join('')}${link ? `<div style="margin-top:2px">${link}</div>` : ''}</div>${closeX}</header><div class="body">
  ${ts.length ? `<div class="wptitle"><span>Your tasks</span><span>${ts.length}</span></div>` : ''}${boxes}${nothing}
  ${f ? wStands(f) + wDetails(f) + wMails(f) + `<details class="wsect"><summary>Notes</summary><div class="in">${noteBox(f, 'work')}</div></details>` : ''}
  </div></div>`;
}
function wStands(f) {
  const rows = tasksOf(f).filter(t => !t.archived && !t.parked && t.status !== 'Not needed').sort(wSort).map(t => {
    const s = done(t) ? ['done', '✓ Done', t.doneByName || nameOf(t.doneBy)] : isWaiting(t) ? ['', 'Starts ' + fmtS(t.opensOn), nameOf(t.assignee)] : t.assignee === forWho() ? ['ready', 'Ready', 'You'] : ['other', 'Waiting on ' + nameOf(t.assignee), ''];
    return `<div class="wtl"><span class="d ${s[0]}"></span><div>${esc(wShort(t))}${s[2] ? `<div class="meta">${esc(s[2])}</div>` : ''}</div><span class="pill ${s[0] === 'done' ? 'p-done' : s[0] === 'ready' ? 'p-ready' : 'p-wother'}">${esc(s[1])}</span></div>`;
  });
  wWaits(f).filter(x => x.k === 'wait').forEach(x => rows.push(`<div class="wtl"><span class="d wait"></span><div>${esc(x.n)}</div><span class="pill p-wwait">Waiting on ${esc(x.who)}</span></div>`));
  return `<details class="wsect"><summary>Where it stands</summary><div class="in">${rows.join('') || '<div class="meta">Nothing yet.</div>'}</div></details>`;
}
function wDetails(f) {
  const kv = [['Chicago name', f.name], ['Address', f.address], ['Corporate', f.group], ['Intake rep', nameOf(f.rep) || (autoPending(f) ? 'Picked at scheduling' : '')], ['Clinical rep', nameOf(f.clin)], ['Account manager', nameOf(acctOf(f))], ['Transition lead', nameOf(amOf(f))],
    ['Wound rep', f.wound && f.wound.name], ['Regional', f.regional && f.regional.name], ['Gentell WC Transition Lead', ctlSet(f) ? ctlShow(f) : ''], ['Areas of care', AREAS.filter(a => FG(f).cov[a]).map(a => a + ': ' + FG(f).cov[a]).join(' · ')],
    ['GDD', f.gdd ? f.gdd + (f.gddWh ? ' (' + f.gddWh + ')' : '') : ''], ['Why', f.why]].filter(x => x[1]);
  const files = (f.files || []).length ? `<div>Attachments</div><div>${f.files.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(', ')}</div>` : '';
  return `<details class="wsect"><summary>Details</summary><div class="in"><div class="kv">${kv.map(([a, b]) => `<div>${esc(a)}</div><div>${esc(b)}</div>`).join('')}${files}</div></div></details>`;
}
function wMails(f) {
  const ts = tasksOf(f), ms = st.mails.filter(m => (m.fac === f.id || (m.task && ts.some(t => t.key === m.task))) && m.status !== 'Cancelled').sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  const ins = st.inbox.filter(m => m.fac === f.id);
  const inRows = ins.map(m => `<div class="wmail"><span>${esc(m.subject)}<div class="meta">From ${esc(m.from)}</div></span><span>${esc((m.received || '').slice(0, 10))}${m.path ? ` · <a href="${esc(STORE.fileUrl(m.path))}" target="_blank" rel="noopener">Open</a>` : ''}</span></div>`).join('');
  const outRows = ms.map(m => `<div class="wmail"><span>${esc(m.subject)}</span><span>${mailPill(m)} ${esc(fmtS(m.day) || '')}</span></div>`).join('');
  return `<details class="wsect"><summary>Emails</summary><div class="in">${ins.length ? '<div class="wptitle"><span>Came in</span></div>' + inRows : ''}${ms.length ? '<div class="wptitle"><span>From the app</span></div>' + outRows : ''}${!ins.length && !ms.length ? '<div class="meta">None yet.</div>' : ''}</div></details>`;
}

// ---------- everyone else: quick cards grouped by task type ----------
const QUICK_HELP = {
  PUMPS: 'Check if GNS Chicago sent the facility pumps, and add any to "Pump Tracking" in the portal. ' + PUMP_RULE,
  GDD: 'Did the facility get orders from GDD? If yes, pick the warehouse.'
};
const wAge = t => bizCount(t.reopened || t.opensOn || t.created || st.today, st.today);
function quickWorkHtml(ts, all, flt) {
  const byType = {}; ts.forEach(t => (byType[t.type] = byType[t.type] || []).push(t));
  const oldest = arr => arr.sort((a, b) => wAge(b) - wAge(a) || (a.due < b.due ? -1 : 1));
  const secs = Object.entries(byType).map(([type, arr]) => [type, oldest(arr)]).sort((a, b) => (a[1].some(isCorpTask) ? 0 : 1) - (b[1].some(isCorpTask) ? 0 : 1) || wAge(b[1][0]) - wAge(a[1][0]));
  const doneToday = st.tasks.filter(t => ['PUMPS', 'GDD'].includes(t.type) && t.status === 'Done' && t.doneOn === st.today && t.doneBy === forWho() && t.assignee === forWho())
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const body = secs.map(([type, arr]) => wSec(WSHORT[type] || taskTitle(arr[0]).split(':')[0], arr.length, arr.map(qCard).join(''), QUICK_HELP[type])).join('');
  const dl = doneToday.length ? `<div class="wdonetoday"><div class="wptitle"><span>Done today</span><span>${doneToday.length}</span></div>${doneToday.map(t => { const x = qWhere(t); return `<div class="row1 ${ui.justDone === t.key ? 'flash' : ''}"><span><b>${esc(x.title)}</b> <span class="meta">${esc(t.type === 'GDD' ? 'GDD orders: ' + (facById(t.fac) || {}).gdd + ((facById(t.fac) || {}).gddWh ? ', ' + facById(t.fac).gddWh : '') : 'Pumps checked')}</span></span>${canReopen(t) ? `<button class="linkish" data-wundo="${esc(t.key)}">Undo</button>` : ''}</div>`; }).join('')}</div>` : '';
  return `<h1>My tasks</h1>${flt}${body || `<div class="wempty">${all.length ? 'No tasks match these filters.' : 'Nothing for you to do right now.'}</div>`}${dl}`;
}
function qWhere(t) {
  const f = t.fac ? facById(t.fac) : null, n = t.nf ? nfById(t.nf) : null;
  if (f) return { title: facName(f), lines: ['Chicago name: ' + f.name, f.group || 'Corporate not known yet'], d: f.dates };
  if (n) return { title: n.name, lines: ['New facility', n.group || ''].filter(Boolean), d: n.dates };
  return { title: t.group === '__nocorp' ? 'Corporate not known yet' : 'Corporate: ' + ((grp(t.group) || {}).name || t.group), lines: [], d: null };
}
function qCard(t) {
  const x = qWhere(t), age = wAge(t), late = st.today > t.due, f = t.fac ? facById(t.fac) : null;
  let act;
  if (t.type === 'PUMPS' && f) act = `<label class="chk wbig"><input type="checkbox" data-qpump="${esc(t.key)}" id="qp_${esc(t.key)}"><span>Checked, and added any pumps</span></label>`;
  else if (t.type === 'GDD' && f) {
    const yes = (ui.qGdd || {})[t.key];
    act = `<div class="wyn" role="group" aria-label="Did it get orders from GDD?"><button type="button" class="${yes ? 'on' : ''}" data-qgdd="${esc(t.key)}" data-v="Yes">Yes</button><button type="button" data-qgdd="${esc(t.key)}" data-v="No">No</button></div>${yes ? `<div class="field"><label for="qw_${esc(t.key)}">Which warehouse?</label><select id="qw_${esc(t.key)}"><option value="" disabled selected hidden>Pick one</option>${(st.settings.warehouses || []).map(w => `<option>${esc(w)}</option>`).join('')}</select></div><div><button type="button" class="btn pri sm" data-qgddsave="${esc(t.key)}">Save</button></div><div class="qerr" id="qe_${esc(t.key)}"></div>` : ''}`;
  } else act = `<div><button type="button" class="btn sm pri" data-task="${esc(t.key)}">Open</button></div>`;
  return `<div class="wqcard" data-qcard="${esc(t.key)}"><div><div class="wqh"><h3>${esc(x.title)}</h3><span class="wage ${late ? 'old' : ''}">${late ? 'Overdue' : age ? 'Waiting ' + age + (age === 1 ? ' day' : ' days') : 'New today'}</span></div>${x.lines.map(l => `<div class="wsub">${esc(l)}</div>`).join('')}${x.d ? `<div class="wsub">DOS ${fmtS(x.d.dos)}</div>` : ''}</div><div class="wqact">${act}</div></div>`;
}
// card answered: turns green for a moment, fades, then the save runs (the card is gone after the save)
async function qFinish(key, fn, label) {
  if (ui.busy) { toast('Still saving the last change…'); return; }
  const card = document.querySelector(`[data-qcard="${CSS.escape(key)}"]`);
  if (card) { card.classList.add('saved'); card.querySelectorAll('button,input,select').forEach(el => el.disabled = true); }
  await new Promise(r => setTimeout(r, 500));
  if (card) card.classList.add('leaving');
  const ok = await act(() => { const t = taskByKey(key); if (!t || done(t)) { toast('Someone already finished this one.'); return false; } return fn(t); });
  if (ok && !ui.errors.length) { ui.justDone = key; render(); toast('✓ Done: ' + label + '. Moved to Done today.'); }
  else if (card && card.isConnected) { card.classList.remove('saved', 'leaving'); card.querySelectorAll('button,input,select').forEach(el => el.disabled = false); const cb = card.querySelector('input[type=checkbox]'); if (cb) cb.checked = false; }
}

// ---------- clicks ----------
document.addEventListener('click', async e => {
  const T = e.target;
  if (T.closest('[data-wdone]')) { e.stopImmediatePropagation(); return; } // completed steps show on hover only (and the click doesn't open the card)
  const wc = T.closest('[data-work]'); if (wc && !T.closest('a,button:not([data-work])')) { ui.openWork = wc.dataset.work; ui.openTask = ui.openFac = ui.openGroup = ui.openNf = ui.next = null; ui.answer = null; ui.workSeen = null; renderLayer(); return; }
  const wo = T.closest('[data-wopen]'); if (wo) { ui.openTask = wo.dataset.wopen; ui.answer = null; renderLayer(); const b = document.querySelector('.wpanel .wbox:not(.closed)'); if (b) b.scrollIntoView({ block: 'nearest' }); return; }
  const qg = T.closest('[data-qgdd]'); if (qg) { const key = qg.dataset.qgdd, f0 = facById((taskByKey(key) || {}).fac);
    if (qg.dataset.v === 'Yes') { ui.qGdd = Object.assign(ui.qGdd || {}, { [key]: 1 }); render(); const s = document.getElementById('qw_' + key); if (s) s.focus(); return; }
    qg.classList.add('on'); delete (ui.qGdd || {})[key];
    await qFinish(key, t => { gddAnswer(facById(t.fac), 'No', ''); finishTask(t, me(), meName()); }, f0 ? facName(f0) : 'GDD'); return; }
  const qs = T.closest('[data-qgddsave]'); if (qs) { const key = qs.dataset.qgddsave, wh = V('qw_' + key), f0 = facById((taskByKey(key) || {}).fac);
    if (!wh) { const er = document.getElementById('qe_' + key); if (er) er.innerHTML = '<div class="err">Which warehouse?</div>'; return; }
    await qFinish(key, t => { gddAnswer(facById(t.fac), 'Yes', wh); finishTask(t, me(), meName()); }, f0 ? facName(f0) : 'GDD'); delete (ui.qGdd || {})[key]; return; }
  const un = T.closest('[data-wundo]'); if (un) { const key = un.dataset.wundo; let why = '';
    await act(() => { const t = taskByKey(key); why = reopenTask(t, '', me(), meName(), false, true); if (why) return false; }, 'Put back');
    if (why) toast(why); return; }
});
document.addEventListener('change', async e => {
  const p = e.target.closest && e.target.closest('[data-qpump]'); if (!p || !p.checked) return;
  const key = p.dataset.qpump, f0 = facById((taskByKey(key) || {}).fac);
  await qFinish(key, t => { if (!TT.PUMPS.quick(t, 'Checked')) return false; finishTask(t, me(), meName()); }, f0 ? facName(f0) : 'Pumps');
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.wcard[data-work]')) { e.preventDefault(); e.target.click(); } });

// ---------- first-time tour and "What's new" (each shown once per person, remembered in this browser) ----------
// To announce a big change: add { id, date, title, text } to the top of WHATS_NEW. Each person sees the newest one they haven't seen, once.
// Someone who hasn't had the tour yet gets the tour instead, and every note up to now counts as seen.
const WHATS_NEW = [];
const TOUR_ID = 'work-2026-11-17';
const TOURS = {
  lead: [
    { t: 'Welcome to My work', p: 'A quick look around. 6 steps.' },
    { sel: '.wsec:nth-of-type(1) .wsech', t: 'Ready for you', p: 'Facilities with something for you to do.', go: 'close' },
    { sel: '.wsec:nth-of-type(1) .wcard', t: 'Open a facility', p: 'Click a facility to open it on the side.', go: 'close' },
    { all: '.wpanel .wbox', t: 'All your tasks are here', p: 'Each task has its own box. Work top to bottom.', go: 'open' },
    { all: '.wpanel details.wsect', t: 'More about the facility', p: 'Click any section to open it.', go: 'open' },
    { sel: '.wsec:nth-of-type(1) .wdonebtn', t: 'Completed steps', p: 'Hover here to see what\'s done.', go: 'close' },
    { sel: '.wsec:nth-of-type(2) .wsech', t: 'Waiting on others', p: 'Nothing to do yet. It moves up when it\'s your turn.', go: 'close' }
  ],
  single: [{ t: 'My work was updated', p: 'You can now complete your tasks right from this screen.' }]
};
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return 'unavailable'; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { } };
let tour = null, tourEls = [];
function maybeIntro() {
  if (!workOn() || ui.view !== 'mytasks' || tour || ui.openWork || ui.openTask || ui.openFac || !me() || document.querySelector('.tour-tip')) return;
  const tk = 'ct_tour:' + TOUR_ID + ':' + me(), nk = 'ct_news:' + me();
  if (!lsGet(tk)) { lsSet(tk, '1'); if (WHATS_NEW[0]) lsSet(nk, WHATS_NEW[0].id); startTour(); return; }
  const n = WHATS_NEW[0]; if (n && lsGet(nk) !== n.id && lsGet(nk) !== 'unavailable') { lsSet(nk, n.id); showNews(n); }
}
function tourSteps() {
  if (!isLeadView()) return TOURS.single;
  // only the steps that have something to point at on this person's screen (a lead with nothing open gets the short version)
  return TOURS.lead.filter(s => {
    if (!s.sel && !s.all) return true;
    if (s.go === 'open') return !!document.querySelector('.wsec:nth-of-type(1) .wcard[data-work^="f"]'); // needs a facility (corporates have no sections)
    return !!document.querySelector(s.sel || s.all);
  });
}
function startTour() { const steps = tourSteps(); steps[0] = Object.assign({}, steps[0], { p: steps.length > 1 ? 'A quick look around. ' + (steps.length - 1) + ' step' + (steps.length > 2 ? 's' : '') + '.' : steps[0].p }); tour = { steps, i: 0, opened: false }; drawTour(); }
function endTour() {
  document.body.classList.remove('touring'); document.querySelectorAll('.tour-dim,.tour-spot,.tour-tip').forEach(x => x.remove());
  if (tour && tour.opened) { ui.openWork = ui.openTask = null; renderLayer(); }
  tour = null; tourEls = [];
}
function drawTour() {
  document.querySelectorAll('.tour-dim,.tour-spot,.tour-tip').forEach(x => x.remove());
  document.body.classList.add('touring');
  const s = tour.steps[tour.i], n = tour.steps.length - 1, last = tour.i === n;
  if (s.go === 'open') { const c = document.querySelector('.wsec:nth-of-type(1) .wcard[data-work^="f"]'); if (c && ui.openWork !== c.dataset.work) { ui.openWork = c.dataset.work; ui.openTask = null; ui.workSeen = null; renderLayer(); } tour.opened = true; }
  if (s.go === 'close' && ui.openWork && tour.opened) { ui.openWork = ui.openTask = null; renderLayer(); }
  const tip = document.createElement('div'); tip.className = 'tour-tip'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-label', s.t);
  const nav = n === 0 ? '<div class="tour-nav"><button type="button" class="btn pri" data-tour="next" id="tour_next">Got it</button></div>'
    : tour.i === 0 ? '<div class="tour-nav"><button type="button" class="tour-skip" data-tour="skip">Skip</button><button type="button" class="btn pri" data-tour="next" id="tour_next">Show me</button></div>'
    : `<div class="tour-nav"><span class="tour-step">${tour.i} of ${n}</span><span><button type="button" class="tour-skip" data-tour="skip">Skip</button> <button type="button" class="btn pri" data-tour="next" id="tour_next">${last ? 'Done' : 'Next'}</button></span></div>`;
  tip.innerHTML = `<h4>${esc(s.t)}</h4><p>${esc(s.p)}</p>${nav}`;
  tourEls = s.all ? [...document.querySelectorAll(s.all)] : s.sel ? [document.querySelector(s.sel)].filter(Boolean) : [];
  if (!tourEls.length) { const dim = document.createElement('div'); dim.className = 'tour-dim'; document.body.append(dim); tip.classList.add('center'); document.body.append(tip); tip.querySelector('#tour_next').focus(); return; }
  tourEls[0].scrollIntoView({ block: 'nearest' });
  const spot = document.createElement('div'); spot.className = 'tour-spot'; document.body.append(spot, tip);
  placeTour(); tip.querySelector('#tour_next').focus();
}
// measured again on every scroll and resize, so the highlight always fits what it points at
function placeTour() {
  const spot = document.querySelector('.tour-spot'), tip = document.querySelector('.tour-tip'); if (!spot || !tip || !tourEls.length) return;
  const rs = tourEls.filter(x => x.isConnected).map(x => x.getBoundingClientRect()).filter(r => r.width || r.height); if (!rs.length) return;
  const pad = 6, vw = document.documentElement.clientWidth, vh = innerHeight;
  const r = { left: Math.min(...rs.map(x => x.left)) - pad, top: Math.min(...rs.map(x => x.top)) - pad, right: Math.max(...rs.map(x => x.right)) + pad, bottom: Math.max(...rs.map(x => x.bottom)) + pad };
  Object.assign(spot.style, { left: r.left + 'px', top: r.top + 'px', width: (r.right - r.left) + 'px', height: (r.bottom - r.top) + 'px' });
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 12; let top, left;
  if (tourEls[0].closest('.wpanel') && r.left - gap - tw >= 16) { left = r.left - gap - tw; top = Math.min(Math.max(16, r.top), vh - th - 16); }
  else { top = r.bottom + gap + th <= vh - 16 ? r.bottom + gap : (r.top - gap - th >= 16 ? r.top - gap - th : Math.max(16, vh - th - 16)); left = Math.min(Math.max(16, r.left), vw - tw - 16); }
  tip.style.top = top + 'px'; tip.style.left = left + 'px';
}
function showNews(n) {
  const dim = document.createElement('div'); dim.className = 'tour-dim';
  const tip = document.createElement('div'); tip.className = 'tour-tip center news'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-label', 'What\'s new');
  tip.innerHTML = `<span class="newsdate">What's new · ${esc(n.date)}</span><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p><div class="tour-nav"><button type="button" class="btn pri" data-news>Got it</button></div>`;
  document.body.append(dim, tip); tip.querySelector('[data-news]').focus();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tour]');
  if (b) { e.stopPropagation(); if (!tour) return; if (b.dataset.tour === 'skip' || tour.i === tour.steps.length - 1) endTour(); else { tour.i++; drawTour(); } return; }
  if (e.target.closest('[data-news]')) { e.stopPropagation(); document.querySelectorAll('.tour-dim,.tour-tip.news').forEach(x => x.remove()); return; }
  if (tour && (e.target.closest('.tour-dim') || !e.target.closest('.tour-tip'))) { e.stopPropagation(); e.preventDefault(); } // the page underneath doesn't react while the tour is up
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tour) { e.stopPropagation(); endTour(); } }, true);
addEventListener('scroll', () => { if (tour) placeTour(); }, true);
addEventListener('resize', () => { if (tour) placeTour(); });
