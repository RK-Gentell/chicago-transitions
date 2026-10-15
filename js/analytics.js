'use strict';
/* =====================================================================
   Analytics screen. Read-only: it only looks at what's already loaded
   (st.facs, st.tasks). Nothing here changes or saves data.
   Loaded before ui.js; uses its helpers at render time.
   ===================================================================== */

// business days from a to b (a not counted, b counted): Mon→Tue = 1
function bizDays(a, b) { if (!a || !b || b <= a) return 0; let n = 0, d = a; while (d < b) { d = add(d, 1); if (!isWE(d)) n++; } return n; }
const avg = xs => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null;
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));

// the 8 checkpoints of a transition (Quick Guide order). done(f) → true/false, on(f) → the day it happened, if known
const MS = [
  { k: 'fc', l: 'FastCare', done: f => done(fTask(f, 'FASTCARE')) || preDone(f, 'fc'), on: f => (fTask(f, 'FASTCARE') || {}).doneOn },
  { k: 'bt', l: 'Brightree report', done: f => !!f.bt || done(fTask(f, 'BRIGHTREE')) || preDone(f, 'e1'), on: f => (fTask(f, 'BRIGHTREE') || {}).doneOn },
  { k: 'pa', l: 'Added to Brightree', done: f => !!f.inPortal, on: f => (fTask(f, 'PORTAL_ADD') || {}).doneOn },
  { k: 'ps', l: 'Portal setup', done: f => done(fTask(f, 'PORTAL_SETUP')) || preDone(f, 'ps') || !!f.email1, on: f => (fTask(f, 'PORTAL_SETUP') || {}).doneOn },
  { k: 'e1', l: 'Chicago handoff email', done: f => !!f.email1, on: f => f.email1 },
  { k: 'e2', l: 'Transfer notice', done: f => !!f.email2, on: f => f.email2 },
  { k: 'e3', l: 'In-service & contacts', done: f => !!f.e3Done || (!!f.complete && !f.email3), on: f => f.e3Done },
  { k: 'gdd', l: 'GDD answer', done: f => done(fTask(f, 'GDD')) || preDone(f, 'gdd') || !!f.gdd, on: f => (fTask(f, 'GDD') || {}).doneOn }
];
// status bucket: Not started (nothing done yet), In progress, On hold, Complete
const BUCKETS = [['Not started', 'var(--an-ns)'], ['In progress', 'var(--accent)'], ['On hold', 'var(--warn)'], ['Complete', 'var(--ok)']];
function bucketOf(f) {
  if (f.hold) return 'On hold';
  if (f.complete) return 'Complete';
  return MS.some(m => m.done(f)) || tasksOf(f).some(t => t.status === 'Done') ? 'In progress' : 'Not started';
}
// the app's own stages, with "In setup" split into Not started / In setup
const STAGES = ['Not started', 'In setup', 'Ready to schedule', 'Emailed Chicago to send', 'Sent by Chicago', 'Complete', 'On hold'];
const stageColor = s => s === 'Complete' ? 'var(--ok)' : s === 'On hold' ? 'var(--warn)' : s === 'Not started' ? 'var(--an-ns)' : 'var(--accent)';
function stage2(f) { const s = stageOf(f)[0]; return s === 'In setup' && bucketOf(f) === 'Not started' ? 'Not started' : s; }
const TYPE_LABEL = { FASTCARE: 'FastCare', BRIGHTREE: 'Brightree report', GDD: 'GDD answer', GDD_PORTAL: 'GDD warehouse in portal', AREAS: 'Areas of care', PRICE: 'Price table', RULE: 'Pick the reps', EMR: 'EMR access', EMR_ADD: 'EMR login: corporate adds facility', EMR_PORTAL: 'EMR info in portal', PORTAL_ADD: 'Add to Brightree', PUMPS: 'Pumps', PORTAL_SETUP: 'Portal setup', CONTACTS_PORTAL: 'Contacts into portal', SCHEDULE: 'Schedule + Chicago handoff email', ADDRESS: 'Address', E3_REPLY: 'In-service & contacts reply', EMAIL3_FOLLOW: 'In-service & contacts follow-up', CHICAGO_FOLLOW: 'Chicago follow-up' };
const typeLabel = t => TYPE_LABEL[t.type] || t.type;
// when a task could first be worked on
const taskStart = t => (t.opensOn && t.opensOn > (t.created || '') ? t.opensOn : t.created) || '';
const leadName = e => e ? nameOf(e) : 'No transition lead';
const LEAD_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

