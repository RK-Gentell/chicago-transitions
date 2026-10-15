'use strict';
/* =====================================================================
   Screens and clicks. Every change goes through act():
   reload the latest data → apply the change → run() → save → reload.
   ===================================================================== */

let STORE = null; // the store (demo or SharePoint)
const ui = { shots: {}, view: 'mytasks', openTask: null, openFac: null, openGroup: null, answer: null, sel: new Set(), busy: false, errors: [], forWho: null, trackerFilter: 'active', q: '', outFilter: 'active', dropped: [],
  allF: { lead: '', who: '', fac: '', corp: '' }, myF: { fac: '', corp: '', by: 'fac' }, doneSort: { k: 'on', dir: -1 }, doneAll: false,
  an: { tab: 'overview', lead: '', corp: null, step: null } };
const $ = s => document.querySelector(s);
const me = () => st.me.email;
const meName = () => st.me.name;
function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 3200); }
function setStatus(t, bad) { const e = $('#status'); if (e) { e.textContent = t; e.className = 'status' + (bad ? ' bad' : ''); } }

// ---------- start ----------
async function boot() {
  const demo = /[?&]demo\b/.test(location.search) || !CFG.clientId;
  STORE = demo ? DemoStore() : SPStore();
  try {
    const ok = await STORE.init();
    if (ok === false) return; // gone to the Microsoft sign-in page
    if (STORE.needsSetup) return renderSetup();
    // the first load includes archived rows, so completed facilities archived by older versions come back (run() un-archives them)
    await STORE.load({ archived: true });
    await settle();
    if (demo) { ui.view = 'new'; }
    readLink();
    render();
    if (!demo) setInterval(poll, 90 * 1000);
  } catch (e) { fatal(e); }
}
function fatal(e) {
  console.error(e);
  if (e.noAccess) {
    $('#sub').textContent = 'No access yet';
    $('#main').innerHTML = `<div class="center card"><h1>You don't have access yet</h1><p>You're signed in as <b>${esc(e.who || 'your Microsoft account')}</b>. The app keeps its data on the Chicago Transitions SharePoint site, and this account isn't a member of it yet.</p><p>Ask Raizy to add you. Once she does, refresh this page.</p><p class="meta">Signed in with the wrong account? <button class="linkish" id="signout_na" style="background:none;border:0;padding:0">Sign out</button> and sign in with your @gentell.com email.</p><button class="btn pri" onclick="location.reload()">Refresh</button></div>`;
    const so = document.getElementById('signout_na'); if (so) so.onclick = () => STORE.signOut();
    return;
  }
  $('#sub').textContent = 'Problem';
  $('#main').innerHTML = `<div class="center card"><h1>Something went wrong</h1><p class="err">${esc(e.message || e)}</p><p class="meta">Refresh the page. If it keeps happening, send Raizy a screenshot of this.</p><button class="btn pri" onclick="location.reload()">Refresh</button></div>`;
}
function renderSetup() {
  $('#sub').textContent = 'First-time setup';
  $('#main').innerHTML = `<div class="center card"><h1>Set up the lists</h1><p>The app didn't find its 4 SharePoint lists on <b>${esc(CFG.siteUrl)}</b>. Click below to create them (CT Data, CT Outbox, CT Inbox, CT Numbers). It takes about a minute and only happens once.</p><div id="setup_msg"></div><button class="btn pri" id="do_setup">Create the lists</button></div>`;
  $('#do_setup').onclick = async () => {
    $('#do_setup').disabled = true; $('#setup_msg').innerHTML = '<p class="meta">Creating…</p>';
    try { await STORE.setup(); location.reload(); }
    catch (e) { $('#setup_msg').innerHTML = `<p class="err">${esc(e.message)}</p><p class="meta">Most likely you're not an owner of the SharePoint site, or IT hasn't approved the app yet.</p>`; $('#do_setup').disabled = false; }
  };
}
// run the rules and save until nothing else changes
async function settle() {
  for (let i = 0; i < 3; i++) {
    run();
    const r = await STORE.save();
    if (!r.ok) { ui.errors = r.errors; break; }
    if (STORE.mode === 'demo') break;
    await STORE.load();
    if (!r.wrote) break;
  }
}
async function act(fn, okMsg) {
  if (ui.busy) { toast('Still saving the last change…'); return false; }
  ui.busy = true; setStatus('Saving…');
  try {
    await STORE.load();
    const r = await fn();
    if (r === false) { ui.busy = false; setStatus(''); return false; }
    ui.errors = [];
    await settle();
    ui.busy = false;
    setStatus(ui.errors.length ? 'Not saved' : 'Saved', !!ui.errors.length);
    render();
    if (okMsg && !ui.errors.length) toast(okMsg);
    return true;
  } catch (e) {
    ui.busy = false; console.error(e);
    ui.errors = [e.message || String(e)]; setStatus('Not saved', true);
    try { await STORE.load(); } catch (_) { }
    render(); return false;
  }
}
async function poll() {
  if (ui.busy || document.visibilityState !== 'visible' || ui.openTask || ui.openFac || ui.openGroup || ['new', 'settings'].includes(ui.view)) return;
  try { ui.busy = true; await STORE.load(); await settle(); ui.busy = false; render(); } catch (e) { ui.busy = false; console.error(e); }
}
function readLink() {
  const q = new URLSearchParams(location.search);
  if (q.get('task')) { const t = taskByKey(q.get('task')); if (t) { ui.openTask = t.key; ui.answer = q.get('answer'); } else toast('That task isn\'t open anymore.'); }
  if (q.get('fac')) { const f = facById(+q.get('fac')); if (f) ui.openFac = f.id; }
  if (q.get('view')) ui.view = q.get('view');
  if (q.toString() && STORE.mode !== 'demo') history.replaceState(null, '', location.pathname);
}

