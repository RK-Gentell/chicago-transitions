'use strict';
/* =====================================================================
   New facility scheduling (Oct 22 2026)
   Facilities that are new to GNS (not coming from Chicago) that only need
   scheduling. 1 request = 1 facility = 1 "Schedule" task for the schedule lead.
   - st.nfs        the records (CT Data rows, Kind "nf", key nf:0042). The number
                   comes from CT Numbers, so it never clashes with a CT number.
   - dates         date of service = last supply date with the previous provider + 30
                   (no previous provider: as soon as possible). The ordering date is
                   at least a week from today. Part B only → ordering 2 business days
                   before the DOS, otherwise 1. Delivery = DOS + Ship Point (state).
   - David's team  account manager = Settings "Intake reps picked at scheduling":
                   no intake rep until the schedule task; same rules and the same
                   per-day count as the Chicago transitions (repLoad counts both).
   - Mark done     emails the account manager, intake rep and Settings
                   "nfNotify" (Naomi Cohen, Malka Heiman), CC the schedule lead.
   ===================================================================== */

const nfs = () => (st && st.nfs) || [];
const nfById = i => nfs().find(n => n.id === i);
const nfNo = n => 'NF-' + pad(n.id);
const nfTask = n => st.tasks.find(t => t.nf === n.id && t.type === 'NF_SCHEDULE');
const nfBack = n => n.partB ? 2 : 1;
// David's facilities not scheduled yet: no intake rep until the schedule task
const nfAutoPending = n => !!n && !n.deleted && !n.scheduled && isAutoAcct(n.acct);
const nfNotify = () => (st.settings.nfNotify || []).filter(validEmail);

function nfDerive(n, dos) {
  const back = nfBack(n), sp = shipOf(st.settings.shipEnt, n.state) || 1, ord = addBiz(dos, -back), del = addBiz(dos, sp);
  return { dos, ord, del, os: diff(ord, del), day: WD[dow(del)], partB: !!n.partB, ship: sp, shipOst: shipOf(st.settings.shipOst, n.state), back };
}
// the recommended dates, or null (no state with a ship point, or no last supply date)
function nfCalc(n) {
  if (!stateOK(n)) return null;
  const back = nfBack(n), why = [];
  let dos;
  if (n.noPrev) { dos = st.today; why.push('No previous provider → as soon as possible'); }
  else if (n.last) { dos = add(n.last, 30); why.push('Last supply date with the previous provider ' + fmtS(n.last) + ' + 30 = ' + fmtS(dos)); }
  else return null;
  if (isWE(dos)) { const m = dow(dos) === 6 ? add(dos, 2) : add(dos, 1); if (!n.noPrev) why.push(fmtS(dos) + ' is a weekend → Monday ' + fmtS(m)); dos = m; }
  // first orders start processing a week before the ordering date
  const weekOut = add(st.today, 7), from = dos;
  while (addBiz(dos, -back) < weekOut) dos = addBiz(dos, 1);
  if (dos !== from) why.push((n.noPrev ? 'The first ordering date at least a week from today' : 'Ordering date ' + fmtS(addBiz(from, -back)) + ' is within a week of today → pushed') + ': ordering ' + fmtS(addBiz(dos, -back)) + ', DOS ' + fmtS(dos));
  let capFrom = '';
  if (nfAutoPending(n)) {
    const cd = autoDos(n, dos, back);
    if (cd !== dos) { capFrom = dos; why.push('Everyone on ' + first(nameOf(autoAcct())) + '\'s team already has ' + AUTO_REP_FULL + ' or more facilities ordering ' + fmtS(addBiz(dos, -back)) + ' → pushed so ordering is ' + fmtS(addBiz(cd, -back)) + '. DOS ' + fmtS(cd)); dos = cd; }
    const p = autoPick(addBiz(dos, -back), n.id);
    if (p) why.push('Intake rep: ' + nameOf(p) + ' (' + (repLoad(addBiz(dos, -back), n.id)[p] || 0) + ' other facilities ordering that day)');
  }
  const sp = shipOf(st.settings.shipEnt, n.state) || 1;
  why.push((n.partB ? 'Part B only → ordering 2 business days' : 'Not Part B only → ordering 1 business day') + ' before DOS');
  why.push('Ship Point ' + n.state + ' = ' + sp + ' → delivery DOS + ' + sp + ' business day' + (sp > 1 ? 's' : ''));
  return Object.assign(nfDerive(n, dos), { why, capFrom, from });
}
function nfDateWarn(n, dos) {
  const r = n.rec, w = []; if (!r) return w;
  if (r.capFrom && dos < r.dos && dos >= r.capFrom) w.push('The recommended ' + fmt(r.dos) + ' was pushed out because ' + first(nameOf(autoAcct())) + '\'s team was full on the earlier days. Check the intake rep below.');
  if (!n.noPrev && n.last && dos < add(n.last, 30)) { const k = diff(dos, add(n.last, 30)); w.push('This DOS is ' + k + ' day' + (k > 1 ? 's' : '') + ' before 30 days after the last supply date with the previous provider (' + fmtS(n.last) + '). Their last supply may not be used up yet.'); }
  if (isWE(dos)) w.push('This DOS is on a ' + WD[dow(dos)] + '.');
  const d = nfDerive(n, dos);
  if (d.ord < addBiz(st.today, 1)) w.push('The ordering date (' + fmt(d.ord) + ') has already passed or is today.');
  else if (d.ord < add(st.today, 7)) w.push('The ordering date (' + fmt(d.ord) + ') is less than a week from today. First orders usually start processing a week before the ordering date.');
  return w;
}
function nfSaveDates(n, dos, byName) {
  if (n.rec && dos === n.rec.dos) { n.dosChosen = ''; n.dosBy = ''; n.dates = n.rec; return; }
  n.dosChosen = dos; n.dosBy = byName;
  n.dates = Object.assign(nfDerive(n, dos), { why: [...(n.rec ? n.rec.why : []), 'Changed by ' + byName + (n.rec ? ' from the recommended ' + fmtS(n.rec.dos) : '')], changed: true });
}
// positions left blank on the request: Malka ("Picks the reps") gets a task; scheduling waits for it
const NF_POS = [['acct', 'account manager'], ['rep', 'intake rep'], ['lead', 'schedule lead']];
const nfNeeds = n => NF_POS.map(x => x[0]).filter(k => k === 'rep' ? !n.rep && !nfAutoPending(n) : !n[k]);
const nfRepsTask = n => st.tasks.find(t => t.nf === n.id && t.type === 'NF_REPS' && !done(t) && !t.archived);
const nfStage = n => n.deleted ? ['Deleted', 'p-req'] : n.scheduled ? ['Scheduled', 'p-done'] : nfNeeds(n).length ? ['Needs reps', 'p-setup'] : !n.dates ? ['Needs dates', 'p-hold'] : ['Ready to schedule', 'p-ready'];
const nfRepTxt = n => n.rep ? esc(nameOf(n.rep)) : nfAutoPending(n) ? '<span class="meta" title="' + esc(AUTO_REP_TIP) + '">Picked at scheduling</span>' : '<span class="meta">none</span>';