// ---------- data, scoped to the picked transition lead ----------
function anData() {
  const L = ui.an.lead;
  const allFacs = st.facs.filter(f => !f.deleted);
  const facs = allFacs.filter(f => !L || amOf(f) === L);
  const leads = [...new Set(allFacs.map(amOf))].sort((a, b) => leadName(a).localeCompare(leadName(b)));
  const facIds = new Set(facs.map(f => f.id));
  const tasks = st.tasks.filter(t => t.status !== 'Not needed' && (t.fac ? facIds.has(t.fac) : (!L || taskLeads(t).includes(L))));
  return { L, facs, allFacs, leads, tasks };
}
// everything something is waiting on right now: open tasks (by assignee) + the 2 outside waits (Chicago, wound rep / regional)
function waits(d) {
  const out = [];
  d.tasks.filter(t => !done(t) && !t.archived && !isWaiting(t) && !(t.fac && facById(t.fac) && facById(t.fac).hold)).forEach(t => {
    const f = t.fac ? facById(t.fac) : null, lead = taskLeads(t)[0] || '';
    out.push({ who: t.assignee, whoName: nameOf(t.assignee), kind: lead && t.assignee === lead ? 'lead' : 'team', what: taskTitle(t), task: t.key, f, corp: f ? f.group : t.group, lead, since: taskStart(t), days: bizDays(taskStart(t), st.today), late: st.today > t.due });
  });
  d.facs.filter(f => !f.hold && !f.complete && !f.archived).forEach(f => {
    if (f.email1 && !f.email2) out.push({ who: 'chicago', whoName: 'GNS Chicago', kind: 'out', what: 'Transfer notice to the facility', f, corp: f.group, lead: amOf(f), since: f.email1, days: bizDays(f.email1, st.today) });
    if (f.email3 && !f.e3Done && !f.e3Reply) out.push({ who: 'woundreg', whoName: 'Wound rep / regional', kind: 'out', what: 'Reply to the in-service & contacts request', f, corp: f.group, lead: amOf(f), since: f.email3, days: bizDays(f.email3, st.today) });
  });
  out.forEach(w => { if (w.late === undefined) w.late = w.days >= 5; });
  return out;
}