// ---------- lists used on screens ----------
const forWho = () => ui.forWho || me();
function openTasksFor(who) { return st.tasks.filter(t => t.assignee === who && !done(t) && !t.archived && !(t.fac && facById(t.fac) && facById(t.fac).hold)); }
const urg = t => [isWaiting(t) ? 1 : 0, t.due];
const cmp = (a, b) => { const x = urg(a), y = urg(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };
function waitingOn(f) {
  if (f.hold) return ['On hold'];
  if (f.complete) return [];
  const g = G(f), w = [];
  st.tasks.filter(t => !t.fac && f.group && lc(t.group) === lc(f.group) && !done(t)).forEach(t => w.push(taskTitle(t) + ' (' + nameOf(t.assignee) + ')'));
  if (hasPrice(g) && !f.inPortal && !fTask(f, 'PORTAL_ADD')) w.push('Add to Brightree (' + roleName('portal') + ')');
  if (f.email1 && !f.email2) w.push('Chicago’s transfer notice to the facility');
  if (f.email3 && !f.e3Done && !f.e3Reply) w.push('Reply to the in-service & contacts request (' + (e3Names(f).join(' / ') || 'wound rep / regional') + ')');
  if (f.email2 && !done(fTask(f, 'GDD'))) w.push('GDD answer (' + roleName('gdd') + ')');
  return w;
}
// by = 'fac' (a block per facility; corporate tasks get their own block) or 'corp' (a block per corporate)
// facOk(f): which facilities to list under allFacs (the ones with nothing to do right now)
function groupedTasks(ts, showWho, allFacs, facOk, by) {
  if (by === 'corp') return corpBlocks(ts, showWho);
  const g = {}; ts.forEach(t => { const k = t.fac ? 'f' + t.fac : 'g' + t.group; (g[k] = g[k] || []).push(t); });
  const blocks = Object.entries(g).map(([k, arr]) => [k, arr.sort(cmp)]).sort((a, b) => cmp(a[1][0], b[1][0]));
  let html = blocks.map(([k, arr]) => blockHtml(k, arr, showWho)).join('');
  if (allFacs) html += st.facs.filter(f => !f.complete && !f.archived && !g['f' + f.id] && (!facOk || facOk(f))).map(f => { const [s2, c2] = stageOf(f); const w = waitingOn(f); return `<div class="fgroup"><div class="fhead"><b class="linkish" data-fac="${f.id}">${esc(facName(f))}</b><span class="meta">${esc(f.group)}</span><span class="pill ${c2}">${s2}</span></div><div class="instr">Nothing to do on this facility right now.${w.length ? ' Waiting on: ' + w.map(esc).join(' · ') : ''}</div></div>`; }).join('');
  return html;
}
const corpKey = t => { const f = t.fac ? facById(t.fac) : null; return lc(f ? (f.group || '__nocorp') : t.group); };
function corpBlocks(ts, showWho) {
  const g = {}; ts.forEach(t => { const k = corpKey(t); (g[k] = g[k] || []).push(t); });
  return Object.entries(g).map(([k, arr]) => [k, arr.sort(cmp)]).sort((a, b) => cmp(a[1][0], b[1][0])).map(([k, arr]) => {
    const gr = grp(k), name = k === '__nocorp' ? 'No corporate yet' : (gr ? gr.name : arr[0].group || k), nf = new Set(arr.filter(t => t.fac).map(t => t.fac)).size;
    return `<div class="fgroup"><div class="fhead"><b>${esc(name)}</b><span class="meta">${nf ? nf + ' facilit' + (nf > 1 ? 'ies' : 'y') : 'whole corporate'}</span><span class="meta" style="margin-left:auto">${arr.length} task${arr.length > 1 ? 's' : ''}</span></div>${arr.map(t => taskLine(t, showWho, true)).join('')}</div>`;
  }).join('');
}
// the transition lead(s) running a task: the facility's, or for a corporate task the corporate's and its facilities'
function taskLeads(t) {
  if (t.fac) { const f = facById(t.fac); return f ? [amOf(f)] : []; }
  const g = grp(t.group); return [...new Set([g && g.am, ...(g ? facsOfGroup(g.name).map(amOf) : [])].filter(Boolean))];
}
// "Send reminder" (transition leads and admins), on "All open tasks" and in the task. Never 2 reminders within 24 hours.
const mayRemind = t => (isAm(me()) || isAdmin(me())) && t.assignee && t.assignee !== me() && !done(t) && !isWaiting(t);
function remindBtn(t) {
  if (!mayRemind(t)) return '';
  if (canRemind(t)) return `<button class="btn sm remind" data-remind="${esc(t.key)}" title="Emails ${esc(nameOf(t.assignee))} a reminder now">Send reminder</button>`;
  const l = lastReminder(t);
  return `<div class="remind-wait" title="Next reminder possible ${esc(whenET(nextReminderAt(t)))}">Reminded ${l ? esc(whenET(remAt(l))) : ''}</div>`;
}
const facLink = f => `<a class="linkish faclink" href="?${STORE && STORE.mode === 'demo' ? 'demo&' : ''}fac=${f.id}" data-facpage="${f.id}">Facility page</a>`;
function blockHtml(k, arr, showWho) {
  const f = k[0] === 'f' ? facById(+k.slice(1)) : null; const [s, c] = f ? stageOf(f) : ['Corporate task', 'p-req'];
  const w = f ? waitingOn(f) : [];
  return `<div class="fgroup"><div class="fhead"><b ${f ? `class="linkish" data-fac="${f.id}"` : ''}>${esc(f ? facName(f) : (arr[0].group === '__nocorp' ? 'No corporate yet' : arr[0].group))}</b><span class="meta">${f ? esc(f.group || 'corporate not known yet') : 'whole corporate'}</span><span class="pill ${c}">${s}</span>${f && atRisk(f) ? '<span class="pill p-risk">At risk</span>' : ''}<span class="meta" style="margin-left:auto">${arr.length} task${arr.length > 1 ? 's' : ''}</span></div>${arr.map(t => taskLine(t, showWho)).join('')}${w.length ? `<div class="meta" style="padding-left:4px">Also waiting on: ${w.map(esc).join(' · ')}</div>` : ''}</div>`;
}
function taskLine(t, showWho, showFac) {
  const f = t.fac ? facById(t.fac) : null, wait = isWaiting(t), over = !wait && st.today > t.due;
  const where = f ? (showFac ? esc(facName(f)) : esc(f.group)) : esc(t.group === '__nocorp' ? '' : (showFac ? 'Whole corporate' : t.group));
  return `<div class="task ${wait ? 'wait' : ''} ${over ? 'over' : ''}" data-task="${esc(t.key)}" tabindex="0"><div style="min-width:0"><div class="t">${esc(taskTitle(t))}</div><div class="m">${where}${showWho ? ' · <b>' + esc(nameOf(t.assignee)) + '</b>' : ''}${f ? ' · ' + facLink(f) : ''}</div></div><div class="r">${wait ? '<span class="pill p-chi">Starts ' + fmtS(t.opensOn) + '</span>' : over ? '<span class="pill p-hold">Overdue</span>' : ''}<div>Due ${fmtS(t.due)}</div>${showWho ? remindBtn(t) : ''}</div></div>`;
}

// ---------- page ----------
function render() {
  const admin = isAdmin(me()), demo = STORE.mode === 'demo';
  $('#sub').textContent = demo ? 'Demo · nothing is sent · today ' + fmt(st.today) : meName();
  $('#topctl').innerHTML = (demo ? `<label for="who">Viewing as</label><select id="who">${people().map(p => `<option value="${esc(lc(p.email))}" ${lc(p.email) === me() ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><span class="day">${fmt(st.today)}</span><button class="btn" id="nextDay" title="Moves the demo to the next business day. Scheduled emails go out.">Next business day ▸</button><button class="btn" id="reset">Reset demo</button>` : '') + `<span class="status" id="status"></span>${demo ? '' : '<button class="btn sm" id="refresh" title="Get the latest">↻ Refresh</button><button class="btn sm" id="signout">Sign out</button>'}`;
  // banners
  const b = [];
  if (ui.errors.length) b.push(`<div class="banner bad"><b>Not saved.</b> ${ui.errors.map(esc).join(' · ')} <button class="linkish" id="reload">Reload and try again</button></div>`);
  if (STORE.warning) b.push(`<div class="banner warn">${esc(STORE.warning)}</div>`);
  const probs = settingsProblems();
  if (probs.length) b.push(`<div class="banner warn"><b>Setup isn't finished.</b> ${admin ? 'Open <button class="linkish" data-view="settings">Settings</button>: ' + probs.map(esc).join(' ') : 'Raizy is still filling in Settings, so emails may not go out yet.'}</div>`);
  const failed = st.mails.filter(m => m.status === 'Failed').length;
  if (failed && admin) b.push(`<div class="banner bad"><b>${failed} email${failed > 1 ? 's' : ''} failed.</b> <button class="linkish" data-view="outbox" data-outfilter="Failed">Open the Outbox</button> to see why and retry.</div>`);
  $('#banners').innerHTML = b.join('');
  // nav
  const mine = openTasksFor(forWho()).filter(t => !isWaiting(t)).length;
  const open = st.tasks.filter(t => !done(t) && !t.archived).length;
  const nav = [['mytasks', 'My tasks', mine], ['tracker', 'Tracker', st.facs.filter(f => !f.complete).length], ['all', 'All open tasks', open], ['groups', 'Corporates', Object.keys(st.groups).length], ['analytics', 'Analytics', ''], ['sep'], ['inbox', 'Mailbox', st.inbox.length], ['outbox', 'Outbox', st.mails.filter(m => m.status === 'Queued').length || ''], ...(admin ? [['settings', 'Settings', '']] : []), ['sep'], ['new', '+ New transition request', '']];
  $('#nav').innerHTML = nav.map(n => n[0] === 'sep' ? '<div class="sep"></div>' : `<button class="${ui.view === n[0] ? 'on' : ''}" data-view="${n[0]}"><span>${n[1]}</span><span class="count">${n[2]}</span></button>`).join('');
  const m = $('#main');
  if (ui.view === 'mytasks') {
    const all = openTasksFor(forWho()), F = ui.myF;
    const ts = all.filter(t => (!F.fac || t.fac === +F.fac) && (!F.corp || corpKey(t) === F.corp));
    const who = admin && !demo ? `<label class="meta" for="forwho">Show tasks for</label><select id="forwho">${[...new Set([me(), ...people().map(p => lc(p.email)).filter(Boolean)])].map(e => `<option value="${esc(e)}" ${e === forWho() ? 'selected' : ''}>${esc(nameOf(e))}${e === me() ? ' (me)' : ''}</option>`).join('')}</select>` : '';
    const flt = `<div class="filters">${who}${facSel('mt_fac', all, F.fac)}${corpSel('mt_corp', all, F.corp)}<span class="meta" style="margin-left:6px">Group by</span><div class="seg" role="group">${[['fac', 'Facility'], ['corp', 'Corporate']].map(([v, l]) => `<button type="button" class="segb ${F.by === v ? 'on' : ''}" data-mtby="${v}" aria-pressed="${F.by === v}">${l}</button>`).join('')}</div>${F.fac || F.corp ? '<button class="btn sm" data-clearf="my">Clear filters</button>' : ''}</div>`;
    m.innerHTML = `<h1>My tasks</h1><p class="sub">${forWho() === me() ? 'Your' : esc(nameOf(forWho())) + '\'s'} open tasks, grouped by ${F.by === 'corp' ? 'corporate' : 'facility'}, most urgent first. Click one to do it. Each one also came by email.</p>${flt}<div class="list">${groupedTasks(ts, false, false, null, F.by) || `<div class="empty">${all.length ? 'No tasks match these filters.' : 'Nothing to do right now.'}</div>`}</div>`;
  } else if (ui.view === 'all') {
    const all = st.tasks.filter(t => !done(t) && !t.archived && !(t.fac && facById(t.fac) && facById(t.fac).hold)), F = ui.allF;
    const ts = all.filter(t => (!F.who || t.assignee === F.who) && (!F.lead || taskLeads(t).includes(F.lead)) && (!F.fac || t.fac === +F.fac) && (!F.corp || corpKey(t) === F.corp));
    // facilities with nothing to do: only when no person filter is set (they have no tasks for anyone)
    const facOk = F.who ? () => false : f => (!F.lead || amOf(f) === F.lead) && (!F.fac || f.id === +F.fac) && (!F.corp || lc(f.group || '__nocorp') === F.corp);
    const leads = [...new Set([...all.flatMap(taskLeads), ...st.facs.filter(f => !f.complete && !f.archived).map(amOf)].filter(Boolean))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const whos = [...new Set(all.map(t => t.assignee).filter(Boolean))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const open = st.facs.filter(f => !f.complete && !f.archived && !f.hold);
    const flt = `<div class="filters"><select id="at_lead" aria-label="Transition lead"><option value="">All transition leads</option>${leads.map(e => `<option value="${esc(e)}" ${e === F.lead ? 'selected' : ''}>${esc(nameOf(e))}</option>`).join('')}</select><select id="at_who" aria-label="Assigned to"><option value="">Anyone's tasks</option>${whos.map(e => `<option value="${esc(e)}" ${e === F.who ? 'selected' : ''}>${esc(nameOf(e))}${e === me() ? ' (me)' : ''}</option>`).join('')}</select>${facSel('at_fac', all, F.fac, open)}${corpSel('at_corp', all, F.corp, open)}${F.lead || F.who || F.fac || F.corp ? '<button class="btn sm" data-clearf="all">Clear filters</button>' : ''}<span class="meta">${ts.length} of ${all.length} tasks</span></div>`;
    m.innerHTML = `<h1>All open tasks</h1><p class="sub">Anyone can open anyone's task and finish it. The app records who actually did it, and the person it was assigned to gets an FYI email. "Transition lead" shows every task on the facilities they run, whoever it's assigned to.</p>${flt}<div class="list">${groupedTasks(ts, true, true, facOk) || '<div class="empty">No open tasks match.</div>'}</div>${doneTable()}`;
  } else if (ui.view === 'analytics') { m.innerHTML = analyticsHtml(); analyticsAfter();
  } else if (ui.view === 'tracker') m.innerHTML = trackerHtml();
  else if (ui.view === 'groups') m.innerHTML = groupsHtml();
  else if (ui.view === 'inbox') m.innerHTML = inboxHtml();
  else if (ui.view === 'outbox') m.innerHTML = outboxHtml();
  else if (ui.view === 'settings') m.innerHTML = admin ? settingsHtml() : '<div class="empty">Only admins can change settings.</div>';
  else if (ui.view === 'new') { m.innerHTML = requestHtml(); corpInfo(); }
  renderLayer();
}
// filter dropdowns: facilities / corporates that have tasks in the list (plus any extra facilities passed in)
function facSel(id, ts, v, extra) {
  const ids = [...new Set([...ts.map(t => t.fac).filter(Boolean), ...(extra || []).map(f => f.id)])].map(facById).filter(Boolean).sort((a, b) => facName(a).localeCompare(facName(b)));
  return `<select id="${id}" aria-label="Facility"><option value="">All facilities</option>${ids.map(f => `<option value="${f.id}" ${String(f.id) === String(v) ? 'selected' : ''}>${esc(facName(f))}</option>`).join('')}</select>`;
}
function corpSel(id, ts, v, extra) {
  const ks = [...new Set([...ts.map(corpKey), ...(extra || []).map(f => lc(f.group || '__nocorp'))])].filter(Boolean);
  const label = k => k === '__nocorp' ? 'No corporate yet' : (grp(k) ? grp(k).name : k);
  return `<select id="${id}" aria-label="Corporate"><option value="">All corporates</option>${ks.sort((a, b) => label(a).localeCompare(label(b))).map(k => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(label(k))}</option>`).join('')}</select>`;
}
// sortable by task, assigned to, done by, date; newest first by default
const DONE_COLS = [['task', 'Task', t => taskTitle(t)], ['fac', 'Facility', t => { const f = t.fac && facById(t.fac); return f ? facName(f) : ''; }], ['who', 'Assigned to', t => nameOf(t.assignee)], ['by', 'Done by', t => t.doneByName || nameOf(t.doneBy)], ['on', 'On', t => t.doneOn || '']];
function doneTable() {
  const all = st.tasks.filter(t => t.status === 'Done' && !t.archived);
  if (!all.length) return '';
  const S = ui.doneSort, col = DONE_COLS.find(c => c[0] === S.k) || DONE_COLS[4], idx = new Map(st.tasks.map((t, i) => [t, i]));
  const ts = all.slice().sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * S.dir || (b.doneOn || '').localeCompare(a.doneOn || '') || idx.get(b) - idx.get(a); });
  const shown = ui.doneAll ? ts : ts.slice(0, 25);
  const th = ([k, l]) => `<th aria-sort="${S.k === k ? (S.dir > 0 ? 'ascending' : 'descending') : 'none'}">${k === 'fac' ? l : `<button class="thsort" data-donesort="${k}">${l}${S.k === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</button>`}</th>`;
  return `<h2>Recently done <span class="meta">${all.length}</span></h2><div class="tablewrap"><table><tr>${DONE_COLS.map(th).join('')}</tr>${shown.map(t => { const f = t.fac && facById(t.fac); return `<tr class="click" data-task="${esc(t.key)}"><td>${esc(taskTitle(t))}</td><td>${f ? facLink(f).replace('Facility page', esc(facName(f))) : '<span class="meta">' + esc(t.group === '__nocorp' ? '' : t.group) + '</span>'}</td><td>${esc(nameOf(t.assignee))}</td><td>${t.doneBy !== t.assignee ? '<b>' + esc(t.doneByName || nameOf(t.doneBy)) + '</b>' : esc(t.doneByName || nameOf(t.doneBy))}</td><td class="num">${fmtS(t.doneOn)}</td></tr>`; }).join('')}</table></div>${ts.length > 25 ? `<div style="margin-top:8px"><button class="btn sm" data-doneall>${ui.doneAll ? 'Show the latest 25' : 'Show all ' + ts.length}</button></div>` : ''}`;
}
function trackerHtml() {
  const q = lc(ui.q), F = ui.trackerFilter;
  const fs = st.facs.filter(f => !f.deleted && (F === 'all' || (F === 'active' && !f.complete && !f.hold) || (F === 'complete' && f.complete) || (F === 'hold' && f.hold)) && (!q || lc(facName(f) + ' ' + f.name + ' ' + f.group + ' CT-' + pad(f.id)).includes(q)));
  const R = peopleOpts(repList()), A = peopleOpts(amList());
  return `<h1>Tracker</h1><p class="sub">Replaces both Chicago tabs on the sheet. Click a row for the facility page. Tick rows to change the rep, transition lead or stage for all of them at once.</p>
  <div class="filters"><input type="text" id="tq" placeholder="Search facility, corporate, CT number" value="${esc(ui.q)}">${[['active', 'Active'], ['hold', 'On hold'], ['complete', 'Complete'], ['all', 'All']].map(([v, l]) => `<button class="btn sm ${F === v ? 'pri' : ''}" data-tfilter="${v}">${l}</button>`).join('')}<button class="btn sm" id="csv">Download as Excel (CSV)</button></div>
  <div class="bulk"><span class="meta">${ui.sel.size} selected</span><select id="bk_rep"><option value="">Set intake rep…</option>${R.map(r => `<option value="${esc(r[0])}">${esc(r[1])}</option>`).join('')}</select><select id="bk_am"><option value="">Set transition lead…</option>${A.map(r => `<option value="${esc(r[0])}">${esc(r[1])}</option>`).join('')}</select><button class="btn sm" id="bk_go">Apply to selected</button><select id="bk_hold"><option value="">Stage…</option><option>On hold</option><option>Take off hold</option></select><button class="btn sm" id="bk_hgo">Apply</button></div>
  <div class="tablewrap"><table><tr><th></th><th>CT</th><th>Facility</th><th>Corporate</th><th>Stage</th><th>Intake rep</th><th>Account manager</th><th>Transition lead</th><th>First DOS</th><th>Ordering</th><th>Delivery</th></tr>${fs.map(f => { const [s, c] = stageOf(f); return `<tr class="click" data-fac="${f.id}"><td><input type="checkbox" data-selfac="${f.id}" ${ui.sel.has(f.id) ? 'checked' : ''} aria-label="select"></td><td class="num">${pad(f.id)}</td><td><b>${esc(facName(f))}</b></td><td>${esc(f.group)}</td><td><span class="pill ${c}">${s}</span>${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</td><td>${esc(nameOf(f.rep)) || '<span class="meta">none</span>'}</td><td>${esc(nameOf(acctOf(f)))}</td><td>${esc(nameOf(amOf(f)))}</td><td class="num">${f.dates ? fmtS(f.dates.dos) : ''}</td><td class="num">${f.dates ? fmtS(f.dates.ord) : ''}</td><td class="num">${f.dates ? fmtS(f.dates.del) : ''}</td></tr>`; }).join('') || '<tr><td colspan="11" class="meta">No facilities here.</td></tr>'}</table></div>`;
}
function trackerCsv() {
  const rows = [['CT', 'Facility (portal)', 'Facility (sheet)', 'Corporate', 'Stage', 'Intake rep', 'Clinical rep', 'Account manager', 'Transition lead', 'First DOS', 'Ordering', 'Delivery', 'Chicago handoff email', 'Transfer notice to facility', 'In-service & contacts request', 'In-service & contacts done', 'GDD', 'Requested']];
  st.facs.forEach(f => rows.push(['CT-' + pad(f.id), facName(f), f.name, f.group, stageOf(f)[0], nameOf(f.rep), nameOf(f.clin), nameOf(acctOf(f)), nameOf(amOf(f)), f.dates ? fmtS(f.dates.dos) : '', f.dates ? fmtS(f.dates.ord) : '', f.dates ? fmtS(f.dates.del) : '', fmtS(f.email1), fmtS(f.email2), fmtS(f.email3), fmtS(f.e3Done), f.gdd ? f.gdd + (f.gddWh ? ' (' + f.gddWh + ')' : '') : '', fmtS(f.requested)]));
  const csv = rows.map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'Chicago transitions ' + st.today + '.csv'; a.click();
}
function groupsHtml() {
  const gs = Object.values(st.groups).sort((a, b) => a.name.localeCompare(b.name));
  return `<h1>Corporates</h1><p class="sub">Corporate info is entered once. Every facility under it picks it up. Click "Edit" to change anything.</p><div class="list">${gs.map(g => `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><b>${esc(g.name)}${g.standalone ? '<span class="tag">standalone</span>' : ''}</b><span class="meta">${facsOfGroup(g.name).length} facilities</span></div><div class="kv" style="margin-top:8px"><div>Rep rule</div><div>${g.rep ? esc(nameOf(g.rep)) + ' / clinical ' + esc(nameOf(g.clin)) + (g.acct ? ' / account manager ' + esc(nameOf(g.acct)) : '') + ' / transition lead ' + esc(nameOf(g.am)) : '<span class="meta">none</span>'}</div><div>Areas of care</div><div>${covKnown(g) ? AREAS.map(a => a + ': ' + g.cov[a]).join('; ') : '<span class="meta">missing</span>'}</div><div>Price table</div><div>${esc(g.price) || '<span class="meta">missing</span>'}</div><div>Corporate contacts</div><div>${(g.contacts || []).map(c => esc((c.first + ' ' + c.last).trim() + ' (' + c.dept + ') ' + c.email)).join('<br>') || '<span class="meta">none</span>'}</div><div>EMR login</div><div>${esc(g.emr) || '<span class="meta">none yet</span>'}</div><div>Corporate note</div><div>${g.noteDone ? 'Done' : 'Not yet'}</div></div><div class="row" style="margin-top:10px;align-items:center"><select data-copysrc="${esc(g.name)}"><option value="">Copy from corporate…</option>${gs.filter(x => x !== g).map(x => `<option>${esc(x.name)}</option>`).join('')}</select><button class="btn sm" data-copy="${esc(g.name)}">Copy areas of care, price table, rep rule, account manager, transition lead</button><button class="btn sm pri" data-editgrp="${esc(g.name)}" style="margin-left:auto">Edit</button></div></div>`).join('') || '<div class="empty">No corporates yet. They\'re added by requests.</div>'}</div>`;
}
function inboxHtml() {
  const facOpts = st.facs.filter(f => !f.archived).map(f => [String(f.id), facName(f)]);
  return `<h1>Mailbox</h1><p class="sub">Emails that came into ${esc(CFG.mailbox)} in the last ${INBOX_DAYS} days, newest first. The app matches them to a facility by the [CT-0000] number or the facility name in the subject. Not matched? Pick the facility.</p><div class="tablewrap"><table><tr><th>Received</th><th>From</th><th>Subject</th><th>Facility</th><th></th></tr>${st.inbox.map(m => `<tr><td class="num">${esc((m.received || '').slice(0, 10))}</td><td>${esc(m.from)}</td><td>${esc(m.subject)}${m.isEmail2 ? ' <span class="pill p-sent">Transfer notice</span>' : ''}${m.isE3Reply ? ' <span class="pill p-sent">In-service & contacts reply</span>' : ''}<div class="meta">${esc((m.preview || '').slice(0, 160))}</div></td><td>${m.fac && facById(m.fac) ? `<span class="linkish" data-fac="${m.fac}">${esc(facName(facById(m.fac)))}</span>` : `<select data-linkin="${m._id}"><option value="">Pick a facility…</option>${facOpts.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select>`}</td><td>${m.path ? `<a href="${esc(STORE.fileUrl(m.path))}" target="_blank" rel="noopener">Open email</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Nothing yet.</td></tr>'}</table></div>`;
}
const mailPill = m => m.status === 'Sent' ? '<span class="pill p-sent">Sent</span>' : m.status === 'Failed' ? '<span class="pill p-hold">Failed</span>' : m.status === 'Cancelled' ? '<span class="pill p-req">Cancelled</span>' : m.day > st.today ? '<span class="pill p-chi">Scheduled</span>' : '<span class="pill p-setup">Sending</span>';
// emails show the contacts screenshot as an attachment (cid:); in the app, point it at the file instead
const shotSrc = (x, name, path) => { const f = x.fac && facById(x.fac), mine = f && [f.contactsShot, f.corpShot].find(s => s && s.name === name); return (x.code === 'TEST' && ui.testData && ui.testData[name]) || (mine && mine.data) || STORE.fileUrl(path); };
const mailBody = x => [[x.attachName, x.attachPath], [x.attachName2, x.attachPath2]].filter(([n]) => n).reduce((b, [n, p]) => b.split('cid:' + n).join(esc(shotSrc(x, n, p))), x.body);
function mailHtml(x, admin) {
  return `<details class="mail"><summary><span class="code">${esc(x.code)}</span><span class="subj">${esc(x.subject)}</span><span class="meta num">${x.importance === 'High' ? '<span class="pill p-hold">High</span> ' : ''}${mailPill(x)} ${fmtS(x.day)}</span></summary><div class="hdr"><span>To</span><span>${esc(x.to.join('; '))}</span>${x.cc.length ? `<span>CC</span><span>${esc(x.cc.join('; '))}</span>` : ''}${x.error ? `<span>Note</span><span class="err">${esc(x.error)}</span>` : ''}</div><div class="mailbody">${mailBody(x)}</div>${admin && (x.status === 'Failed' || x.status === 'Cancelled') ? `<div class="mailbtns" style="flex-direction:column;align-items:stretch"><div class="row">${fld('To (fix it here if it\'s wrong; separate with ;)', `<input type="text" data-rto="${esc(x.key)}" value="${esc(x.to.join('; '))}">`)}${fld('CC', `<input type="text" data-rcc="${esc(x.key)}" value="${esc(x.cc.join('; '))}">`)}</div><div><button class="btn sm pri" data-retry="${esc(x.key)}">Send it again</button></div></div>` : ''}${admin && x.status === 'Queued' ? `<div class="mailbtns"><button class="btn sm" data-cancelmail="${esc(x.key)}">Don't send</button></div>` : ''}</details>`;
}
// Cancelled emails never show. Scheduled ones (not sent yet) get their own section.
function mailSections(ms, admin, h) {
  const live = ms.filter(m => m.status !== 'Cancelled');
  const parts = [
    ['Failed', live.filter(m => m.status === 'Failed')],
    ['Going out now', live.filter(m => m.status === 'Queued' && m.day <= st.today)],
    ['Sent', live.filter(m => m.status === 'Sent')],
    ['Scheduled (not sent yet)', live.filter(m => m.status === 'Queued' && m.day > st.today).sort((x, y) => x.day.localeCompare(y.day))]
  ].filter(p => p[1].length);
  return parts.map(([t, list]) => `<${h} class="mailsec">${t} <span class="meta">${list.length}</span>${admin && t === 'Failed' && list.length > 1 ? ` <button class="btn sm pri" data-retryall="${esc(list.map(m => m.key).join('|'))}">Send all ${list.length} again</button>` : ''}</${h}><div class="list">${list.map(m => mailHtml(m, admin)).join('')}</div>`).join('') || '<div class="empty">Nothing here.</div>';
}
function outboxHtml() {
  return `<h1>Outbox</h1><p class="sub">Every email the app sent or will send (last ${OUTBOX_DAYS} days). The "CT - Send emails" flow sends them from ${esc(CFG.mailbox)} within about 5 minutes; scheduled ones go out early that morning (7 or 8 am Eastern). Scheduled ones that aren't needed anymore (the task got done first) are dropped automatically.</p>${mailSections(st.mails, isAdmin(me()), 'h2')}`;
}

// ---------- new request ----------
function requestHtml() {
  const demo = STORE.mode === 'demo';
  return `<h1>New transition request</h1><p class="sub">${demo ? 'Filled with a demo request. Change anything. ' : ''}Everything else is automatic: each person gets an email for their part.</p><form id="rq" class="card rqform">
    <section><h2 class="rqh">Facilities being transferred${tip('Address and corporate are optional. No corporate or "?" = don\'t know yet (it goes on the transition lead\'s FastCare task). "none" = no corporate. Spaces around the semicolons are ignored. The state comes from the 2 letters before the zip.')}</h2>
      <div class="rqi">One per line: <span class="q">Name; full address; corporate</span></div>
      <textarea id="rq_fac" aria-label="Facilities being transferred" style="min-height:90px">${demo ? 'Waters Of Lagrange; 123 Demo St, LaGrange, IN 46761; Infinity Healthcare Management\nWaters Of Princeton; 456 Demo Ave, Princeton, IN 47670; Infinity Healthcare Management' : ''}</textarea><div id="rq_corpinfo" class="note"></div></section>
    <section><h2 class="rqh">Reason for transition</h2><textarea id="rq_why" class="plain" aria-label="Reason for transition">${demo ? 'Infinity is moving its Indiana buildings to Lakewood. Chicago already knows (demo).' : ''}</textarea></section>
    <section><h2 class="rqh">Areas of care${tip('Leave "Not sure" and the app asks you later.')}</h2><div class="areas">${AREAS.map(a => fld(a, sel('rq_' + a, [...covOpts(a), 'Not sure'], 'Not sure', true))).join('')}</div></section>
    <section><h2 class="rqh">GNS Lakewood roles${tip('All optional. No intake rep: the corporate rule, or ' + esc(roleName('rules')) + ' picks one. The account manager gets copied on the emails the intake rep gets. The transition lead runs this transition: gets the tasks and emails.')}</h2>
      <div class="row">${fld('Intake rep', sel('rq_rep', peopleOpts(repList()), '', true))}${fld('Account manager', sel('rq_acct', peopleOpts(repList()), '', true))}${fld('Transition lead', sel('rq_am', peopleOpts(amList()), '', true))}</div></section>
    <section><h2 class="rqh">Contacts${tip('Optional. Only if you have them.')}</h2>
      <div class="row"><button type="button" class="btn sm" data-showce="rq_corpbox">+ Add corporate contact</button><button type="button" class="btn sm" data-showce="rq_fctsbox">+ Add facility contact</button></div>
      <div class="field" id="rq_corpbox" hidden><label>Corporate contacts</label>${contactEditor('rq_corp', 'Corporate', false)}<div class="hint">Put first the person we ask for things, like adding a facility to their EMR login. Not needed if the corporate already has contacts in the app.</div></div>
      <div class="field" id="rq_fctsbox" hidden><label>Facility contacts</label>${contactEditor('rq_fcts', '', true)}<div class="hint">Several facilities? Type the facility name in the first box. Leave it blank for all of them.</div></div></section>
    <section><details class="rqd" id="rq_pre"><summary><h2 class="rqh">Already done${tip('Tick anything that\'s already taken care of, for every facility on this request. The app skips those tasks. Info that usually comes from a skipped task (like an EMR username or dates) stays blank.')}<span class="meta" id="rq_precount"></span></h2></summary>
      <div class="predone">${PRE_ITEMS.map(([k, l, h]) => chk('rq_pre_' + k, esc(l) + (h ? tip(esc(h)) : ''))).join('')}</div></details></section>
    <section><h2 class="rqh">Attachments${tip('PDFs, docs, or emails you saved from Outlook first. Saved in SharePoint, in a folder for this request. Linked on every task.')}</h2>
      <div class="drop" id="rq_drop" tabindex="0"><b>Drag files here</b> or <label class="linkish" for="rq_files">browse</label><input type="file" id="rq_files" multiple hidden></div><div class="rqi" style="margin-top:6px">Emails: forward them to <span class="q">${esc(CFG.mailbox)}</span> with the facility name in the subject. They show up on the facility page under "Mailbox".</div><div id="rq_list" class="meta">${ui.dropped.map(f => esc(f.name)).join(', ')}</div></section>
    <div id="rq_err"></div><div><button class="btn pri" type="submit">Submit request</button></div></form>`;
}
// under the facilities box: which corporates are new to the app (catches typos)
function corpInfo() {
  const box = $('#rq_corpinfo'); if (!box) return;
  const names = [...new Set(V('rq_fac').split('\n').map(l => (l.split(';')[2] || '').trim()).filter(c => c && c !== '?' && !/^(none|no corporate|standalone)$/i.test(c)))];
  box.innerHTML = names.map(n => grp(n) ? `<b>${esc(grp(n).name)}</b>: already in the app` : `<b>${esc(n)}</b>: new to the app`).join(' · ');
}
function parseRequest() {
  const lines = V('rq_fac').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { err: 'Add at least 1 facility.' };
  for (const id of ['rq_corp', 'rq_fcts']) { const e = ceErr(id); if (e) return { err: (id === 'rq_corp' ? 'Corporate' : 'Facility') + ' contacts: ' + e }; }
  const out = [];
  for (const l of lines) {
    const p = l.split(';').map(x => x.trim()); const name = p[0], address = p[1] || '', c3 = p[2] || '';
    if (!name) return { err: 'A line has no facility name: "' + l + '"' };
    const none = /^(none|no corporate|standalone)$/i.test(c3);
    const unknown = !c3 || c3 === '?';
    const group = none ? name : unknown ? '' : c3;
    if (V('rq_pre_fc') && unknown) return { err: '"' + name + '" has no corporate. Add it to the line, or untick "FastCare info gathered" (FastCare is where the transition lead would find it).' };
    if (V('rq_pre_fc') && !address && !V('rq_pre_added')) return { err: '"' + name + '" has no address, and Amy needs it to add it to Brightree. Add it to the line, or untick "FastCare info gathered".' };
    if (address && addressProblem(address)) return { err: '"' + name + '": ' + addressProblem(address) + ' Or leave the address out.' };
    const dup = st.facs.find(f => !f.archived && !f.complete && lc(f.name) === lc(name));
    if (dup && !ui.confirmDup) { ui.confirmDup = true; return { err: '"' + name + '" is already in the tracker (CT-' + pad(dup.id) + '). Submit again if this really is a new request.' }; }
    out.push({ name, address, group, none, state: stateFrom(address) });
  }
  return { lines: out };
}
async function submitRequest() {
  const p = parseRequest();
  if (p.err) { $('#rq_err').innerHTML = '<div class="err">' + esc(p.err) + '</div>'; return; }
  const covIn = {}; AREAS.forEach(a => { const v = V('rq_' + a); if (v && v !== 'Not sure') covIn[a] = v; });
  const corp = readContacts('rq_corp'), fcts = readContacts('rq_fcts'), why = V('rq_why'), rep = V('rq_rep'), am = V('rq_am'), acct = V('rq_acct');
  const files = ui.dropped.slice(), pre = {}; PRE_ITEMS.forEach(([k]) => { if (V('rq_pre_' + k)) pre[k] = true; });
  $('#rq button[type=submit]').disabled = true; $('#rq_err').innerHTML = '<div class="meta">Saving…</div>';
  const ok = await act(async () => {
    const ids = await STORE.allocateIds(p.lines.length);
    const folder = 'CT-' + pad(ids[0]) + ' ' + st.today;
    const saved = [];
    for (const f of files) saved.push(await STORE.uploadFile(folder, f));
    const req = { key: 'req:' + pad(ids[0]), by: me(), byName: meName(), at: st.today, why, files: saved, facIds: ids };
    st.reqs.push(req);
    const created = p.lines.map((l, i) => {
      if (l.group) { const g = ensureGroup(l.group, l.none); if (pre.corp && !g.price) g.existing = true; g.cov = Object.assign({}, covIn, g.cov || {}); if (corp.length && !(g.contacts || []).length) g.contacts = corp.map(c => ({ first: c.first, last: c.last, dept: c.dept, note: c.note, email: c.email })); }
      const f = { id: ids[i], req: req.key, name: l.name, address: l.address, state: l.state, group: l.group ? grp(l.group).name : '', pendingCov: Object.assign({}, covIn), rep, clin: rep, am, acct, contacts: [], requested: st.today, requester: me(), why, files: saved };
      applyPre(f, pre, l);
      fcts.forEach(c => { if (c.fac && !lc(l.name).startsWith(lc(c.fac))) return; addContacts(f, [c], 'requester'); });
      if (pre.ct) f.contacts.forEach(c => c.inPortal = true);
      st.facs.push(f); return f;
    });
    // "New transition" to each transition lead with their facilities; "Request received" only if the requester isn't one of them
    const amOfNew = f => f.am || (f.group ? G(f).am : '') || '';
    const byAm = {}; created.forEach(f => { const a = lc(amOfNew(f)); if (a) (byAm[a] = byAm[a] || []).push(f); });
    Object.entries(byAm).forEach(([a, list]) => mail({ key: 'm:E2:' + req.key + ':' + a, code: 'E2', to: [a], link: 'none', subject: 'New transition: ' + list.map(f => f.name).join(', '),
      body: `<p>${list.length} facilit${list.length > 1 ? 'ies' : 'y'}${list[0].group ? ' from <b>' + esc(list[0].group) + '</b>' : ''}, requested by ${esc(meName())}.</p><p><b>Why:</b> ${esc(why) || '-'}</p>${saved.length ? '<p><b>Attachments:</b> ' + saved.map(f => `<a href="${esc(f.url)}">${esc(f.name)}</a>`).join(', ') + '</p>' : ''}${Object.keys(pre).length ? '<p><b>Already done:</b> ' + esc(preList(list[0]).join(', ')) + '</p>' : ''}${amFirstTasks(list)}` }));
    if (!byAm[me()]) mail({ key: 'm:E1:' + req.key, code: 'E1', to: [me()], link: 'none', fyi: true, subject: 'Request received: ' + created.map(f => f.name).join(', '), body: `<p>Got it. ${created.map(f => esc(f.name) + ' (CT-' + pad(f.id) + ')').join(', ')}.</p><p>You'll get an email if anything is needed from you.</p>` });
  }, 'Request submitted');
  if (ok) { ui.dropped = []; ui.confirmDup = false; ui.view = 'mytasks'; render(); }
  else { const b = $('#rq button[type=submit]'); if (b) b.disabled = false; }
}

// ---------- settings (admin) ----------
function settingsHtml() {
  const s = st.settings, P = people();
  const personOpts = P.map(p => [p.name, p.name]);
  return `<h1>Settings</h1><p class="sub">Who does what, and the lists the app uses. Changes apply to new tasks and emails right away.</p><form id="setf" class="settings-grid">
  <div class="card"><b>Team</b>${tip('Everyone the app assigns tasks to. Tick Transition lead / Rep / account manager / Admin. "Find missing emails" looks blank emails up in the company address book.')}
    <div class="tablewrap" style="margin-top:8px"><table class="team"><tr><th>Name</th><th>Email</th><th>Transition lead</th><th>Rep / account manager</th><th>Ext</th><th>Admin</th><th></th></tr>${P.map((p, i) => `<tr data-pi="${i}"><td><input type="text" class="p-name" value="${esc(p.name)}"></td><td><input type="text" class="p-email" value="${esc(p.email)}" placeholder="name@gentell.com"></td><td><input type="checkbox" class="p-am" ${p.am ? 'checked' : ''} aria-label="Transition lead"></td><td><input type="checkbox" class="p-rep" ${p.rep ? 'checked' : ''} aria-label="Intake rep"></td><td><input type="text" class="p-ext" value="${esc(p.ext || '')}" style="width:60px"></td><td><input type="checkbox" class="p-admin" ${p.admin ? 'checked' : ''} aria-label="Admin"></td><td><button type="button" class="btn sm" data-delperson="${i}">Remove</button></td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="addperson">+ Add a person</button><button type="button" class="btn sm" id="findemails">Find missing emails</button></div></div>
  <div class="card"><b>Who does what</b><div class="row" style="margin-top:8px">${Object.entries(ROLES).map(([r, l]) => fld(esc(l), sel('role_' + r, personOpts, s.roles[r], true))).join('')}</div></div>
  <div class="card"><b>Chicago handoff email</b><div class="row" style="margin-top:8px">${fld('Greeting name', txt('s_greet', s.chicagoGreeting), '"Hi ___,"')}</div><div class="row">${fld('To (1 email per line)', `<textarea id="s_e1to" class="plain">${esc(s.e1To.join('\n'))}</textarea>`, 'The new intake rep is added automatically.')}${fld('CC (1 email per line)', `<textarea id="s_e1cc" class="plain">${esc(s.e1Cc.join('\n'))}</textarea>`, 'The transition lead and account manager are added automatically.')}</div></div>
  <div class="card"><b>Values</b><div class="row" style="margin-top:8px">${fld('In-service booking link', txt('s_inservice', s.inserviceUrl, 'https://…'), 'The "Click Here to Schedule an In-Service Call" link in the Chicago handoff email and the in-service & contacts request.')}${fld('"Biller" in the portal', txt('s_biller', s.biller))}${fld('Default price table', txt('s_tier2', s.tier2Price || '2022 Tier 2'), 'Used when every area of care except wound care is Covered Only or Don\'t Supply.')}</div><div class="row">${fld('Business days to do a task: helpers', txt('s_hdays', String(s.helperDays)))}${fld('Business days to do a task: transition leads', txt('s_adays', String(s.amDays)))}</div></div>
  <div class="card"><b>GDD warehouses</b>${tip('1 per line. Chris picks from these.')}<textarea id="s_wh" class="plain" style="min-height:150px">${esc(s.warehouses.join('\n'))}</textarea></div>
  <div class="card"><b>Portal contact departments</b>${tip('1 per line: Name | Facility or Corporate')}<textarea id="s_depts" class="plain" style="min-height:150px">${esc(s.depts.map(d => d.name + ' | ' + d.type).join('\n'))}</textarea></div>
  <div class="card"><b>Ship points</b>${tip('1 per line: number: state codes')}<div class="row">${fld('Enteral / uro (the "Ship Point" field)', `<textarea id="s_shipent" class="plain">${esc(Object.entries(s.shipEnt).map(([k, v]) => k + ': ' + v).join('\n'))}</textarea>`)}${fld('"Ship Point- United Ostomy, Fordmed"', `<textarea id="s_shipost" class="plain">${esc(Object.entries(s.shipOst).map(([k, v]) => k + ': ' + v).join('\n'))}</textarea>`)}</div></div>
  <div id="set_err"></div><div><button class="btn pri" type="submit">Save settings</button></div></form>
  <div class="card" style="margin-top:14px;max-width:900px"><b>Test the in-service & contacts screenshots</b>${tip('Sends a test email only to you, through the real "CT - Send emails" flow, so you can check the screenshot shows up properly in Outlook. Nothing in any transition changes.')}
    <p class="meta" style="margin:6px 0 8px">Paste a screenshot in one or both boxes, then click "Send me a test". You get the contacts part of the email, exactly as the wound rep and regional would see it.</p>
    <div class="row"><div class="field"><label>Facility contacts</label>${shotZone('test', 'fac', ui.shots.test_fac)}</div><div class="field"><label>Corporate contacts</label>${shotZone('test', 'corp', ui.shots.test_corp)}</div></div>
    <div style="margin-top:8px"><button type="button" class="btn pri" id="sendtest">Send me a test</button></div></div>`;
}
function readSettingsForm() {
  const rows = [...document.querySelectorAll('.team tr[data-pi]')].map(r => ({ name: r.querySelector('.p-name').value.trim(), email: lc(r.querySelector('.p-email').value), am: r.querySelector('.p-am').checked, rep: r.querySelector('.p-rep').checked, ext: r.querySelector('.p-ext').value.trim(), admin: r.querySelector('.p-admin').checked })).filter(p => p.name || p.email);
  const errs = [];
  rows.forEach(p => { if (!p.name) errs.push('A row has an email but no name.'); if (p.email && !validEmail(p.email)) errs.push(p.name + ': "' + p.email + '" isn\'t an email.'); });
  const names = rows.map(p => lc(p.name)); if (new Set(names).size !== names.length) errs.push('2 people have the same name. Make them different (add a last initial).');
  if (!rows.some(p => p.admin && lc(p.email) === me())) errs.push('Keep yourself as an admin, or you\'ll lose access to Settings.');
  const emails = id => V(id).split(/[\n;,]+/).map(x => lc(x)).filter(Boolean);
  const e1To = emails('s_e1to'), e1Cc = emails('s_e1cc');
  [...e1To, ...e1Cc].forEach(e => { if (!validEmail(e)) errs.push('Chicago handoff email list: "' + e + '" isn\'t an email.'); });
  const roles = {}; for (const r in ROLES) roles[r] = V('role_' + r);
  const lines = id => V(id).split('\n').map(x => x.trim()).filter(Boolean);
  const depts = lines('s_depts').map(l => { const [n, t] = l.split('|').map(x => x.trim()); if (!n || !/^(facility|corporate)$/i.test(t || '')) errs.push('Department line "' + l + '" needs "| Facility" or "| Corporate".'); return { name: n, type: /^c/i.test(t || '') ? 'Corporate' : 'Facility' }; });
  const ship = id => { const o = {}; lines(id).forEach(l => { const m = l.match(/^(\d+)\s*:\s*(.+)$/); if (!m) errs.push('Ship point line "' + l + '" should look like "1: CT DE IL".'); else o[m[1]] = m[2].toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim(); }); return o; };
  const shipEnt = ship('s_shipent'), shipOst = ship('s_shipost');
  const hd = +V('s_hdays'), ad = +V('s_adays');
  if (!(hd >= 1 && hd <= 10) || !(ad >= 1 && ad <= 10)) errs.push('Business days must be between 1 and 10.');
  if (V('s_inservice') && !/^https?:\/\//.test(V('s_inservice'))) errs.push('The in-service link has to start with https://');
  return { errs, val: { people: rows, roles, chicagoGreeting: V('s_greet'), e1To, e1Cc, inserviceUrl: V('s_inservice'), biller: V('s_biller'), tier2Price: V('s_tier2') || '2022 Tier 2', helperDays: hd, amDays: ad, warehouses: lines('s_wh'), depts, shipEnt, shipOst } };
}

// ---------- drawers ----------
function renderLayer() {
  const L = $('#layer');
  if (ui.openTask) { const t = taskByKey(ui.openTask); L.innerHTML = t ? taskDrawer(t) : ''; if (!t) ui.openTask = null; }
  else if (ui.openFac) { const f = facById(ui.openFac); L.innerHTML = f ? facDrawer(f) : ''; }
  else if (ui.openGroup) { const g = grp(ui.openGroup); L.innerHTML = g ? corpDrawer(g) : ''; }
  else L.innerHTML = '';
  if (ui.openTask) { const g = document.getElementById('g'); if (g && g.value === 'Yes') { const b = document.getElementById('whbox'); if (b) b.hidden = false; } }
}
const closeX = '<button class="btn sm" data-close aria-label="Close">✕</button>';
function taskDrawer(t) {
  const def = TT[t.type], f = t.fac ? facById(t.fac) : null, isDone = done(t);
  const ppl = [...new Map([[t.assignee, nameOf(t.assignee)], ...people().filter(p => validEmail(p.email)).map(p => [lc(p.email), p.name])]).entries()];
  const req = f && f.req ? st.reqs.find(r => r.key === f.req) : null;
  const quick = ui.answer && def.quick && !isDone ? `<div class="card" style="padding:12px;border-color:var(--accent)"><b>Record "${esc(ui.answer)}" for this task?</b><div class="meta">You clicked "${esc(ui.answer)}" in the email.</div><div class="row" style="margin-top:8px"><button class="btn pri" data-quick="${esc(ui.answer)}">Yes, record "${esc(ui.answer)}"</button><button class="btn" data-noquick>No, let me fill the form</button></div></div>` : '';
  return `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-label="Task"><header><div style="min-width:0;flex:1"><div class="meta">${f ? `<span class="linkish" data-fac="${f.id}">${esc(facName(f))}</span> · CT-${pad(f.id)} · ${esc(f.group)} · ${facLink(f).replace('Facility page', 'Open facility page')}` : 'Corporate: ' + esc(t.group === '__nocorp' ? 'not known yet' : t.group)}</div><h1 style="font-size:17px">${esc(def.title(t))}</h1><div class="meta">Assigned to <b>${esc(nameOf(t.assignee))}</b> · due ${fmt(t.due)}${isWaiting(t) ? ' · starts ' + fmt(t.opensOn) : ''} · ${esc(t.status)}</div></div>${closeX}</header><div class="body">
  ${isDone ? `<div class="okmsg">${t.status === 'Not needed' ? 'Not needed anymore' : 'Done by <b>' + esc(t.doneByName || nameOf(t.doneBy)) + '</b>'} on ${fmt(t.doneOn)}${t.doneBy && t.doneBy !== t.assignee ? ' (assigned to ' + esc(nameOf(t.assignee)) + ')' : ''}.</div>` : `
  ${quick}
  ${me() !== t.assignee ? `<div class="instr">This is ${esc(nameOf(t.assignee))}'s task. You can finish it anyway. It'll say "Done by ${esc(meName())}" and ${esc(nameOf(t.assignee))} gets an FYI email.</div>` : ''}
  ${isWaiting(t) ? `<div class="note">Starts ${fmt(t.opensOn)}. You can do it now if it's ready.</div>` : ''}
  ${f && (f.why || (f.files || []).length) ? `<div class="meta">${f.why ? '<b>Why:</b> ' + esc(f.why) : ''}${(f.files || []).length ? ' · <b>Attachments:</b> ' + f.files.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(', ') : ''}</div>` : ''}
  <form id="tf" style="display:flex;flex-direction:column;gap:12px">${def.form(t)}<div id="tf_err"></div><div class="row" style="align-items:center"><button class="btn pri" type="submit">Mark done</button>${STORE.mode === 'demo' ? '<button class="btn" type="button" id="tf_ex">Fill example</button>' : ''}</div></form>
  ${mayRemind(t) ? `<div class="card" style="padding:10px"><div class="row" style="align-items:center;justify-content:space-between"><span class="meta">${(() => { const l = lastReminder(t); return l ? 'Last reminder ' + esc(whenET(remAt(l))) + '.' : 'No reminder sent yet.'; })()} ${canRemind(t) ? '' : 'Next one possible ' + esc(whenET(nextReminderAt(t))) + '.'}</span>${remindBtn(t)}</div></div>` : ''}
  <div class="card" style="padding:10px"><div class="row" style="align-items:center"><label for="re" class="meta">Reassign to</label><select id="re">${ppl.map(([e, n]) => `<option value="${esc(e)}" ${e === t.assignee ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><button class="btn sm" id="re_go">Reassign</button></div></div>`}
  </div></div>`;
}
function corpDrawer(g) {
  const R = peopleOpts(repList()), A = peopleOpts(amList());
  return `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-label="Corporate"><header><div style="flex:1;min-width:0"><div class="meta">Corporate</div><h1 style="font-size:17px">${esc(g.name)}</h1><div class="meta">${facsOfGroup(g.name).length} facilities</div></div>${closeX}</header><div class="body">
  <form id="gf" style="display:flex;flex-direction:column;gap:12px">
  <div class="card" style="padding:10px"><b>Rep rule</b><div class="row">${fld('Intake rep', sel('ge_rep', R, g.rep, true))}${fld('Clinical rep', sel('ge_clin', R, g.clin, true))}${fld('Account manager', sel('ge_acct', R, g.acct, true))}${fld('Transition lead', sel('ge_am', A, g.am, true))}</div></div>
  <div class="card" style="padding:10px"><b>Areas of care</b><div class="row">${AREAS.map(a => fld(a, sel('ge_cov_' + a, covOpts(a), (g.cov || {})[a], true))).join('')}</div></div>
  <div class="row">${fld('"Price Table"', txt('ge_price', g.price))}${fld('"Emr Username"', txt('ge_emr', g.emr))}</div>
  <div class="field"><label>Corporate contacts</label>${contactEditor('ge_corp', 'Corporate', false, g.contacts)}<div class="hint">The first one with an email gets asked to add new facilities to the EMR login.</div></div>
  ${chk('ge_note', 'Corporate note is in the portal', g.noteDone)}${chk('ge_sa', 'Standalone (Independent HQ in FastCare)', g.standalone)}
  ${chk('ge_apply', 'Apply the rep rule and areas of care to every open facility in this corporate', false)}
  <div id="gf_err"></div><div><button class="btn pri" type="submit">Save</button></div></form></div></div>`;
}
function facDrawer(f) {
  const g = G(f), [s, c] = stageOf(f), ts = tasksOf(f).concat(st.tasks.filter(t => !t.fac && f.group && lc(t.group) === lc(f.group)));
  const ms = st.mails.filter(m => m.fac === f.id || (m.task && ts.some(t => t.key === m.task)));
  const ins = st.inbox.filter(m => m.fac === f.id);
  const R = peopleOpts(repList()), A = peopleOpts(amList()), demo = STORE.mode === 'demo';
  return `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-label="Facility"><header><div style="flex:1;min-width:0"><div class="meta">CT-${pad(f.id)} · ${esc(f.group || 'corporate not known yet')}</div><h1 style="font-size:17px">${esc(facName(f))}</h1><span class="pill ${c}">${s}</span>${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</div>${closeX}</header><div class="body">
  <details class="card" style="padding:10px"><summary><b>Edit details</b> <span class="meta">(changes here don't touch the portal or Brightree; fix those yourself)</span></summary><form id="fdet" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
    <div class="row">${fld('Facility name', txt('fd_name', f.name))}${fld('Portal name', txt('fd_pn', f.portalName))}</div>
    <div class="row">${fld('Address', txt('fd_addr', f.address, '123 Main St, City, ST 12345'), 'The state (' + esc(f.state || 'none yet') + ') comes from the 2 letters before the zip. It decides the ship point and delivery date.')}</div>
    <div class="row">${fld('Corporate', sel('fd_grp', Object.values(st.groups).filter(x => !x.standalone || lc(x.name) === lc(f.group)).map(x => x.name).sort(), g.name, true))}</div>${chk('fd_none', 'No corporate (standalone)', g.standalone)}
    <div class="row">${fld('Intake rep', sel('fd_rep', R, f.rep, true))}${fld('Clinical rep', sel('fd_clin', R, f.clin, true))}${fld('Account manager', sel('fd_acct', R, acctOf(f), true))}${fld('Transition lead', sel('fd_am', A, f.am || amOf(f), true))}</div>
    <div><button class="btn sm pri" type="submit">Save details</button></div></form></details>
  <div class="kv"><div>Sheet name</div><div>${esc(f.name)}</div><div>Address</div><div>${esc(f.address) || '-'} ${f.state ? '(' + esc(f.state) + ')' : ''}</div><div>Intake / clinical rep</div><div>${esc(nameOf(f.rep) || 'none')} / ${esc(nameOf(f.clin) || '-')}</div><div>Account manager</div><div>${esc(nameOf(acctOf(f)) || '-')}</div><div>Transition lead</div><div>${esc(nameOf(amOf(f)))}</div><div>Wound rep / regional</div><div>${esc(f.wound ? f.wound.name : '-')} / ${esc(f.regional ? f.regional.name : '-')}</div><div>Why</div><div>${esc(f.why) || '-'}</div>${(f.files || []).length ? `<div>Attachments</div><div>${f.files.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(', ')}</div>` : ''}<div>Pumps checked / GDD</div><div>${f.pumps === 'already done' ? 'Yes (already done when requested)' : f.pumps ? 'Yes' : 'not yet'} / ${esc(f.gdd || '?')}${f.gddWh ? ' (' + esc(f.gddWh) + ')' : ''}</div>${f.dates ? `<div>First DOS</div><div class="num">${fmt(f.dates.dos)}</div><div>Ordering</div><div class="num">${fmt(f.dates.ord)}</div><div>Delivery</div><div class="num">${fmt(f.dates.del)} · OS Days ${f.dates.os}</div>` : ''}<div>Chicago handoff email</div><div class="num">${fmtS(f.email1) || '-'}</div><div>Transfer notice to facility</div><div class="num">${fmtS(f.email2) || '-'}${f.email2By ? ' (' + esc(f.email2By) + ')' : ''}</div><div>In-service & contacts request</div><div class="num">${fmtS(f.email3) || '-'}</div>${f.email3 ? `<div>Their reply</div><div>${f.e3Done ? 'Taken care of ' + fmtS(f.e3Done) + (f.e3DoneBy ? ' (' + esc(nameOf(f.e3DoneBy) || f.e3DoneBy) + ')' : '') : f.e3Reply ? 'Replied ' + fmtS(f.e3Reply.at) + ', the transition lead is putting it in' : 'Waiting for their reply'}</div>` : ''}${f.pre ? `<div>Done before the request</div><div>${esc(preList(f).join(', '))}</div>` : ''}</div>
  <div class="row">${f.email1 && !f.email2 ? '<button class="btn pri sm" data-fact="e2">Chicago sent the transfer notice</button>' : ''}${f.email1 ? '<button class="btn sm" data-fact="corr">Dates changed: send correction</button>' : ''}${f.email3 && !f.e3Done ? '<button class="btn sm" data-fact="e3done">In-service & contacts: taken care of</button>' : ''}<button class="btn sm" data-fact="hold">${f.hold ? 'Take off hold' : 'Put on hold'}</button>${isAdmin(me()) ? '<button class="btn sm" data-fact="del" style="margin-left:auto">Delete (test or mistake)</button>' : ''}${demo && f.email1 && !f.email2 ? '<button class="btn sm" data-fact="sim_e2">Demo: Chicago CCs the mailbox on the transfer notice</button>' : ''}${demo && f.email3 && !f.e3Done && !f.e3Reply ? '<button class="btn sm" data-fact="sim_e3">Demo: wound rep replies to the in-service & contacts request</button>' : ''}</div>
  ${f.dates ? dateEditor(f) : ''}
  <div class="card" style="padding:10px"><b>Areas of care</b><div class="meta">From ${esc(f.group || 'the corporate')} unless changed here. A change here is for this facility only.${f.email1 ? ' The Chicago handoff email already went out: dates won\'t recalculate.' : ' Dates recalculate.'}</div><form id="fcov"><div class="row">${AREAS.map(a => fld(a + ((f.cov && f.cov[a]) ? ' <span class="tag">this facility</span>' : ''), sel('fc_' + a, covOpts(a), FG(f).cov[a], true))).join('')}</div><div class="row" style="margin-top:6px"><button class="btn sm pri" type="submit">Save areas of care</button><button class="btn sm" type="button" data-covreset="1">Use the corporate's</button></div></form></div>
  <div class="card" style="padding:10px"><b>Contacts</b>${f.contacts.length ? contactTable(f.contacts) : '<div class="meta">None yet.</div>'}<div class="sect" style="margin-top:8px">Add contacts${tip('Add contacts any time. They go on the next "Contacts into portal" task' + (f.email3 ? '' : ' and in the in-service & contacts request') + '.')}</div>${contactEditor('fac_cts', '', false)}<div class="row" style="margin-top:6px"><button class="btn sm pri" data-addcts="1">Add contacts</button></div><div id="fac_err"></div></div>
  <h2 style="margin:4px 0 0">Tasks</h2><div class="tablewrap"><table><tr><th>Task</th><th>Assigned</th><th>Status</th><th>Done by</th></tr>${ts.map(t => `<tr class="click" data-task="${esc(t.key)}"><td>${esc(taskTitle(t))}</td><td>${esc(nameOf(t.assignee))}</td><td>${isWaiting(t) ? 'Starts ' + fmtS(t.opensOn) : esc(t.status)}</td><td>${esc(t.doneByName || nameOf(t.doneBy) || '')}</td></tr>`).join('')}</table></div>
  <h2 style="margin:4px 0 0">Mailbox (emails that came in)</h2>${ins.length ? `<div class="tablewrap"><table><tr><th>Received</th><th>From</th><th>Subject</th><th></th></tr>${ins.map(m => `<tr><td class="num">${esc((m.received || '').slice(0, 10))}</td><td>${esc(m.from)}</td><td>${esc(m.subject)}<div class="meta">${esc((m.preview || '').slice(0, 200))}</div></td><td>${m.path ? `<a href="${esc(STORE.fileUrl(m.path))}" target="_blank" rel="noopener">Open</a>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="meta">None yet.</div>'}
  <h2 style="margin:4px 0 0">Emails from the app</h2>${ms.some(m => m.status !== 'Cancelled') ? mailSections(ms, isAdmin(me()), 'h3') : '<div class="meta">None yet.</div>'}</div></div>`;
}
function deLive(changed) {
  const f = facById(+document.querySelector('[data-savedates]').dataset.savedates); if (!f) return;
  const r = derive(f, f.dates.dos), v = V(changed); if (!v) return;
  const dos = changed === 'de_dos' ? v : changed === 'de_ord' ? addBiz(v, r.back) : addBiz(v, -r.ship);
  const d = derive(f, dos);
  $('#de_ord').value = d.ord; $('#de_dos').value = d.dos; $('#de_del').value = d.del;
  $('#de_info').textContent = d.day + ' delivery · OS Days ' + d.os + ' · ' + (d.partB ? 'Part B only: ordering 2 business days before DOS' : 'ordering 1 business day before DOS') + ' · Ship Point ' + d.ship;
  $('#de_warn').innerHTML = dateWarn(f, dos).map(x => '<div class="err" style="margin-top:6px">' + esc(x) + '</div>').join('');
}
function fillExample(t) {
  const ex = TT[t.type].example(t);
  for (const k in ex) {
    if (Array.isArray(ex[k])) { setContacts(k, ex[k]); continue; }
    const e = document.getElementById(k); if (!e) continue;
    if (e.type === 'checkbox') e.checked = !!ex[k];
    else { if (e.tagName === 'SELECT' && ![...e.options].some(o => o.value === ex[k])) e.insertAdjacentHTML('beforeend', `<option value="${esc(ex[k])}">${esc(ex[k])}</option>`); e.value = ex[k]; e.dispatchEvent(new Event('change', { bubbles: true })); }
  }
}

// ---------- clicks ----------
document.addEventListener('click', async e => {
  const T = e.target;
  const v = T.closest('[data-view]'); if (v) { ui.view = v.dataset.view; if (v.dataset.outfilter) ui.outFilter = v.dataset.outfilter; ui.openTask = ui.openFac = ui.openGroup = null; render(); return; }
  if (T.closest('[data-close]')) { ui.openTask = ui.openFac = ui.openGroup = null; ui.answer = null; renderLayer(); return; }
  const cb = T.closest('[data-selfac]'); if (cb) { const i = +cb.dataset.selfac; cb.checked ? ui.sel.add(i) : ui.sel.delete(i); e.stopPropagation(); render(); return; }
  // "Facility page" link inside a task row: opens the facility, not the task (Ctrl/middle-click still opens a new tab)
  const fp = T.closest('[data-facpage]'); if (fp) { if (e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); ui.openFac = +fp.dataset.facpage; ui.openTask = ui.openGroup = null; ui.answer = null; renderLayer(); return; }
  const rm = T.closest('[data-remind]'); if (rm) { e.stopPropagation(); const key = rm.dataset.remind; let why = '', who = ''; rm.disabled = true;
    await act(() => { const t = taskByKey(key); who = t ? nameOf(t.assignee) : ''; why = sendReminder(t, me(), meName()); if (why) return false; });
    if (why) toast(why); else if (!ui.errors.length) toast('Reminder sent to ' + who + '. No more reminders on this task for 24 hours.'); return; }
  const mb = T.closest('[data-mtby]'); if (mb) { ui.myF.by = mb.dataset.mtby; render(); return; }
  const cf = T.closest('[data-clearf]'); if (cf) { if (cf.dataset.clearf === 'my') Object.assign(ui.myF, { fac: '', corp: '' }); else ui.allF = { lead: '', who: '', fac: '', corp: '' }; render(); return; }
  const ds = T.closest('[data-donesort]'); if (ds) { const k = ds.dataset.donesort; ui.doneSort = ui.doneSort.k === k ? { k, dir: -ui.doneSort.dir } : { k, dir: k === 'on' ? -1 : 1 }; render(); return; }
  if (T.closest('[data-doneall]')) { ui.doneAll = !ui.doneAll; render(); return; }
  if (typeof analyticsClick === 'function' && analyticsClick(T)) return;
  const tk = T.closest('[data-task]'); if (tk) { ui.openTask = tk.dataset.task; ui.openFac = ui.openGroup = null; ui.answer = null; renderLayer(); return; }
  const fr = T.closest('[data-fac]'); if (fr && !T.closest('select')) { ui.openFac = +fr.dataset.fac; ui.openTask = ui.openGroup = null; renderLayer(); return; }
  const eg = T.closest('[data-editgrp]'); if (eg) { ui.openGroup = eg.dataset.editgrp; ui.openTask = ui.openFac = null; renderLayer(); return; }
  if (T.id === 'reload') { ui.errors = []; await act(async () => { }); return; }
  if (T.id === 'refresh') { await act(async () => { }, 'Up to date'); return; }
  if (T.id === 'signout') { STORE.signOut(); return; }
  const sc = T.closest('[data-showce]'); if (sc) { const b = document.getElementById(sc.dataset.showce); if (b) { b.hidden = false; const i = b.querySelector('input'); if (i) i.focus(); } sc.hidden = true; return; }
  if (T.id === 'tf_ex') { fillExample(taskByKey(ui.openTask)); return; }
  if (T.id === 'csv') { trackerCsv(); return; }
  if (T.id === 'loadarch') { ui.busy = true; try { await STORE.load({ archived: true }); } finally { ui.busy = false; } ui.trackerFilter = 'all'; render(); toast('Archived facilities loaded'); return; }
  const tf = T.closest('[data-tfilter]'); if (tf) { ui.trackerFilter = tf.dataset.tfilter; render(); return; }
  const of = T.closest('[data-outfilter]'); if (of) { ui.outFilter = of.dataset.outfilter; render(); return; }
  // email-button answers (GDD "No", pumps "Checked")
  const qk = T.closest('[data-quick]'); if (qk) { const key = ui.openTask, a = qk.dataset.quick; await act(() => { const t = taskByKey(key); if (!t || done(t)) { toast('Already done.'); return false; } if (!TT[t.type].quick(t, a)) return false; finishTask(t, me(), meName()); }, 'Recorded "' + a + '"'); ui.answer = null; ui.openTask = null; renderLayer(); return; }
  if (T.closest('[data-noquick]')) { ui.answer = null; renderLayer(); return; }
  if (T.id === 're_go') { const key = ui.openTask, to = $('#re').value; await act(() => { const t = taskByKey(key); if (!t || to === t.assignee) return false; reassign(t, to, meName()); }, 'Reassigned to ' + nameOf(to)); return; }
  if (T.id === 'bk_go') { const r = $('#bk_rep').value, a = $('#bk_am').value, sel = [...ui.sel]; if (!sel.length || (!r && !a)) { toast('Tick rows and pick a rep or transition lead.'); return; } await act(() => { sel.forEach(i => { const f = facById(i); if (!f) return; if (r) { f.rep = r; f.clin = r; } if (a) f.am = a; }); }, 'Updated ' + sel.length + ' facilities'); return; }
  if (T.id === 'bk_hgo') { const v2 = $('#bk_hold').value, sel = [...ui.sel]; if (!sel.length || !v2) { toast('Tick rows and pick a stage.'); return; } await act(() => { sel.forEach(i => { const f = facById(i); if (f && !!f.hold !== (v2 === 'On hold')) holdToggle(f, v2 === 'On hold', meName()); }); }, 'Updated ' + sel.length + ' facilities'); return; }
  const cp = T.closest('[data-copy]'); if (cp) {
    const to = cp.dataset.copy, src = document.querySelector(`[data-copysrc="${CSS.escape(to)}"]`).value; if (!src) { toast('Pick a corporate to copy from.'); return; }
    await act(() => { const g = grp(to), s = grp(src); if (!g || !s) return false; g.cov = { ...s.cov }; g.price = s.price; g.rep = s.rep; g.clin = s.clin; g.am = s.am; g.acct = s.acct;
      st.tasks.filter(t => !t.fac && lc(t.group) === lc(to) && !done(t) && ['AREAS', 'PRICE', 'RULE'].includes(t.type)).forEach(t => finishTask(t, me(), meName() + ' (copied from ' + src + ')'));
      facsOfGroup(to).filter(f => !f.rep).forEach(f => { f.rep = s.rep; f.clin = s.clin; f.am = f.am || s.am; f.acct = f.acct || s.acct; }); }, 'Copied from ' + src); return; }
  if (T.closest('[data-addcts]')) { const id = ui.openFac, v2 = readContacts('fac_cts'); if (!v2.length) return; const er = ceErr('fac_cts'); if (er) { $('#fac_err').innerHTML = '<div class="err">' + esc(er) + '</div>'; return; } await act(() => { addContacts(facById(id), v2, meName()); }, 'Contacts added'); return; }
  const ar = T.closest('[data-addrow]'); if (ar) { const box = document.getElementById(ar.dataset.addrow); box.insertAdjacentHTML('beforeend', ceRow(box.dataset.kind, !!box.dataset.withfac, {})); return; }
  const dr = T.closest('[data-delrow]'); if (dr) { const box = dr.closest('.ce'); if (box.querySelectorAll('.ce-row').length > 1) dr.closest('.ce-row').remove(); else dr.closest('.ce-row').querySelectorAll('input,select').forEach(x => x.value = ''); return; }
  const sb = T.closest('[data-segval]'); if (sb) { const id = sb.parentElement.dataset.seg, h = document.getElementById(id); h.value = sb.dataset.segval; segSync(id); h.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (T.closest('[data-applyall]')) { const t = taskByKey(ui.openTask); ruleFacs(t).forEach(f => { ['rep', 'clin', 'acct', 'am'].forEach(k => { const val = V(k), el = document.getElementById(k + '_' + f.id); if (el && val) el.value = val; }); }); toast('Applied to all rows'); return; }
  if (T.closest('[data-covreset]')) { const id = ui.openFac; await act(() => { facById(id).cov = {}; }, 'Back to the corporate\'s areas of care'); return; }
  const sd = T.closest('[data-savedates]'); if (sd) { const id = +sd.dataset.savedates, dos = V('de_dos'); if (!dos) return; await act(() => saveDates(facById(id), dos, meName()), 'Dates saved'); return; }
  const rd = T.closest('[data-recdates]'); if (rd) { const id = +rd.dataset.recdates; await act(() => { const f = facById(id); saveDates(f, f.rec.dos, meName()); }, 'Back to recommended dates'); return; }
  const fa = T.closest('[data-fact]'); if (fa) {
    const id = ui.openFac, k = fa.dataset.fact;
    if (k === 'e2') await act(() => markEmail2(facById(id), meName()), 'Marked as sent by Chicago');
    if (k === 'e3done') await act(() => markE3Done(facById(id), meName()), 'Marked as taken care of. No more follow-ups.');
    if (k === 'sim_e3') await act(() => { const f = facById(id); st.inbox.unshift({ _id: uid(), subject: 'RE: ' + E3_SUBJECT(f), from: f.wound.email, to: [CFG.mailbox], cc: [amOf(f)], received: st.today + 'T15:00:00Z', preview: 'Hi, the dietician is Jane Doe (jane.doe@demo.com). The facility booked the in-service for next Tuesday. Thanks!', path: '', processed: false }); }, 'The wound rep replied');
    if (k === 'corr') { if (!confirm('Send Chicago a CORRECTION email with the current dates?')) return; await act(() => sendEmail1(facById(id), true), 'Correction sent'); }
    if (k === 'del') { if (!confirm('Delete this facility? Its tasks close and any emails not sent yet are cancelled. Use it for test facilities or mistakes.')) return; const ok = await act(() => deleteFacility(facById(id), meName()), 'Deleted'); if (ok) { ui.openFac = null; renderLayer(); } return; }
    if (k === 'hold') await act(() => { const f = facById(id); holdToggle(f, !f.hold, meName()); }, 'Saved');
    if (k === 'sim_e2') await act(() => { const f = facById(id); st.inbox.unshift({ _id: uid(), subject: facName(f) + ' - Transfer from GNS Chicago to Lakewood', from: 'chicago.rep@demo.gentell.com', to: ['facility@demo.com'], cc: [CFG.mailbox, f.rep], received: st.today + 'T14:00:00Z', preview: 'Hello, I hope you\'re doing well! We are pleased to inform you…', path: '', processed: false }); }, 'The transfer notice arrived in the mailbox');
    return;
  }
  const rt = T.closest('[data-retry]'); if (rt) {
    const key = rt.dataset.retry, split = s => (s || '').split(/[;,\s]+/).map(lc).filter(Boolean);
    const to = split(document.querySelector(`[data-rto="${CSS.escape(key)}"]`).value), cc = split(document.querySelector(`[data-rcc="${CSS.escape(key)}"]`).value);
    const bad = [...to, ...cc].filter(e => !validEmail(e)); if (!to.length || bad.length) { toast(!to.length ? 'Put at least 1 address in To.' : 'Not an email: ' + bad.join(', ')); return; }
    await act(() => { const m = st.mails.find(x => x.key === key); if (!m) return false; m.to = to; m.cc = cc.filter(e => !to.includes(e)); m.status = 'Queued'; m.error = ''; m.sendOn = new Date(Date.now() - 60000).toISOString(); }, 'It goes out within 5 minutes'); return; }
  const ra = T.closest('[data-retryall]'); if (ra) { const keys = ra.dataset.retryall.split('|'); await act(() => { let n = 0; for (const m of st.mails) if (keys.includes(m.key) && m.status === 'Failed') { m.status = 'Queued'; m.error = ''; m.sendOn = new Date(Date.now() - 60000).toISOString(); n++; } return n ? undefined : false; }, 'They go out within 5 minutes'); return; }
  const cm = T.closest('[data-cancelmail]'); if (cm) { const key = cm.dataset.cancelmail; await act(() => { const m = st.mails.find(x => x.key === key); if (!m) return false; m.status = 'Cancelled'; }, 'Cancelled'); return; }
  if (T.id === 'addperson') { const tb = document.querySelector('.team tbody') || document.querySelector('.team'); tb.insertAdjacentHTML('beforeend', `<tr data-pi="n"><td><input type="text" class="p-name"></td><td><input type="text" class="p-email" placeholder="name@gentell.com"></td><td><input type="checkbox" class="p-am"></td><td><input type="checkbox" class="p-rep"></td><td><input type="text" class="p-ext" style="width:60px"></td><td><input type="checkbox" class="p-admin"></td><td><button type="button" class="btn sm" data-delperson>Remove</button></td></tr>`); return; }
  const dp = T.closest('[data-delperson]'); if (dp) { dp.closest('tr').remove(); return; }
  if (T.id === 'findemails') {
    const rows = [...document.querySelectorAll('.team tr[data-pi]')].filter(r => !r.querySelector('.p-email').value.trim() && r.querySelector('.p-name').value.trim());
    let found = 0;
    for (const r of rows) { try { const res = await STORE.searchPeople(r.querySelector('.p-name').value.trim()); if (res.length === 1 || (res[0] && lc(res[0].name) === lc(r.querySelector('.p-name').value))) { r.querySelector('.p-email').value = res[0].email; found++; } } catch (err) { toast(err.message); break; } }
    toast(found + ' of ' + rows.length + ' found. Check them, then "Save settings".'); return;
  }
  if (T.id === 'nextDay') { st.today = addBiz(st.today, 1); await act(() => { }, 'Now ' + fmt(st.today)); return; }
  if (T.id === 'reset') { await STORE.init(); ui.view = 'new'; ui.openTask = ui.openFac = ui.openGroup = null; ui.errors = []; render(); toast('Demo reset'); return; }
});
function segSync(id) { const h = document.getElementById(id), g = document.querySelector(`[data-seg="${id}"]`); if (!h || !g) return; g.querySelectorAll('.segb').forEach(b => { const on = b.dataset.segval === h.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); }

// ---------- forms ----------
document.addEventListener('submit', async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'rq') { await submitRequest(); return; }
  if (id === 'tf') {
    const key = ui.openTask, t = taskByKey(key), msg = TT[t.type].validate(t);
    if (msg) { $('#tf_err').innerHTML = '<div class="err">' + esc(msg) + '</div>'; return; }
    // the FastCare screenshots are uploaded to SharePoint first; the task then saves where they are
    ui.shotSaved = {};
    if (t.type === 'FASTCARE' && (shotFor(t, 'fac') || shotFor(t, 'corp'))) {
      $('#tf_err').innerHTML = '<div class="meta">Uploading the screenshots…</div>';
      try { const f = facById(t.fac); for (const [w, pre] of [['fac', 'facility'], ['corp', 'corporate']]) { const s = shotFor(t, w); if (!s) continue; const name = pre + '-contacts-CT-' + pad(f.id) + '.jpg'; const r = await STORE.uploadFile('CT-' + pad(f.id), new File([s.blob], name, { type: 'image/jpeg' })); ui.shotSaved[w] = { name, path: r.path, url: r.url, data: r.data || '' }; } }
      catch (e) { $('#tf_err').innerHTML = '<div class="err">A screenshot didn\'t upload: ' + esc(e.message || e) + '. Try again.</div>'; return; }
    }
    const ok = await act(() => { const t2 = taskByKey(key); if (!t2 || done(t2)) { toast('Someone already finished this task.'); return false; } TT[t2.type].done(t2, { by: me(), byName: meName() }); finishTask(t2, me(), meName()); }, 'Done. Recorded as done by ' + meName() + '.');
    if (ok) { if (t.type === 'FASTCARE') { delete ui.shots.fc_fac; delete ui.shots.fc_corp; } ui.openTask = null; renderLayer(); }
    return;
  }
  if (id === 'fdet') {
    const fid = ui.openFac, vals = { name: V('fd_name'), pn: V('fd_pn'), addr: V('fd_addr'), state: '', grp: V('fd_grp'), none: V('fd_none'), rep: V('fd_rep'), clin: V('fd_clin'), am: V('fd_am'), acct: V('fd_acct') };
    if (vals.addr && addressProblem(vals.addr)) { toast(addressProblem(vals.addr)); return; }
    if (vals.addr) vals.state = stateFrom(vals.addr);
    if (vals.state && !/^[A-Z]{2}$/.test(vals.state)) { toast('State is 2 letters.'); return; }
    await act(() => { const f = facById(fid), oldState = f.state;
      if (f.email1 && vals.state && vals.state !== oldState) mail({ key: 'm:E13:state:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, link: 'fac', subject: 'Address changed after the Chicago handoff email: ' + facName(f), body: '<p>' + esc(meName()) + ' changed the state from ' + esc(oldState || '(none)') + ' to ' + esc(vals.state) + '. The dates didn\'t change. Check the ship point and delivery date, and send Chicago a correction if they\'re wrong.</p>' }); f.name = vals.name || f.name; f.portalName = vals.pn; f.address = vals.addr; f.state = vals.addr ? vals.state : ''; f.rep = vals.rep || f.rep; f.clin = vals.clin || f.clin; f.am = vals.am || f.am; f.acct = vals.acct; if (vals.none) { if (!G(f).standalone) makeStandalone(f); } else if (vals.grp && lc(vals.grp) !== lc(f.group)) f.group = grp(vals.grp).name; }, 'Saved');
    return;
  }
  if (id === 'fcov') { const fid = ui.openFac, vals = {}; AREAS.forEach(a => vals[a] = V('fc_' + a)); await act(() => { const f = facById(fid), g = G(f); f.cov = {}; AREAS.forEach(a => { if (vals[a] && vals[a] !== (g.cov || {})[a]) f.cov[a] = vals[a]; }); }, 'Areas of care saved'); return; }
  if (id === 'gf') {
    const er = ceErr('ge_corp'); if (er) { $('#gf_err').innerHTML = '<div class="err">Corporate contacts: ' + esc(er) + '</div>'; return; }
    const name = ui.openGroup, vals = { rep: V('ge_rep'), clin: V('ge_clin'), am: V('ge_am'), acct: V('ge_acct'), price: V('ge_price'), emr: V('ge_emr'), contacts: readContacts('ge_corp'), note: V('ge_note'), sa: V('ge_sa'), apply: V('ge_apply'), cov: {} };
    AREAS.forEach(a => vals.cov[a] = V('ge_cov_' + a));
    const ok = await act(() => {
      const g = grp(name); g.rep = vals.rep; g.clin = vals.clin || vals.rep; g.am = vals.am; g.acct = vals.acct; g.cov = g.cov || {}; AREAS.forEach(a => { if (vals.cov[a]) g.cov[a] = vals.cov[a]; }); if (vals.price !== g.price) g.priceAuto = false; g.price = vals.price; g.emr = vals.emr; g.contacts = vals.contacts.map(c => ({ first: c.first, last: c.last, dept: c.dept, note: c.note, email: c.email })); g.noteDone = vals.note; g.standalone = vals.sa;
      if (vals.apply) facsOfGroup(g.name).filter(f => !f.complete).forEach(f => { if (g.rep) { f.rep = g.rep; f.clin = g.clin; f.am = g.am || f.am; f.acct = g.acct || f.acct; } f.cov = {}; });
      st.tasks.filter(t => !t.fac && lc(t.group) === lc(g.name) && !done(t)).forEach(t => { if ((t.type === 'AREAS' && covKnown(g)) || (t.type === 'PRICE' && g.price) || (t.type === 'EMR' && g.emr) || (t.type === 'RULE' && g.rep && !facsOfGroup(g.name).some(f => !f.rep))) finishTask(t, me(), meName() + ' (edited the corporate)'); });
    }, 'Saved ' + name);
    if (ok) { ui.openGroup = null; renderLayer(); }
    return;
  }
  if (id === 'setf') {
    const r = readSettingsForm(); if (r.errs.length) { $('#set_err').innerHTML = '<div class="err">' + r.errs.map(esc).join('<br>') + '</div>'; return; }
    await act(() => { Object.assign(st.settings, r.val); }, 'Settings saved');
  }
});

// ---------- typing, picking, dragging ----------
let ppTimer = null;
document.addEventListener('input', e => {
  if (e.target.id === 'tq') { ui.q = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#tq'); n.focus(); n.setSelectionRange(pos, pos); return; }
  if (e.target.classList.contains('pp')) {
    const inp = e.target, q = inp.value.trim(); if (/<[^>]+>$/.test(q)) return;
    clearTimeout(ppTimer); ppTimer = setTimeout(async () => { try { const res = await STORE.searchPeople(q); const dl = document.getElementById(inp.id + '_dl'); if (dl) dl.innerHTML = res.map(p => `<option value="${esc(p.name + ' <' + p.email + '>')}"></option>`).join(''); } catch (err) { console.error(err); } }, 250);
  }
  if (e.target.id === 'rq_fac') ui.confirmDup = false;
});
document.addEventListener('input', e => { if (e.target.id === 'rq_fac') corpInfo(); });
document.addEventListener('change', async e => {
  const id = e.target.id;
  if (id === 'rq_files') addFiles(e.target.files);
  if (id.startsWith('rq_pre_')) setTimeout(() => { const n = document.querySelectorAll('.predone input:checked').length, c = $('#rq_precount'); if (c) c.textContent = n ? n + ' ticked' : ''; });
  // "Already done": later steps imply the earlier ones
  const chain = ['rq_pre_ps', 'rq_pre_e1', 'rq_pre_e2'], ci = chain.indexOf(id);
  if (ci >= 0) chain.forEach((c, j) => { const el = document.getElementById(c); if (el && (e.target.checked ? j < ci : j > ci)) el.checked = e.target.checked; });
  if (id === 'fc_grp') { const b = $('#fc_newbox'); if (b) b.hidden = e.target.value !== 'New corporate…'; }
  if (['de_ord', 'de_dos', 'de_del'].includes(id)) deLive(id);
  if (e.target.type === 'hidden') segSync(id);
  if (e.target.classList.contains('ce-dept')) { const n = e.target.closest('.ce-row').querySelector('.ce-note'); n.hidden = e.target.value !== 'Other'; }
  if (id === 'g') { const b = $('#whbox'); if (b) b.hidden = e.target.value !== 'Yes'; }
  if (id === 'who') { const p = person(e.target.value); st.me = { email: lc(p.email), name: p.name }; ui.openTask = ui.openFac = ui.openGroup = null; render(); }
  if (id === 'forwho') { ui.forWho = e.target.value === me() ? null : e.target.value; Object.assign(ui.myF, { fac: '', corp: '' }); render(); }
  if (id === 'mt_fac' || id === 'mt_corp') { ui.myF[id.slice(3)] = e.target.value; render(); }
  if (['at_lead', 'at_who', 'at_fac', 'at_corp'].includes(id)) { ui.allF[id.slice(3)] = e.target.value; render(); }
  if (typeof analyticsChange === 'function') analyticsChange(e.target);
  const li = e.target.closest && e.target.closest('[data-linkin]'); if (li && li.value) { const mid = li.dataset.linkin, fid = +li.value; await act(() => { const m = st.inbox.find(x => String(x._id) === String(mid)); if (m) { m.fac = fid; m.processed = true; } }, 'Linked'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (ui.openTask || ui.openFac || ui.openGroup)) { ui.openTask = ui.openFac = ui.openGroup = null; renderLayer(); } if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('task')) e.target.click(); });
function addFiles(list) { ui.dropped = [...ui.dropped, ...list]; const l = $('#rq_list'); if (l) l.textContent = ui.dropped.map(f => f.name).join(', '); }
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#rq_drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#rq_drop'); if (z) z.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest && e.target.closest('#rq_drop'); if (!z) return; e.preventDefault(); z.classList.remove('over');
  if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  else $('#rq_list').innerHTML = '<div class="err">Outlook didn\'t hand over a file. Browsers can\'t take emails dragged straight from Outlook. Forward the email to ' + esc(CFG.mailbox) + ' instead, or drag it to your desktop first, then drag that file here.</div>';
});

boot();

// ---------- info buttons ----------
// Helper text (.hint under a field, .sub under a page title) is tucked behind a small "i" button next to the label or title.
function infoize(root) {
  root.querySelectorAll('.hint:not([data-tipped]), p.sub:not([data-tipped])').forEach(h => {
    h.dataset.tipped = '1';
    if (!h.textContent.trim()) { h.remove(); return; }
    let anchor = null;
    if (h.classList.contains('hint')) { const fld = h.closest('.field'); anchor = fld && fld.querySelector(':scope > label'); }
    else { let p = h.previousElementSibling; if (p && /^H[12]$/.test(p.tagName)) anchor = p; }
    if (!anchor) return;
    const w = document.createElement('span'); w.className = 'infow';
    w.innerHTML = `<button type="button" class="info" aria-label="More info" aria-expanded="false">${INFO_SVG}</button>`;
    const tip = document.createElement('span'); tip.className = 'tip'; tip.setAttribute('role', 'note');
    while (h.firstChild) tip.appendChild(h.firstChild);
    w.appendChild(tip); anchor.appendChild(w); h.remove();
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.info');
  document.querySelectorAll('.infow.open').forEach(w => { if (!b || !w.contains(b)) { w.classList.remove('open'); w.firstChild.setAttribute('aria-expanded', 'false'); } });
  if (b) { e.preventDefault(); e.stopPropagation(); const w = b.parentNode, on = !w.classList.contains('open'); w.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); if (on) placeTip(w); }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.infow.open').forEach(w => w.classList.remove('open')); });
new MutationObserver(() => { infoize(document.getElementById('main')); infoize(document.getElementById('layer')); }).observe(document.body, { childList: true, subtree: true });
function placeTip(w) { const t = w.querySelector('.tip'); if (!t) return; t.style.left = ''; const r = t.getBoundingClientRect(); if (r.width && r.right > innerWidth - 8) t.style.left = (-8 - (r.right - innerWidth + 8)) + 'px'; }
document.addEventListener('mouseover', e => { const w = e.target.closest && e.target.closest('.infow'); if (w) placeTip(w); });
document.addEventListener('focusin', e => { const w = e.target.closest && e.target.closest('.infow'); if (w) placeTip(w); });

// ---------- screenshots (FastCare task, Settings test): paste or pick, shrink to a reasonable JPEG, preview ----------
// boxes are data-shot="<ctx>_<which>"; a paste goes to the box last clicked/focused, else the first empty one
let lastShotBox = null;
document.addEventListener('focusin', e => { const z = e.target.closest && e.target.closest('[data-shot]'); if (z) lastShotBox = z.dataset.shot; });
async function takeShot(file, key) {
  if (!file || !/^image\//.test(file.type)) return;
  const boxes = [...document.querySelectorAll('[data-shot]')].map(z => z.dataset.shot); if (!boxes.length) return;
  key = key || (boxes.includes(lastShotBox) ? lastShotBox : boxes.find(k => !ui.shots[k]) || boxes[0]);
  const t = ui.openTask && taskByKey(ui.openTask);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const w = Math.min(1400, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  ui.shots[key] = { task: t ? t.key : '', blob, url: URL.createObjectURL(blob) };
  redrawShot(key);
  if (key.startsWith('fc_')) { const n = document.getElementById('fc_nocts'); if (n) n.checked = false; }
}
function redrawShot(key) { const [ctx, which] = key.split('_'), z = document.getElementById('shot_' + key); if (z) z.outerHTML = shotZone(ctx, which, ui.shots[key]); }
document.addEventListener('paste', e => { const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith('image/')); if (it && document.querySelector('[data-shot]')) { e.preventDefault(); takeShot(it.getAsFile()); } });
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.shotfile; if (k) takeShot(e.target.files[0], k); });
document.addEventListener('click', async e => {
  const x = e.target.closest && e.target.closest('[data-shotx]'); if (x) { delete ui.shots[x.dataset.shotx]; redrawShot(x.dataset.shotx); return; }
  if (e.target.id === 'sendtest') {
    const picked = [['fac', 'test-facility-contacts.jpg'], ['corp', 'test-corporate-contacts.jpg']].filter(([w]) => ui.shots['test_' + w]);
    if (!picked.length) { toast('Paste a screenshot first.'); return; }
    e.target.disabled = true; const saved = {};
    try { for (const [w, name] of picked) { const r = await STORE.uploadFile('TEST', new File([ui.shots['test_' + w].blob], name, { type: 'image/jpeg' })); saved[w] = { name, path: r.path, data: r.data || '' }; } }
    catch (err) { e.target.disabled = false; toast('A screenshot didn\'t upload: ' + (err.message || err)); return; }
    const fake = { id: 0, name: 'Test Facility', group: '', contacts: [{ first: 'Sample', last: 'Contact', dept: 'Administrator', email: 'sample.contact@example.com' }], contactsShot: saved.fac || null, corpShot: saved.corp || null };
    const ok = await act(() => { mail(Object.assign({ key: 'm:TEST:' + uid(), code: 'TEST', to: [me()], link: 'none', subject: 'TEST: in-service & contacts screenshots', body: '<p>This is a test. Below is the contacts part of the in-service & contacts request, the way the wound rep and regional see it. If the screenshots show here, it works.</p><hr>' + e3Contacts(fake) }, e3Attach(fake))); }, 'Test queued. It goes to you within about 5 minutes.');
    if (ok) { ui.testData = Object.assign(ui.testData || {}, ...Object.values(saved).map(v => ({ [v.name]: v.data }))); delete ui.shots.test_fac; delete ui.shots.test_corp; }
    return;
  }
});

// the sticky left menu sits right under the top bar, whatever its height
function setTopH() { const t = document.querySelector('.top'); if (t) document.documentElement.style.setProperty('--topH', t.offsetHeight + 'px'); }
window.addEventListener('resize', setTopH); window.addEventListener('load', setTopH); new ResizeObserver(setTopH).observe(document.querySelector('.top'));