// One-time (10/22/2026): who else gets the "Scheduled" email. Naomi Cohen and Malka Heiman. Runs once, then Settings has it.
function importNf20261022() {
  const s = st.settings; if (!s || (s.imported || []).includes('nf-2026-10-22')) return;
  if (!s.nfNotify) s.nfNotify = [['Naomi Cohen', 'naomi@gentell.com'], ['Malka Heiman', 'malka@gentell.com']].map(([n, e]) => { const p = person(n) || person(e); return p && validEmail(p.email) ? lc(p.email) : st.demo ? '' : e; }).filter(Boolean);
  s.imported = [...(s.imported || []), 'nf-2026-10-22'];
}

// called from run(): dates recalculate every day until it's scheduled; David's facilities keep no intake rep until then
function nfRun() {
  if (!st || !st.settings) return;
  importNf20261022();
  nfs().forEach(n => {
    if (n.deleted || n.scheduled) return;
    if (nfAutoPending(n) && n.rep) { (n.repHistory = n.repHistory || []).push({ rep: n.rep, on: st.today, why: 'Cleared: account manager ' + nameOf(autoAcct()) + ', intake rep picked at scheduling' }); n.rep = ''; }
    const r = nfCalc(n); n.rec = r || null;
    n.dates = !r ? null : n.dosChosen ? Object.assign(nfDerive(n, n.dosChosen), { why: [...r.why, 'Changed by ' + (n.dosBy || 'someone') + ' from the recommended ' + fmtS(r.dos)], changed: true }) : r;
    const need = nfNeeds(n), rt = nfRepsTask(n);
    if (need.length && !rt && !st.tasks.some(x => x.nf === n.id && x.type === 'NF_REPS' && !done(x))) {
      const t2 = newTask('NF_REPS', { nf: n.id, assignee: roleEmail('rules') });
      todo(t2, 'pick the reps for ' + n.name + ' (new facility)', 'Pick the ' + need.map(k => NF_POS.find(x => x[0] === k)[1]).join(', ') + ' for the new facility <b>' + esc(n.name) + '</b>' + (n.group ? ' (' + esc(n.group) + ')' : '') + '. It gets scheduled once they\'re in.');
    }
    if (!need.length && rt) { rt.status = 'Not needed'; rt.doneOn = st.today; } // filled in some other way (Edit details)
    if (need.length) return;
    let t = nfTask(n);
    if (!t) { t = newTask('NF_SCHEDULE', { nf: n.id, assignee: n.lead || fallbackOwner(), amTask: true }); todo(t, 'schedule ' + n.name + ' (new facility)', 'Schedule the new facility <b>' + esc(n.name) + '</b>' + (n.group ? ' (' + esc(n.group) + ')' : '') + '.'); }
    // the task follows the schedule lead if it changes
    if (t.amTask && !done(t) && n.lead && t.assignee !== n.lead) {
      t.assignee = n.lead; t.due = addBiz(st.today, isAm(n.lead) ? st.settings.amDays : st.settings.helperDays);
      mail({ key: 'm:E20:' + t.key + ':' + uid(), code: 'E20', to: [n.lead], subject: 'You\'re now the schedule lead: ' + n.name, body: `<p>${esc(n.editedBy || 'Someone')} made you the schedule lead for the new facility <b>${esc(n.name)}</b>. Due ${fmt(t.due)}.</p>`, task: t.key, cond: { task: t.key } });
    }
  });
}
function nfScheduledMail(n, byName) {
  const d = n.dates;
  mail({ key: 'm:E30:' + n.id, code: 'E30', to: [n.acct, n.rep, ...nfNotify()], cc: [n.lead], link: 'none', fyi: true, subject: 'Scheduled: ' + n.name,
    body: `<p><b>${esc(n.name)}</b>${n.group ? ' (' + esc(n.group) + ')' : ''} is scheduled.</p><p>First order: date of service <b>${fmt(d.dos)}</b>, ordering ${fmt(d.ord)}, delivery ${fmt(d.del)}.${n.cad && n.cad !== '4' ? ' Enteral ships ' + esc(CAD_L[n.cad] || '').toLowerCase() + '.' : ''}</p><p>Intake rep: ${esc(nameOf(n.rep)) || '-'}<br>Account manager: ${esc(nameOf(n.acct)) || '-'}<br>Schedule lead: ${esc(nameOf(n.lead)) || '-'}</p><p>Scheduled by ${esc(byName)}.</p>` });
}
function nfDelete(n, byName) {
  n.deleted = true; n.deletedBy = byName; n.deletedOn = st.today;
  st.tasks.filter(t => t.nf === n.id).forEach(t => { if (!done(t)) { t.status = 'Not needed'; t.doneOn = st.today; } t.archived = true; });
}