// ---------- small drawing helpers (plain HTML bars, theme colors) ----------
const swatch = c => `<i class="an-sw" style="background:${c}"></i>`;
const legend = items => `<div class="an-legend">${items.map(([l, c]) => `<span>${swatch(c)}${esc(l)}</span>`).join('')}</div>`;
// rows: [{label, parts:[[value, color, tip]], end, click, on, dim}]
function hbars(rows, max) {
  max = max || Math.max(1, ...rows.map(r => r.parts.reduce((s, p) => s + p[0], 0)));
  return `<div class="an-bars">${rows.map(r => `<div class="an-row ${r.click ? 'clk' : ''} ${r.on ? 'on' : ''} ${r.dim ? 'dim' : ''}" ${r.click || ''} title="${esc(r.title || '')}"><div class="an-lab">${r.label}</div><div class="an-track">${r.parts.filter(p => p[0] > 0).map(p => `<span style="width:${p[0] / max * 100}%;background:${p[1]}" title="${esc(p[2] || '')}"></span>`).join('')}</div><div class="an-end">${r.end}</div></div>`).join('') || '<div class="meta">Nothing here.</div>'}</div>`;
}
const tile = (l, v, sub) => `<div class="an-kpi"><div class="an-kl">${l}</div><div class="an-kv">${v === null || v === undefined || v === '' ? '–' : v}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
function track(f) {
  const cur = f.complete ? -1 : MS.findIndex(m => !m.done(f));
  return `<div class="an-trk">${MS.map((m, i) => { const ok = m.done(f), on = m.on(f); const cls = ok ? 'ok' : i === cur ? (f.hold ? 'hold' : 'cur') : ''; return `<i class="${cls}" title="${esc((i + 1) + '. ' + m.l + ': ' + (ok ? 'done' + (on ? ' ' + fmtS(on) : '') : i === cur ? (f.hold ? 'on hold here' : 'next') : 'not yet'))}"></i>`; }).join('')}</div>`;
}

// ---------- page ----------
function analyticsHtml() {
  const d = anData(), A = ui.an;
  const tabs = [['overview', 'Overview'], ['bottlenecks', 'Bottlenecks'], ['schedule', 'Schedule'], ['corporates', 'Corporates']];
  const head = `<h1>Analytics</h1><p class="sub">Live from the app's own data: refreshes when the app does. Facilities completed 30+ days ago are archived and only count after "Show archived" (Tracker or here). Business days throughout.</p>
  <div class="filters"><label class="meta" for="an_lead">Transition lead</label><select id="an_lead"><option value="">All transition leads</option>${d.leads.map(e => `<option value="${esc(e)}" ${e === A.lead ? 'selected' : ''}>${esc(leadName(e))}</option>`).join('')}</select>${STORE.mode === 'sp' ? '<button class="btn sm" id="loadarch">Show archived</button>' : ''}</div>`;
  const nav = `<div class="an-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="an-tab" data-antab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join('')}</div>`;
  const body = A.tab === 'bottlenecks' ? anBottlenecks(d) : A.tab === 'schedule' ? anSchedule(d) : A.tab === 'corporates' ? anCorporates(d) : anOverview(d);
  return head + anKpis(d) + nav + body;
}
function anKpis(d) {
  const c = b => d.facs.filter(f => bucketOf(f) === b).length;
  const late = waits(d).filter(w => w.late).length;
  const doneDays = d.facs.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete));
  return `<div class="an-kpis">${tile('Facilities', d.facs.length)}${tile('Not started', c('Not started'))}${tile('In progress', c('In progress'))}${tile('On hold', c('On hold'))}${tile('Complete', c('Complete'))}${tile('At risk', d.facs.filter(atRisk).length)}${tile('Late waits', late)}${tile('Avg days to complete', avg(doneDays), doneDays.length ? 'days' : '')}</div>`;
}
function anOverview(d) {
  const sc = STAGES.map(s => [s, d.facs.filter(f => stage2(f) === s).length]);
  const stages = hbars(sc.map(([s, n]) => ({ label: esc(s), parts: [[n, stageColor(s), s + ': ' + n]], end: n })));
  const lf = d.allFacs;
  const leadRows = [...new Set(lf.map(amOf))].sort((a, b) => leadName(a).localeCompare(leadName(b))).map(e => {
    const fs = lf.filter(f => amOf(f) === e), cnt = b => fs.filter(f => bucketOf(f) === b).length;
    return { label: esc(leadName(e)), parts: BUCKETS.map(([b, col]) => [cnt(b), col, b + ': ' + cnt(b)]), end: fs.length, click: `data-anlead="${esc(e)}"`, on: d.L === e, dim: d.L && d.L !== e, title: 'Show only ' + leadName(e) };
  });
  const W = waits({ facs: lf, tasks: st.tasks.filter(t => t.status !== 'Not needed') });
  const tbl = [...new Set(lf.map(amOf))].sort((a, b) => leadName(a).localeCompare(leadName(b))).map(e => {
    const fs = lf.filter(f => amOf(f) === e), cnt = b => fs.filter(f => bucketOf(f) === b).length, dd = fs.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete));
    const own = W.filter(w => w.who === e).length, onTheirs = W.filter(w => w.lead === e && w.who !== e).length;
    return `<tr class="${d.L && d.L !== e ? 'an-dimrow' : ''}"><td><button class="linkish an-plain" data-anlead="${esc(e)}">${esc(leadName(e))}</button></td><td class="num">${fs.length}</td><td class="num">${cnt('Not started')}</td><td class="num">${cnt('In progress')}</td><td class="num">${cnt('On hold')}</td><td class="num">${cnt('Complete')}</td><td class="num">${own}</td><td class="num">${onTheirs}</td><td class="num">${fs.filter(atRisk).length || ''}</td><td class="num">${avg(dd) ?? '–'}</td></tr>`;
  }).join('');
  return `<div class="an-grid"><div class="card"><b>Where facilities are now</b><div class="meta an-note">Each facility's stage${d.L ? ' for ' + esc(leadName(d.L)) : ''}. "Not started" = nothing done yet.</div>${stages}</div>
  <div class="card"><b>Facilities per transition lead</b><div class="meta an-note">Click a lead to show only theirs everywhere on this page.</div>${legend(BUCKETS)}${hbars(leadRows)}</div></div>
  <div class="card"><b>Transition lead summary</b><div class="meta an-note">"Open tasks on them" = tasks assigned to the lead. "Waiting on others" = open tasks and outside replies on their facilities that someone else has to do.</div><div class="tablewrap an-tw"><table><tr><th>Transition lead</th><th>Facilities</th><th>Not started</th><th>In progress</th><th>On hold</th><th>Complete</th><th>Open tasks on them</th><th>Waiting on others</th><th>At risk</th><th>Avg days to complete</th></tr>${tbl || '<tr><td colspan="10" class="meta">No facilities yet.</td></tr>'}</table></div></div>`;
}
function anBottlenecks(d) {
  const A = ui.an, W = waits(d);
  const leads = [...new Set(W.map(w => w.lead))].sort((a, b) => leadName(a).localeCompare(leadName(b)));
  const lc2 = Object.fromEntries(d.leads.map((e, i) => [e, LEAD_COLORS[i % LEAD_COLORS.length]]));
  const byWho = kind => { const ws = W.filter(w => w.kind === kind); return [...new Set(ws.map(w => w.who))].map(who => { const g = ws.filter(w => w.who === who); return { who, name: g[0].whoName, n: g.length, late: g.filter(w => w.late).length, oldest: Math.max(...g.map(w => w.days)), g }; }).sort((a, b) => b.n - a.n || b.oldest - a.oldest); };
  const groups = [['team', 'Waiting on someone on the team (not the transition lead)'], ['lead', 'Waiting on the transition lead\'s own steps'], ['out', 'Waiting outside the team']].map(([k, t]) => [t, byWho(k)]).filter(([, r]) => r.length);
  const max = Math.max(1, ...groups.flatMap(([, r]) => r.map(x => x.n)));
  const people = groups.map(([t, rows]) => `<div class="an-sect">${t}</div>` + hbars(rows.map(r => ({ label: esc(r.name), parts: leads.map(l => { const n = r.g.filter(w => w.lead === l).length; return [n, lc2[l] || 'var(--muted)', leadName(l) + "'s transitions: " + n]; }), end: r.n + (r.late ? ` <span class="an-late">${r.late} late</span>` : ''), click: `data-anperson="${esc(r.who)}"`, on: A.person === r.who, dim: A.person && A.person !== r.who, title: 'Oldest: ' + plural(r.oldest, 'business day') + '. Click to list them below.' })), max)).join('');
  // turnaround: finished tasks, by who did them; and by step (incl. the 2 outside waits)
  const fin = d.tasks.filter(t => t.status === 'Done' && t.doneOn && taskStart(t));
  const byPerson = [...new Set(fin.map(t => t.doneBy))].map(p => { const g = fin.filter(t => t.doneBy === p); return { name: g[0].doneByName || nameOf(p), a: avg(g.map(t => bizDays(taskStart(t), t.doneOn))), n: g.length }; }).sort((a, b) => b.a - a.a);
  const steps = [...new Set(fin.map(typeLabel))].map(l => { const g = fin.filter(t => typeLabel(t) === l); return { l, a: avg(g.map(t => bizDays(taskStart(t), t.doneOn))), n: g.length }; });
  const outside = [['GNS Chicago: transfer notice', d.facs.filter(f => f.email1 && f.email2).map(f => bizDays(f.email1, f.email2))], ['Wound rep / regional: reply', d.facs.filter(f => f.email3 && (f.e3Reply || f.e3Done)).map(f => bizDays(f.email3, (f.e3Reply && f.e3Reply.at ? String(f.e3Reply.at).slice(0, 10) : f.e3Done)))]].filter(([, xs]) => xs.length).map(([l, xs]) => ({ l, a: avg(xs), n: xs.length }));
  const stepRows = [...steps, ...outside].sort((a, b) => b.a - a.a), smax = Math.max(1, ...stepRows.map(s => s.a)), pmax = Math.max(1, ...byPerson.map(s => s.a));
  const topStep = stepRows[0];
  const turnP = hbars(byPerson.map(p => ({ label: esc(p.name), parts: [[p.a, 'var(--accent)', p.a + ' days on average']], end: p.a + ' d <span class="meta">· ' + p.n + '</span>' })), pmax);
  const turnS = hbars(stepRows.map(s => ({ label: esc(s.l), parts: [[s.a, s === topStep ? 'var(--bad)' : 'var(--accent)', s.a + ' days on average']], end: s.a + ' d <span class="meta">· ' + s.n + '</span>' })), smax);
  // open list
  const R = A.role, list = W.filter(w => (!A.person || w.who === A.person) && (!R || w.kind === R)).sort((a, b) => b.days - a.days);
  const roleSel = `<select id="an_role" aria-label="Waiting on"><option value="">Everything waiting</option>${[['team', 'On the team'], ['lead', 'On the transition lead'], ['out', 'Outside the team']].map(([v, l]) => `<option value="${v}" ${R === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const rows = list.map(w => `<tr ${w.task ? `class="click" data-task="${esc(w.task)}"` : ''}><td>${esc(w.whoName)}</td><td>${esc(w.what)}</td><td>${w.f ? `${esc(facName(w.f))} · ${facLink(w.f)}` : '<span class="meta">' + esc(w.corp || '') + ' (whole corporate)</span>'}</td><td>${esc(leadName(w.lead))}</td><td class="num">${fmtS(w.since)}</td><td class="num ${w.late ? 'an-bad' : ''}">${w.days}</td></tr>`).join('');
  return `<div class="card"><b>Who has things waiting on them</b><div class="meta an-note">Open tasks by who has to act, colored by the transition lead running that facility. Tasks that haven't started yet and facilities on hold aren't counted. "Late" = past the task's due date, or 5+ business days for outside replies. Click a name to list theirs below.</div>${legend(leads.map(l => [leadName(l), lc2[l] || 'var(--muted)']))}${people || '<div class="meta">Nothing is waiting on anyone.</div>'}</div>
  <div class="an-grid"><div class="card"><b>How long each person takes</b><div class="meta an-note">Average business days from when a task could start to when they marked it done. The small number is how many tasks.</div>${turnP}</div>
  <div class="card"><b>How long each step takes</b><div class="meta an-note">Same, by step, plus the 2 outside waits. Slowest in red.</div>${turnS}</div></div>
  <div class="card"><div class="row" style="align-items:center;justify-content:space-between"><b>Everything waiting <span class="meta">${list.length}</span></b><div class="row" style="align-items:center">${A.person ? `<button class="btn sm" data-anperson="">${esc((W.find(w => w.who === A.person) || {}).whoName || nameOf(A.person))} ×</button>` : ''}${roleSel}</div></div><div class="tablewrap an-tw" style="margin-top:8px;max-height:480px;overflow:auto"><table><tr><th>Waiting on</th><th>What</th><th>Facility</th><th>Transition lead</th><th>Since</th><th>Business days</th></tr>${rows || '<tr><td colspan="6" class="meta">Nothing.</td></tr>'}</table></div></div>`;
}
function anSchedule(d) {
  const fs = d.facs.filter(f => f.dates && f.dates.dos);
  const monday = s => add(s, -((dow(s) + 6) % 7));
  const weeks = [...new Set(fs.map(f => monday(f.dates.dos)))].sort();
  const max = Math.max(1, ...weeks.map(w => fs.filter(f => monday(f.dates.dos) === w).length));
  const thisWk = monday(st.today);
  const cols = weeks.map(w => { const g = fs.filter(f => monday(f.dates.dos) === w), c = g.filter(f => f.complete || f.email1).length, o = g.length - c; return `<div class="an-col ${w === thisWk ? 'now' : ''}" title="${esc('Week of ' + fmtS(w) + ': ' + g.map(f => facName(f)).join(', '))}"><div class="an-cn">${g.length}</div><div class="an-cb"><span style="height:${o / max * 100}%;background:var(--warn)"></span><span style="height:${c / max * 100}%;background:var(--ok)"></span></div><div class="an-cl">${fmtS(w).slice(0, -3)}</div></div>`; }).join('');
  const soon = fs.filter(f => !f.complete && f.dates.ord >= st.today && f.dates.ord <= addBiz(st.today, 15)).sort((a, b) => a.dates.ord.localeCompare(b.dates.ord));
  return `<div class="card"><b>First dates of service by week</b><div class="meta an-note">Week starting Monday. Facilities get dates once they have an address with a ship point.</div>${legend([['Chicago handoff email sent', 'var(--ok)'], ['Not emailed to Chicago yet', 'var(--warn)']])}${weeks.length ? `<div class="an-cols">${cols}</div>` : '<div class="meta">No dates yet.</div>'}</div>
  <div class="card"><b>Ordering in the next 3 weeks</b><div class="meta an-note">Not complete yet, soonest first.</div><div class="tablewrap an-tw" style="margin-top:8px"><table><tr><th>Facility</th><th>Corporate</th><th>Transition lead</th><th>Stage</th><th>Ordering</th><th>First DOS</th><th>Delivery</th></tr>${soon.map(f => { const [s, c] = stageOf(f); return `<tr class="click" data-fac="${f.id}"><td><b>${esc(facName(f))}</b></td><td>${esc(f.group)}</td><td>${esc(leadName(amOf(f)))}</td><td><span class="pill ${c}">${s}</span>${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</td><td class="num">${fmtS(f.dates.ord)}</td><td class="num">${fmtS(f.dates.dos)}</td><td class="num">${fmtS(f.dates.del)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="meta">Nothing ordering in the next 3 weeks.</td></tr>'}</table></div></div>`;
}
function anCorporates(d) {
  const A = ui.an, q = lc(A.cq || '');
  const ck = f => lc(f.group || '__nocorp'), label = k => k === '__nocorp' ? 'No corporate yet' : (grp(k) ? grp(k).name : k);
  const keys = [...new Set(d.facs.map(ck))].sort((a, b) => d.facs.filter(f => ck(f) === b).length - d.facs.filter(f => ck(f) === a).length || label(a).localeCompare(label(b)));
  const shown = keys.filter(k => !q || lc(label(k)).includes(q));
  if (!A.corp || !keys.includes(A.corp)) { A.corp = keys[0] || null; A.step = null; }
  const picker = shown.map(k => { const g = d.facs.filter(f => ck(f) === k), n = b => g.filter(f => bucketOf(f) === b).length; return `<button class="an-pick" data-ancorp="${esc(k)}" aria-current="${k === A.corp}"><span class="n"><span>${esc(label(k))}</span><span>${n('Complete')}/${g.length}</span></span><span class="an-mini">${BUCKETS.map(([b, c]) => n(b) ? `<i style="flex:${n(b)};background:${c}"></i>` : '').join('')}</span></button>`; }).join('') || '<div class="meta">No match.</div>';
  const k = A.corp; if (!k) return '<div class="empty">No facilities yet.</div>';
  const g = d.facs.filter(f => ck(f) === k), n = b => g.filter(f => bucketOf(f) === b).length;
  const who = (title, fn) => { const m = {}; g.forEach(f => { const e = fn(f); m[e] = (m[e] || 0) + 1; }); const es = Object.entries(m).sort((a, b) => b[1] - a[1]); return `<span>${es.length > 1 ? title + 's' : title}: ${es.map(([e, c]) => `<b>${esc(e ? nameOf(e) : 'none')}</b> (${c})`).join(', ')}</span>`; };
  const dd = g.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete));
  const next = g.filter(f => !f.complete && f.dates && f.dates.dos >= st.today).map(f => f.dates.dos).sort()[0];
  const sc = STAGES.map(s => [s, g.filter(f => stage2(f) === s).length]), smax = Math.max(1, ...sc.map(x => x[1]));
  const cols = sc.map(([s, c]) => `<button class="an-col an-stagecol ${A.step === s ? 'on' : ''} ${A.step && A.step !== s ? 'dim' : ''}" data-anstep="${esc(s)}" title="${esc(s + ': ' + c + '. Click to show only these.')}"><div class="an-cn">${c}</div><div class="an-cb"><span style="height:${c / smax * 100}%;background:${c ? stageColor(s) : 'transparent'}"></span></div><div class="an-cl">${esc(s)}</div></button>`).join('');
  const order = { 'In progress': 0, 'On hold': 1, 'Not started': 2, Complete: 3 };
  const list = g.filter(f => !A.step || stage2(f) === A.step).sort((a, b) => order[bucketOf(a)] - order[bucketOf(b)] || MS.filter(m => m.done(b)).length - MS.filter(m => m.done(a)).length || facName(a).localeCompare(facName(b)));
  const rows = list.map(f => { const [s, c] = stageOf(f), w = waitingOn(f), open = tasksOf(f).filter(t => !done(t) && !isWaiting(t)); const next2 = f.complete ? 'Done ' + fmtS(f.complete) : [...open.map(t => typeLabel(t) + ' (' + nameOf(t.assignee) + ')'), ...w].slice(0, 3).join(' · ') || '–';
    return `<tr><td><button class="linkish an-plain" data-fac="${f.id}">${esc(facName(f))}</button><div class="meta">CT-${pad(f.id)}</div></td><td><span class="pill ${c}">${s}</span>${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</td><td style="min-width:170px">${track(f)}<div class="meta">${MS.filter(m => m.done(f)).length} of ${MS.length} steps</div></td><td class="meta" style="max-width:260px">${esc(next2)}</td><td>${esc(leadName(amOf(f)))}</td><td>${esc(nameOf(acctOf(f)) || '–')}</td><td class="num">${f.dates ? fmtS(f.dates.dos) : ''}</td></tr>`; }).join('');
  return `<div class="an-corp"><aside class="card an-picker"><b>Corporates</b><input type="text" id="an_cq" placeholder="Search" value="${esc(A.cq || '')}" aria-label="Search corporates"><div class="an-picklist">${picker}</div></aside>
  <div class="an-corpmain"><div class="card"><div class="an-cname">${esc(label(k))}</div><div class="an-people">${who('Transition lead', amOf)}${who('Account manager', acctOf)}</div>
  <div class="an-kpis an-kpis-sm">${tile('Facilities', g.length)}${tile('Complete', n('Complete'))}${tile('In progress', n('In progress'))}${tile('Not started', n('Not started'))}${tile('On hold', n('On hold'))}${tile('Avg days to complete', avg(dd))}${tile('Next first DOS', next ? fmtS(next) : '')}</div>
  <div class="an-sect">Facilities at each stage <span class="meta">click one to show only those</span></div><div class="an-cols an-cols-sm">${cols}</div></div>
  <div class="card"><div class="row" style="align-items:center;justify-content:space-between"><b>Facilities <span class="meta">${list.length}</span></b>${A.step ? `<button class="btn sm" data-anstep="">${esc(A.step)} ×</button>` : ''}</div><div class="meta an-note">Progress = the 8 steps: ${MS.map((m, i) => (i + 1) + '. ' + m.l).join(' · ')}. Hover a segment for the date.</div>${legend([['Done', 'var(--ok)'], ['Next', 'var(--accent)'], ['On hold here', 'var(--warn)'], ['Not yet', 'var(--line2)']])}<div class="tablewrap an-tw"><table><tr><th>Facility</th><th>Stage</th><th>Progress</th><th>Waiting on</th><th>Transition lead</th><th>Account manager</th><th>First DOS</th></tr>${rows || '<tr><td colspan="7" class="meta">None.</td></tr>'}</table></div></div></div></div>`;
}
function analyticsAfter() { if (ui.an.focus) { const i = document.getElementById(ui.an.focus); if (i) { i.focus(); const p = i.value.length; i.setSelectionRange(p, p); } ui.an.focus = null; } }

// ---------- clicks / changes (called from ui.js) ----------
function analyticsClick(T) {
  if (ui.view !== 'analytics') return false;
  const tb = T.closest('[data-antab]'); if (tb) { ui.an.tab = tb.dataset.antab; render(); return true; }
  const ld = T.closest('[data-anlead]'); if (ld) { ui.an.lead = ui.an.lead === ld.dataset.anlead ? '' : ld.dataset.anlead; ui.an.person = ''; render(); return true; }
  const pr = T.closest('[data-anperson]'); if (pr) { ui.an.person = ui.an.person === pr.dataset.anperson ? '' : pr.dataset.anperson; render(); return true; }
  const cp = T.closest('[data-ancorp]'); if (cp) { ui.an.corp = cp.dataset.ancorp; ui.an.step = null; render(); return true; }
  const sp = T.closest('[data-anstep]'); if (sp) { ui.an.step = !sp.dataset.anstep || ui.an.step === sp.dataset.anstep ? null : sp.dataset.anstep; render(); return true; }
  return false;
}
function analyticsChange(el) {
  if (el.id === 'an_lead') { ui.an.lead = el.value; ui.an.person = ''; render(); }
  if (el.id === 'an_role') { ui.an.role = el.value; render(); }
}
document.addEventListener('input', e => { if (e.target.id === 'an_cq') { ui.an.cq = e.target.value; ui.an.focus = 'an_cq'; render(); } });