// ---------- the form (request and edit) ----------
// v: { name, addr, corp, pb: 'yes'|'no', last, noPrev, cad, acct, rep, lead }
function nfFields(p, n) {
  n = n || {};
  const R = peopleOpts(repList()), A = peopleOpts(amList()), corps = [...new Set([...Object.values(st.groups).map(g => g.name), ...nfs().filter(x => !x.deleted).map(x => x.group)].filter(Boolean))].sort(az);
  return `<section><h2 class="rqh">Facility</h2>
    <div class="row">${fld('Facility name', txt(p + 'name', n.name, 'As it is in the portal'))}${fld('Corporate', `<input type="text" id="${p}corp" list="${p}corp_dl" value="${esc(n.group || '')}" placeholder="Corporate group" autocomplete="off"><datalist id="${p}corp_dl">${corps.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>`, 'No corporate? Type the facility name.')}</div>
    <div class="row">${fld('Address', txt(p + 'addr', n.address, '123 Main St, City, ST 12345'), 'The state (2 letters or the full name) and zip go at the end. The state decides the ship point and the delivery date.')}</div>
    <div class="row">${fld('Part B only?' + tip('Part B only: the ordering date is 2 business days before the date of service. Not Part B only: 1 business day.'), sel(p + 'pb', [['yes', 'Part B only'], ['no', 'Not Part B only']], n.partB === true ? 'yes' : n.partB === false ? 'no' : ''))}${fld('Enteral ships', sel(p + 'cad', ['Monthly', 'Weekly', 'Biweekly'], CAD_L[n.cad] || 'Monthly', true))}</div></section>
    <section><h2 class="rqh">Previous provider${tip('The first date of service can be 30 days after the last supply date with the previous provider. No previous provider: as soon as possible. Either way, the ordering date is at least a week from today.')}</h2>
    <div class="row" style="align-items:flex-end">${fld('Last supply date with previous provider', dt(p + 'last', n.noPrev ? '' : n.last))}</div>${chk(p + 'noprev', 'No previous provider (schedule as soon as possible)', !!n.noPrev)}</section>
    <section><h2 class="rqh">GNS Lakewood roles${tip('All optional. Anything left blank goes to ' + esc(roleName('rules')) + ' on a "Pick the reps" task, and scheduling waits for it. The account manager comes first: for ' + esc(nameOf(autoAcct()) || 'some account managers') + ', the intake rep is picked automatically at scheduling. The schedule lead gets the task to schedule it.')}</h2>
    <div class="row">${fld('Account manager', sel(p + 'acct', withCur(R, n.acct), n.acct, true))}${fld('Intake rep', sel(p + 'rep', withCur(R, n.rep), n.rep, true))}${fld('Schedule lead', sel(p + 'lead', withCur(A, n.lead), n.lead, true))}</div></section>
    <div id="${p}prev"></div>`;
}
function nfRead(p) { return { name: V(p + 'name'), addr: V(p + 'addr'), corp: V(p + 'corp'), pb: V(p + 'pb'), last: V(p + 'noprev') ? '' : V(p + 'last'), noPrev: !!V(p + 'noprev'), cad: CAD_V[V(p + 'cad')] || '4', acct: V(p + 'acct'), rep: V(p + 'rep'), lead: V(p + 'lead') }; }
function nfProblem(v, old) {
  if (!v.name) return 'Type the facility name.';
  if (!v.corp) return 'Type the corporate. No corporate? Type the facility name.';
  if (!v.addr) return 'Type the address.';
  const ap = addressProblem(v.addr); if (ap) return ap;
  if (!['yes', 'no'].includes(v.pb)) return 'Pick "Part B only" or "Not Part B only".';
  if (!v.noPrev && !v.last) return 'Enter the last supply date with the previous provider, or tick "No previous provider".';
  if (v.last && v.last > st.today) return 'The last supply date can\'t be in the future.';
  // reps are optional on the request (left blank → "Pick the reps" task), but once entered they can't be cleared
  if (old) for (const [k, l] of NF_POS) if (old[k] && !v[k] && !(k === 'rep' && isAutoAcct(v.acct))) return 'The ' + l + ' can\'t be left blank. It was entered before; change it to someone else if it\'s wrong.';
  return '';
}
// what the form would schedule (no saving)
function nfTemp(v, id) { const a = normAddr(v.addr); return { id: id || -1, name: v.name, address: a, state: stateFrom(a), group: v.corp, partB: v.pb === 'yes', last: v.last, noPrev: v.noPrev, cad: v.cad, acct: v.acct, rep: v.rep, lead: v.lead }; }
function nfPreview(p, id) {
  const box = document.getElementById(p + 'prev'); if (!box) return;
  const v = nfRead(p), n = nfTemp(v, id);
  const last = document.getElementById(p + 'last'); if (last) last.disabled = v.noPrev;
  if (!v.addr || addressProblem(v.addr) || !['yes', 'no'].includes(v.pb) || (!v.noPrev && !v.last) || (v.last && v.last > st.today)) { box.innerHTML = '<div class="note">The recommended dates show here once the address, Part B only and the last supply date (or "No previous provider") are in.</div>'; return; }
  const r = nfCalc(n); if (!r) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="padding:10px"><b>Recommended</b><div style="margin-top:4px">Ordering <b>${fmt(r.ord)}</b> · date of service <b>${fmt(r.dos)}</b> · delivery <b>${fmt(r.del)}</b></div>${nfAutoPending(n) ? '<div class="meta">Intake rep: picked at scheduling (' + esc(nameOf(autoPick(r.ord, n.id)) || 'everyone is full that day') + ' right now).</div>' : ''}<div class="meta">The schedule lead can change the date on the schedule task. It recalculates every day until it's scheduled.</div></div>`;
}

// ---------- screens ----------
function nfRequestHtml() {
  return `<h1>New facility scheduling request</h1><p class="sub">For facilities new to GNS that aren't coming from GNS Chicago. Leave a rep blank if you don't know it: ${esc(roleName('rules'))} gets a task to pick it. The schedule lead gets a task to schedule it, and once it's scheduled the account manager, intake rep, ${nfNotify().map(nameOf).join(' and ') || 'the people in Settings'} get an email.</p>
  <div class="row" style="margin-bottom:10px;align-items:center"><button class="btn sm" data-view="bulknf">Bulk upload (Excel)</button><span class="meta">Many facilities from many corporates at once.</span></div>
  <form id="nff" class="card rqform">${nfFields('nf_')}<div id="nf_err"></div><div><button class="btn pri" type="submit">Submit scheduling request</button></div></form>`;
}
function nfTrackerHtml() {
  const q = lc(ui.nfq || ''), F = ui.nfFilter || 'active';
  const list = nfs().filter(n => !n.deleted && (F === 'all' || (F === 'active' ? !n.scheduled : !!n.scheduled)) && (!q || lc(n.name + ' ' + n.group + ' ' + nfNo(n)).includes(q))).sort((a, b) => b.id - a.id);
  return `<h1>New facilities tracker</h1><p class="sub">New facilities (not from GNS Chicago) being scheduled. Click a row to see or change its details.</p>
  <div class="filters"><input type="text" id="nfq" placeholder="Search facility, corporate, NF number" value="${esc(ui.nfq || '')}">${[['active', 'To schedule'], ['sched', 'Scheduled'], ['all', 'All']].map(([v, l]) => `<button class="btn sm ${F === v ? 'pri' : ''}" data-nffilter="${v}">${l}</button>`).join('')}<button class="btn sm" id="nfcsv">Download as Excel (CSV)</button><button class="btn sm pri" data-view="nfnew" style="margin-left:auto">+ New facility scheduling request</button></div>
  <div class="tablewrap"><table><tr><th>NF</th><th>Facility</th><th>Corporate</th><th>Stage</th><th>Part B only</th><th>Account manager</th><th>Intake rep</th><th>Schedule lead</th><th>First DOS</th><th>Ordering</th><th>Delivery</th><th>Requested</th></tr>${list.map(n => { const [s, c] = nfStage(n); return `<tr class="click" data-nf="${n.id}"><td class="num">${pad(n.id)}</td><td><b>${esc(n.name)}</b></td><td>${esc(n.group)}</td><td><span class="pill ${c}">${s}</span></td><td>${n.partB ? 'Yes' : 'No'}</td><td>${esc(nameOf(n.acct))}</td><td>${nfRepTxt(n)}</td><td>${esc(nameOf(n.lead))}</td><td class="num">${n.dates ? fmtS(n.dates.dos) : ''}</td><td class="num">${n.dates ? fmtS(n.dates.ord) : ''}</td><td class="num">${n.dates ? fmtS(n.dates.del) : ''}</td><td class="num">${fmtS(n.requested)}</td></tr>`; }).join('') || '<tr><td colspan="12" class="meta">No facilities here.</td></tr>'}</table></div>`;
}
function nfCsv() {
  const rows = [['NF', 'Facility', 'Corporate', 'Address', 'Stage', 'Part B only', 'Last supply date', 'Enteral ships', 'Account manager', 'Intake rep', 'Schedule lead', 'First DOS', 'Ordering', 'Delivery', 'Scheduled on', 'Requested', 'Requested by']];
  nfs().filter(n => !n.deleted).forEach(n => rows.push([nfNo(n), n.name, n.group, n.address, nfStage(n)[0], n.partB ? 'Yes' : 'No', n.noPrev ? 'No previous provider' : fmtS(n.last), CAD_L[n.cad] || 'Monthly', nameOf(n.acct), nameOf(n.rep), nameOf(n.lead), n.dates ? fmtS(n.dates.dos) : '', n.dates ? fmtS(n.dates.ord) : '', n.dates ? fmtS(n.dates.del) : '', fmtS(n.scheduled), fmtS(n.requested), n.requesterName || nameOf(n.requester)]));
  const csv = rows.map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'New facilities ' + st.today + '.csv'; a.click();
}
function nfDrawer(n) {
  const [s, c] = nfStage(n), t = nfTask(n), d = n.dates;
  const kv = `<div class="kv"><div>Corporate</div><div>${esc(n.group) || '-'}</div><div>Address</div><div>${esc(n.address)} ${n.state ? '(' + esc(n.state) + ')' : ''}</div><div>Part B only</div><div>${n.partB ? 'Yes' : 'No'}</div><div>Previous provider</div><div>${n.noPrev ? 'None (as soon as possible)' : 'Last supply ' + fmt(n.last)}</div><div>Enteral ships</div><div>${esc(CAD_L[n.cad] || 'Monthly')}</div><div>Account manager</div><div>${esc(nameOf(n.acct)) || '-'}</div><div>Intake rep</div><div>${nfRepTxt(n)}${n.repAuto ? '<div class="meta">' + (n.repAuto.override ? 'Picked by hand at scheduling (the rules picked ' + esc(nameOf(n.repAuto.pick) || 'nobody: everyone was full') + ')' : 'Picked automatically at scheduling') + ', ordering ' + fmtS(n.repAuto.ord) + '</div>' : ''}</div><div>Schedule lead</div><div>${esc(nameOf(n.lead))}</div>${d ? `<div>First DOS</div><div class="num">${fmt(d.dos)}</div><div>Ordering</div><div class="num">${fmt(d.ord)}</div><div>Delivery</div><div class="num">${fmt(d.del)} · OS Days ${d.os}</div>` : ''}<div>Scheduled</div><div>${n.scheduled ? fmt(n.scheduled) + (n.schedBy ? ' by ' + esc(n.schedBy) : '') : 'Not yet'}</div><div>Requested</div><div>${fmt(n.requested)}${n.requesterName ? ' by ' + esc(n.requesterName) : ''}</div></div>`;
  const ms = st.mails.filter(m => m.key === 'm:E30:' + n.id || (t && m.task === t.key));
  const edit = n.scheduled ? '<div class="meta">It\'s scheduled, so the details can\'t change here anymore.</div>' : `<details class="card" style="padding:10px" id="nfedbox"><summary><b>Edit details</b> <span class="meta">(dates recalculate)</span></summary><form id="nfe" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${nfFields('nfe_', n)}<div id="nfe_err"></div><div><button class="btn sm pri" type="submit">Save details</button></div></form></details>`;
  return `<div class="scrim" data-close></div><div class="drawer" role="dialog" aria-label="New facility"><header><div style="flex:1;min-width:0"><div class="meta">${nfNo(n)} · new facility · ${esc(n.group || '')}</div><h1 style="font-size:17px">${esc(n.name)}</h1><span class="pill ${c}">${s}</span></div>${closeX}</header><div class="body">
  ${nfRepsTask(n) ? `<div class="row"><button class="btn pri sm" data-task="${esc(nfRepsTask(n).key)}">Open the "Pick the reps" task</button><span class="meta">Assigned to ${esc(nameOf(nfRepsTask(n).assignee))}. Still needed: ${esc(nfNeeds(n).map(k => NF_POS.find(x => x[0] === k)[1]).join(', '))}</span></div>` : ''}
  ${t && !done(t) ? `<div class="row"><button class="btn pri sm" data-task="${esc(t.key)}">Open the schedule task</button><span class="meta">Assigned to ${esc(nameOf(t.assignee))}, due ${fmtS(t.due)}</span></div>` : ''}
  ${kv}${attachCard('nf', n)}${edit}
  ${isAdmin(me()) && !n.scheduled ? '<div class="row"><button class="btn sm" data-nfdel="' + n.id + '" style="margin-left:auto">Delete (test or mistake)</button></div>' : ''}
  <h2 style="margin:4px 0 0">Emails from the app</h2>${ms.some(m => m.status !== 'Cancelled') ? mailSections(ms, isAdmin(me()), 'h3') : '<div class="meta">None yet.</div>'}</div></div>`;
}
function nfDateEditor(n) {
  const d = n.dates, r = n.rec, w = nfDateWarn(n, d.dos);
  return `<div class="card" style="padding:10px"><b>${d.changed ? 'Dates (changed)' : 'Recommended dates'}</b>${tip('Change any 1 date and the other 2 move with it.')}
  <div class="row">${fld('Ordering date', dt('nde_ord', d.ord))}${fld('Date of service', dt('nde_dos', d.dos))}${fld('Delivery date', dt('nde_del', d.del))}</div>
  <div class="meta" id="nde_info">${d.day} delivery · OS Days ${d.os} · ${d.partB ? 'Part B only: ordering 2 business days before DOS' : 'ordering 1 business day before DOS'} · Ship Point ${d.ship}</div>
  <div id="nde_warn">${w.map(x => '<div class="err" style="margin-top:6px">' + esc(x) + '</div>').join('')}</div>
  ${r && d.changed ? `<div class="meta">Recommended: ${fmt(r.dos)}.</div>` : ''}
  <details style="margin-top:6px"><summary class="meta">How the recommended dates were calculated</summary><ul class="meta">${(r || d).why.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></details>
  <div class="row" style="margin-top:6px"><button type="button" class="btn sm pri" data-nfsavedates="${n.id}">Save dates</button>${d.changed ? `<button type="button" class="btn sm" data-nfrecdates="${n.id}">Back to recommended</button>` : ''}</div></div>`;
}
function nfDeLive(changed) {
  const b = document.querySelector('[data-nfsavedates]'); if (!b) return;
  const n = nfById(+b.dataset.nfsavedates); if (!n || !n.dates) return;
  const r = nfDerive(n, n.dates.dos), v = V(changed); if (!v) return;
  const dos = changed === 'nde_dos' ? v : changed === 'nde_ord' ? addBiz(v, r.back) : addBiz(v, -r.ship), d = nfDerive(n, dos);
  $('#nde_ord').value = d.ord; $('#nde_dos').value = d.dos; $('#nde_del').value = d.del;
  $('#nde_info').textContent = d.day + ' delivery · OS Days ' + d.os + ' · ' + (d.partB ? 'Part B only: ordering 2 business days before DOS' : 'ordering 1 business day before DOS') + ' · Ship Point ' + d.ship;
  $('#nde_warn').innerHTML = nfDateWarn(n, dos).map(x => '<div class="err" style="margin-top:6px">' + esc(x) + '</div>').join('');
}

// ---------- the schedule task ----------
TT.NF_SCHEDULE = {
  title: t => 'Schedule new facility: ' + ((nfById(t.nf) || {}).name || nfNo({ id: t.nf })),
  form: t => {
    const n = nfById(t.nf); if (!n) return '<div class="err">This facility isn\'t there anymore.</div>';
    if (!n.dates) return '<div class="err">No dates yet: the address needs a state that has a ship point. Fix it under "Edit details" on the facility (New facilities tracker).</div>';
    const d = n.dates, auto = nfAutoPending(n);
    return `<div class="kv"><div>Corporate</div><div>${esc(n.group)}</div><div>Address</div><div>${esc(n.address)}</div><div>Part B only</div><div>${n.partB ? 'Yes' : 'No'}</div><div>Previous provider</div><div>${n.noPrev ? 'None (as soon as possible)' : 'Last supply ' + fmt(n.last)}</div><div>Account manager</div><div>${esc(nameOf(n.acct))}</div>${auto ? '' : `<div>Intake rep</div><div>${esc(nameOf(n.rep))}</div>`}${(n.files || []).length ? `<div>Attachments</div><div>${n.files.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(', ')}</div>` : ''}</div>
    ${nfDateEditor(n)}${auto ? autoRepBox(n) : ''}
    <div class="instr"><ol><li>"Facilities" → schedule icon under "Actions" → "Facility Schedule".</li><li>"Start Date" <span class="q">${fmtS(d.del)}</span>, "Day of the Week" <span class="q">${d.day}</span>, "Weeks" <span class="q">4</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>${n.cad && n.cad !== '4' ? `<li>"Select Area of Care" → "Enteral" → "Add Schedule": same Start Date and day, "Weeks" <span class="q">${n.cad}</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>` : ''}<li>"Generate Dates" → check "Override Manually" → "Save".</li><li>"Schedules" → Ordering Calendar → open the entry on ${fmt(d.ord)} and check the 3 dates match the ones above. Wrong? Recheck Start Date, Day of the Week and OS Days and generate again. Missing? The ordering date probably landed on a weekend.</li>${auto ? `<li>"Facilities" → edit pencil: "Insurance Specialist" and "Intake Specialist" = the intake rep picked above. "Save".</li>` : ''}</ol></div>
    <div class="note">"Mark done" emails ${esc([nameOf(n.acct), auto ? 'the intake rep' : nameOf(n.rep), ...nfNotify().map(nameOf)].filter(Boolean).join(', '))} that it's scheduled${n.lead ? ', CC ' + esc(nameOf(n.lead)) : ''}. Changed a date above? Click "Save dates" first.</div>`;
  },
  example: () => ({}),
  validate: t => {
    const n = nfById(t.nf); if (!n || n.deleted) return 'This facility isn\'t there anymore.';
    if (!n.dates) return 'No dates yet: fix the address under "Edit details" first.';
    if (nfAutoPending(n) && !V('sc_rep')) return 'Pick the intake rep.';
    if (!nfAutoPending(n) && !n.rep) return 'The facility has no intake rep. Pick one under "Edit details".';
    if (n.dates.ord < st.today) return 'The ordering date has passed. Change the dates above and click "Save dates" first.';
    return '';
  },
  done: (t, ctx) => {
    const n = nfById(t.nf), by = ctx ? ctx.byName : '';
    if (nfAutoPending(n)) autoAssign(n, V('sc_auto') === V('sc_rep') ? '' : V('sc_rep'), by);
    n.scheduled = st.today; n.schedBy = by;
    nfScheduledMail(n, by);
  }
};
NO_REOPEN.add('NF_SCHEDULE');

TT.NF_REPS = {
  title: t => 'Pick the reps for new facility: ' + ((nfById(t.nf) || {}).name || nfNo({ id: t.nf })),
  form: t => {
    const n = nfById(t.nf); if (!n) return '<div class="err">This facility isn\'t there anymore.</div>';
    const R = peopleOpts(repList()), A = peopleOpts(amList()), need = nfNeeds(n), box = (k, html) => need.includes(k) ? html.replace('<div class="field">', '<div class="field need">') : html;
    return `<div class="instr">The request for <b>${esc(n.name)}</b>${n.group ? ' (' + esc(n.group) + ')' : ''} left ${esc(need.map(k => NF_POS.find(x => x[0] === k)[1]).join(', ')) || 'nothing'} blank. Pick ${need.length > 1 ? 'them' : 'it'} and it goes to the schedule lead to schedule.</div>
    <div class="kv"><div>Address</div><div>${esc(n.address)}</div><div>Part B only</div><div>${n.partB ? 'Yes' : 'No'}</div>${n.dates ? `<div>Recommended DOS</div><div>${fmt(n.dates.dos)}</div>` : ''}<div>Requested by</div><div>${esc(n.requesterName || nameOf(n.requester))}</div></div>
    <div class="row">${box('acct', fld('Account manager', sel('nr_acct', withCur(R, n.acct), n.acct, true)))}${box('rep', fld('Intake rep', sel('nr_rep', withCur(R, n.rep), n.rep, true)))}${box('lead', fld('Schedule lead', sel('nr_lead', withCur(A, n.lead), n.lead, true)))}</div><div class="meta">Boxes outlined in blue are the ones still needed.</div>`;
  },
  example: () => ({ nr_acct: lc(repList()[0].email), nr_rep: lc(repList()[0].email), nr_lead: lc(amList()[0].email) }),
  validate: t => {
    const n = nfById(t.nf); if (!n || n.deleted) return 'This facility isn\'t there anymore.';
    if (!V('nr_acct')) return 'Pick the account manager.';
    if (!isAutoAcct(V('nr_acct')) && !V('nr_rep')) return 'Pick the intake rep.';
    if (!V('nr_lead')) return 'Pick the schedule lead.';
    return '';
  },
  done: t => { const n = nfById(t.nf); n.acct = V('nr_acct'); n.rep = isAutoAcct(n.acct) ? '' : V('nr_rep'); n.lead = V('nr_lead'); }
};
NO_REOPEN.add('NF_REPS');

// ---------- clicks, typing, forms ----------
document.addEventListener('click', async e => {
  const T = e.target;
  const row = T.closest('[data-nf]'); if (row) { ui.openNf = +row.dataset.nf; ui.openTask = ui.openFac = ui.openGroup = ui.next = null; renderLayer(); nfPreview('nfe_', ui.openNf); return; }
  const fl = T.closest('[data-nffilter]'); if (fl) { ui.nfFilter = fl.dataset.nffilter; render(); return; }
  if (T.id === 'nfcsv') { nfCsv(); return; }
  const sd = T.closest('[data-nfsavedates]'); if (sd) { const id = +sd.dataset.nfsavedates, dos = V('nde_dos'); if (!dos) return; await act(() => { const n = nfById(id); if (!n || n.scheduled) return false; nfSaveDates(n, dos, meName()); }, 'Dates saved'); return; }
  const rd = T.closest('[data-nfrecdates]'); if (rd) { const id = +rd.dataset.nfrecdates; await act(() => { const n = nfById(id); if (!n || !n.rec || n.scheduled) return false; nfSaveDates(n, n.rec.dos, meName()); }, 'Back to recommended dates'); return; }
  const dl = T.closest('[data-nfdel]'); if (dl) { const id = +dl.dataset.nfdel; if (!confirm('Delete this facility? Its schedule task closes. Use it for tests or mistakes.')) return; const ok = await act(() => { const n = nfById(id); if (!n || n.scheduled) return false; nfDelete(n, meName()); }, 'Deleted'); if (ok) { ui.openNf = null; renderLayer(); } return; }
});
document.addEventListener('input', e => {
  if (e.target.id === 'nfq') { ui.nfq = e.target.value; const pos = e.target.selectionStart; render(); const x = $('#nfq'); x.focus(); x.setSelectionRange(pos, pos); return; }
  const id = e.target.id || ''; if (/^nf_/.test(id)) { if (id === 'nf_name') ui.nfConfirmDup = false; nfPreview('nf_'); } if (/^nfe_/.test(id)) nfPreview('nfe_', ui.openNf);
});
document.addEventListener('change', e => {
  const id = e.target.id || '';
  if (/^nf_/.test(id)) nfPreview('nf_'); if (/^nfe_/.test(id)) nfPreview('nfe_', ui.openNf);
  if (['nde_ord', 'nde_dos', 'nde_del'].includes(id)) nfDeLive(id);
});
document.addEventListener('submit', async e => {
  const id = e.target.id;
  if (id === 'nff' || id === 'nfe') e.preventDefault();
  if (id === 'nff') {
    const v = nfRead('nf_'), err = nfProblem(v), box = $('#nf_err');
    if (err) { box.innerHTML = '<div class="err">' + esc(err) + '</div>'; return; }
    const dup = nfs().find(n => !n.deleted && lc(n.name) === lc(v.name)) || st.facs.find(f => !f.archived && !f.complete && (lc(f.name) === lc(v.name) || lc(f.portalName) === lc(v.name)));
    if (dup && !ui.nfConfirmDup) { ui.nfConfirmDup = true; box.innerHTML = '<div class="err">"' + esc(v.name) + '" is already in the app (' + (dup.req ? 'CT-' + pad(dup.id) + ', Chicago transitions' : nfNo(dup) + ', new facilities') + '). Submit again if this really is a new request.</div>'; return; }
    $('#nff button[type=submit]').disabled = true; box.innerHTML = '<div class="meta">Saving…</div>';
    const ok = await act(async () => {
      const [nid] = await STORE.allocateIds(1);
      const a = normAddr(v.addr);
      st.nfs.push({ id: nid, name: v.name, address: a, state: stateFrom(a), group: v.corp, partB: v.pb === 'yes', last: v.last, noPrev: v.noPrev, cad: v.cad, acct: v.acct, rep: isAutoAcct(v.acct) ? '' : v.rep, lead: v.lead, requested: st.today, requester: me(), requesterName: meName() });
    }, 'Scheduling request submitted');
    if (ok) { ui.nfConfirmDup = false; ui.view = 'nftracker'; render(); }
    else { const b = $('#nff button[type=submit]'); if (b) b.disabled = false; }
    return;
  }
  if (id === 'nfe') {
    const nid = ui.openNf, v = nfRead('nfe_'), err = nfProblem(v, nfById(nid));
    if (err) { $('#nfe_err').innerHTML = '<div class="err">' + esc(err) + '</div>'; return; }
    await act(() => {
      const n = nfById(nid); if (!n || n.scheduled || n.deleted) { toast('It\'s scheduled already, so it can\'t change.'); return false; }
      const a = normAddr(v.addr), pb = v.pb === 'yes';
      // a date of service picked by hand was based on the old details: it goes back to the new recommended one
      if (a !== n.address || pb !== !!n.partB || v.last !== (n.last || '') || v.noPrev !== !!n.noPrev) { n.dosChosen = ''; n.dosBy = ''; }
      Object.assign(n, { name: v.name, address: a, state: stateFrom(a), group: v.corp, partB: pb, last: v.last, noPrev: v.noPrev, cad: v.cad, acct: v.acct, lead: v.lead, editedBy: meName(), editedOn: st.today });
      if (!isAutoAcct(v.acct)) n.rep = v.rep;
      const rt = nfRepsTask(n);
      if (rt && !nfNeeds(n).length) {
        rt.status = 'Done'; rt.doneBy = me(); rt.doneByName = meName(); rt.doneOn = st.today; rt.doneAt = nowIso(); rt.closedOnFac = true;
        if (rt.assignee && rt.assignee !== me()) mail({ key: 'm:E25:' + rt.key + ':' + uid(), code: 'E25', to: [rt.assignee], link: 'none', subject: 'Not needed anymore: ' + taskTitle(rt), body: `<p>Hi ${esc(first(nameOf(rt.assignee)))},</p><p>${esc(meName())} filled in the reps for the new facility <b>${esc(n.name)}</b>, so you don't need to do this task.</p>` });
      }
    }, 'Saved');
  }
});
