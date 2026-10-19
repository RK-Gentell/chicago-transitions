'use strict';
/* =====================================================================
   Analytics screen (same layout as the "Transition Lead Analytics" preview).
   Read-only: it only looks at what's already loaded (st.facs, st.tasks,
   st.mails). Nothing here changes or saves data.
   Loaded before ui.js; uses its helpers at render time.
   ===================================================================== */

// business days from a to b (a not counted, b counted): Mon→Tue = 1
function bizDays(a, b) { if (!a || !b || b <= a) return 0; let n = 0, d = a; while (d < b) { d = add(d, 1); if (!isWE(d)) n++; } return n; }
const avg = xs => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null;
const latest = xs => xs.filter(Boolean).sort().pop() || '';

// the 8 steps of a transition, in Quick Guide order.
// done(f): finished. on(f): the day it finished. start(f): when it could start (for "days on step"). took(f): business days it took.
const tk = (f, type) => fTask(f, type);
const tTook = t => t && t.status === 'Done' && t.doneOn ? bizDays(taskStart(t), t.doneOn) : null;
const MS = [
  { l: 'FastCare', s: 'FastCare', done: f => done(tk(f, 'FASTCARE')) || preDone(f, 'fc'), on: f => (tk(f, 'FASTCARE') || {}).doneOn, task: 'FASTCARE' },
  { l: 'Brightree report', s: 'Brightree report', done: f => !!f.bt || done(tk(f, 'BRIGHTREE')) || preDone(f, 'e1'), on: f => (tk(f, 'BRIGHTREE') || {}).doneOn, task: 'BRIGHTREE' },
  { l: 'Added to Brightree', s: 'In Brightree', done: f => !!f.inPortal, on: f => (tk(f, 'PORTAL_ADD') || {}).doneOn, task: 'PORTAL_ADD' },
  { l: 'Portal setup', s: 'Portal setup', done: f => done(tk(f, 'PORTAL_SETUP')) || preDone(f, 'ps') || !!f.email1, on: f => (tk(f, 'PORTAL_SETUP') || {}).doneOn, task: 'PORTAL_SETUP' },
  { l: 'Schedule + Chicago handoff email', s: 'Handoff email', done: f => !!f.email1, on: f => f.email1, task: 'SCHEDULE' },
  { l: 'Transfer notice from Chicago', s: 'Transfer notice', done: f => !!f.email2, on: f => f.email2, start: f => f.email1, took: f => f.email1 && f.email2 ? bizDays(f.email1, f.email2) : null },
  { l: 'Contacts from wound rep / regional', s: 'Contacts', done: f => !!f.e3Done || (!!f.complete && !f.email3), on: f => f.e3Done, start: f => f.email3, took: f => f.email3 && f.e3Done ? bizDays(f.email3, f.e3Done) : null },
  { l: 'GDD answer', s: 'GDD', done: f => done(tk(f, 'GDD')) || preDone(f, 'gdd') || !!f.gdd, on: f => (tk(f, 'GDD') || {}).doneOn, task: 'GDD' }
];
MS.forEach((m, i) => { m.n = i + 1; m.name = (i + 1) + '. ' + m.l; });
const stepTook = (m, f) => m.took ? m.took(f) : tTook(tk(f, m.task));
// status: Not started (nothing done yet), In progress, On hold, Complete
const BUCKETS = [['Not started', 'var(--an-ns)'], ['In progress', 'var(--accent)'], ['On hold', 'var(--warn)'], ['Complete', 'var(--ok)']];
const bucketColor = b => (BUCKETS.find(x => x[0] === b) || [0, 'var(--accent)'])[1];
function bucketOf(f) {
  if (f.hold) return 'On hold';
  if (f.complete) return 'Complete';
  return MS.some(m => m.done(f)) || tasksOf(f).some(t => t.status === 'Done') ? 'In progress' : 'Not started';
}
// the step a facility is on: 0 = not started, 1–8, 9 = complete, 10 = on hold
function stepNo(f) { const b = bucketOf(f); if (b === 'Complete') return 9; if (b === 'On hold') return 10; if (b === 'Not started') return 0; const i = MS.findIndex(m => !m.done(f)); return i < 0 ? 8 : i + 1; }
const STEP_ROWS = [[0, 'Not started'], ...MS.map(m => [m.n, m.name]), [9, 'Complete'], [10, 'On hold']];
const stepRowColor = n => n === 0 ? 'var(--an-ns)' : n === 9 ? 'var(--ok)' : n === 10 ? 'var(--warn)' : 'var(--accent)';
const curStep = f => { const n = stepNo(f); if (n === 0) return 'Not started'; if (n === 9) return 'Complete'; const i = MS.findIndex(m => !m.done(f)); return n === 10 ? 'On hold' + (i >= 0 ? ' at ' + MS[i].name : '') : MS[n - 1].name; };
// business days on the current step (in progress only)
function daysOnStep(f) {
  if (bucketOf(f) !== 'In progress') return null;
  const m = MS[stepNo(f) - 1]; if (!m) return null;
  const t = m.task && tk(f, m.task);
  const start = (t && !done(t) && taskStart(t)) || (m.start && m.start(f)) || latest([...MS.map(x => x.done(f) && x.on(f)), f.requested]);
  return start ? bizDays(start, st.today) : null;
}
const TYPE_LABEL = { FASTCARE: 'FastCare', BRIGHTREE: 'Brightree report', GDD: 'GDD answer', GDD_PORTAL: 'GDD warehouse in portal', AREAS: 'Areas of care', PRICE: 'Price table', RULE: 'Pick the reps', EMR: 'EMR access', EMR_ADD: 'EMR login: corporate adds facility', EMR_PORTAL: 'EMR info in portal', PORTAL_ADD: 'Add to Brightree', PUMPS: 'Pumps', PORTAL_SETUP: 'Portal setup', CONTACTS_PORTAL: 'Contacts into portal', SCHEDULE: 'Schedule + Chicago handoff email', ADDRESS: 'Address', E3_REPLY: 'Contacts reply', EMAIL3_FOLLOW: 'Contacts follow-up', CHICAGO_FOLLOW: 'Chicago follow-up' };
const typeLabel = t => TYPE_LABEL[t.type] || t.type;
// when a task could first be worked on
const taskStart = t => (t.opensOn && t.opensOn > (t.created || '') ? t.opensOn : t.created) || '';
const leadName = e => e ? nameOf(e) : 'No transition lead';
const LEAD_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const leadSort = (a, b) => leadName(a).localeCompare(leadName(b));

// ---------- data, scoped to the picked transition lead ----------
function anData() {
  const L = ui.an.lead;
  const allFacs = st.facs.filter(f => !f.deleted);
  const facs = allFacs.filter(f => !L || amOf(f) === L);
  const leads = [...new Set(allFacs.map(amOf))].sort(leadSort);
  const facIds = new Set(facs.map(f => f.id));
  const tasks = st.tasks.filter(t => t.status !== 'Not needed' && (t.fac ? facIds.has(t.fac) : (!L || taskLeads(t).includes(L))));
  return { L, facs, allFacs, leads, tasks };
}
// everything waiting on someone right now: open tasks (by assignee) + the 2 outside waits (GNS Chicago, wound rep / regional)
// kind: 'lead' = the transition lead's own step, 'others' = anyone else (team or outside)
function waits(d) {
  const out = [];
  d.tasks.filter(t => !done(t) && !t.archived && !isWaiting(t) && !(t.fac && facById(t.fac) && facById(t.fac).hold)).forEach(t => {
    const f = t.fac ? facById(t.fac) : null, lead = taskLeads(t)[0] || '';
    out.push({ who: t.assignee, whoName: nameOf(t.assignee), kind: lead && t.assignee === lead ? 'lead' : 'others', what: taskTitle(t), t, task: t.key, f, corp: f ? f.group : t.group, lead, since: taskStart(t), days: bizDays(taskStart(t), st.today), late: st.today > t.due });
  });
  d.facs.filter(f => !f.hold && !f.complete && !f.archived).forEach(f => {
    if (f.email1 && !f.email2) out.push({ who: 'chicago', whoName: 'GNS Chicago', kind: 'others', what: 'Transfer notice to the facility', f, corp: f.group, lead: amOf(f), since: f.email1, days: bizDays(f.email1, st.today) });
    if (f.email3 && !f.e3Done && !f.e3Reply) out.push({ who: 'woundreg', whoName: 'Wound rep / regional', kind: 'others', what: 'Reply to the contacts request', f, corp: f.group, lead: amOf(f), since: f.email3, days: bizDays(f.email3, st.today) });
  });
  out.forEach(w => { if (w.late === undefined) w.late = w.days >= 5; });
  return out;
}

// ---------- drawing helpers (plain HTML, theme colors; hover shows a small popover) ----------
const tipAttr = lines => ` data-tip="${esc(JSON.stringify(lines))}"`;
const swatch = c => `<i class="an-sw" style="background:${c}"></i>`;
const legend = items => `<div class="an-legend">${items.map(([l, c]) => `<span>${swatch(c)}${esc(l)}</span>`).join('')}</div>`;
// rows: [{label, parts:[[value, color, tipLines]], end, click, on, dim}]
function hbars(rows, max) {
  max = max || Math.max(1, ...rows.map(r => r.parts.reduce((s, p) => s + (p[0] || 0), 0)));
  return `<div class="an-bars">${rows.map(r => `<div class="an-row ${r.click ? 'clk' : ''} ${r.on ? 'on' : ''} ${r.dim ? 'dim' : ''}" ${r.click || ''}><div class="an-lab" title="${esc(r.plain || '')}">${r.label}</div><div class="an-track">${r.parts.filter(p => p[0] > 0).map(p => `<span style="width:${p[0] / max * 100}%;background:${p[1]}"${p[2] ? tipAttr(p[2]) : ''}></span>`).join('')}</div><div class="an-end">${r.end}</div></div>`).join('') || '<div class="meta">Nothing here.</div>'}</div>`;
}
const tile = (l, v, sub) => `<div class="an-kpi"><div class="an-kl">${l}</div><div class="an-kv">${v === null || v === undefined || v === '' ? '–' : v}${sub && v !== null && v !== '' && v !== undefined ? `<small>${sub}</small>` : ''}</div></div>`;
const card = (id, title, note, body) => `<div class="card an-card" id="${id}"><h3>${title}</h3>${note ? `<p class="an-note">${note}</p>` : ''}${body}</div>`;
const statusPill = b => `<span class="an-pill" style="--pc:${bucketColor(b)}">${esc(b)}</span>`;
function track(f) {
  const n = stepNo(f), cur = n >= 1 && n <= 8 ? n - 1 : n === 10 ? MS.findIndex(m => !m.done(f)) : -1;
  return `<div class="an-trk">${MS.map((m, i) => { const ok = m.done(f), on = m.on(f), took = stepTook(m, f); const cls = ok ? 'ok' : i === cur ? (f.hold ? 'hold' : 'cur') : ''; return `<i class="${cls}"${tipAttr([[m.name], ['Status', ok ? 'Done' : i === cur ? (f.hold ? 'On hold here' : 'Current step') : 'Not yet'], ...(on ? [['Finished', fmtS(on)]] : []), ...(took !== null && took !== undefined && ok ? [['Took', took + ' business days']] : [])])}></i>`; }).join('')}</div>`;
}

// ---------- page ----------
function analyticsHtml() {
  const d = anData(), A = ui.an;
  const tabs = [['overview', 'Overview'], ['bottlenecks', 'Bottlenecks'], ['schedule', 'Schedule'], ['corporates', 'Corporates'], ['facilities', 'Facilities']];
  const c = b => d.facs.filter(f => bucketOf(f) === b).length;
  const W = waits(d), byP = {}; W.forEach(w => byP[w.whoName] = (byP[w.whoName] || 0) + 1);
  const top = Object.entries(byP).sort((a, b) => b[1] - a[1])[0];
  const takeaway = `${d.L ? esc(leadName(d.L)) : 'All transition leads'}: ${c('Complete')} of ${d.facs.length} done, ${c('In progress')} in progress, ${c('On hold')} on hold.${top ? ` Most open work is waiting on <b>${esc(top[0])}</b> (${top[1]}).` : ''}`;
  const head = `<div class="an-head"><div><h1 class="an-title">Analytics</h1><p class="an-take" id="an_takeaway">${takeaway}</p></div><label class="an-leadpick"><span>Transition lead</span><select id="an_lead" aria-label="Transition lead"><option value="">All transition leads</option>${d.leads.map(e => `<option value="${esc(e)}" ${e === A.lead ? 'selected' : ''}>${esc(leadName(e))}</option>`).join('')}</select></label></div>`;
  const doneDays = d.facs.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete));
  const kpis = `<div class="an-kpis" id="an_kpis">${tile('Facilities', d.facs.length)}${tile('Not started', c('Not started'))}${tile('In progress', c('In progress'))}${tile('On hold', c('On hold'))}${tile('Complete', c('Complete'))}${tile('Stalled 5+ days', d.facs.filter(f => (daysOnStep(f) || 0) >= 5).length)}${tile('Avg days to complete', avg(doneDays), 'days')}</div>`;
  const nav = `<div class="an-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="an-tab" data-antab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join('')}</div>`;
  const body = A.tab === 'bottlenecks' ? anBottlenecks(d, W) : A.tab === 'schedule' ? anSchedule(d) : A.tab === 'corporates' ? anCorporates(d) : A.tab === 'facilities' ? anFacilities(d) : anOverview(d);
  return `<div class="an">${head}${kpis}${nav}${body}<div class="an-tip" id="an_tip"></div></div>`;
}

function anOverview(d) {
  const rows = STEP_ROWS.map(([n, l]) => { const v = d.facs.filter(f => stepNo(f) === n).length; return { label: esc(l), plain: l, parts: [[v, stepRowColor(n), [[l], ['Facilities', v]]]], end: v }; });
  const lf = d.allFacs, leads = [...new Set(lf.map(amOf))].sort(leadSort);
  const work = leads.map(e => { const fs = lf.filter(f => amOf(f) === e), n = b => fs.filter(f => bucketOf(f) === b).length;
    return { label: esc(leadName(e)), plain: leadName(e), parts: BUCKETS.map(([b, col]) => [n(b), col, [[leadName(e)], [b, n(b)], ['Total', fs.length]]]), end: fs.length, click: `data-anlead="${esc(e)}"`, on: d.L === e, dim: d.L && d.L !== e }; });
  const tbl = leads.map(e => { const fs = lf.filter(f => amOf(f) === e), n = b => fs.filter(f => bucketOf(f) === b).length, dd = fs.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete)), stalled = fs.filter(f => (daysOnStep(f) || 0) >= 5).length;
    return `<tr class="${d.L && d.L !== e ? 'an-dimrow' : ''}"><td><button class="linkish an-plain" data-anlead="${esc(e)}">${esc(leadName(e))}</button></td><td class="num">${fs.length}</td><td class="num">${n('Not started')}</td><td class="num">${n('In progress')}</td><td class="num">${n('On hold')}</td><td class="num">${n('Complete')}</td><td class="num ${stalled ? 'an-bad' : ''}">${stalled}</td><td class="num">${avg(dd) ?? '–'}</td></tr>`; }).join('');
  return `<div class="an-grid">${card('an_pipeline', 'Where facilities are now', 'Facilities at each step of the transition' + (d.L ? ' for ' + esc(leadName(d.L)) : '') + '. On hold facilities are counted on their own.', hbars(rows))}
  ${card('an_workload', 'Workload by transition lead', 'Facilities per lead by status. Click a lead to see only theirs on every tab.', legend(BUCKETS) + hbars(work))}</div>
  ${card('an_leadsum', 'Lead summary', 'Every lead side by side. Avg days to complete counts business days from the request to complete. Stalled = 5+ business days on the same step.', `<div class="tablewrap an-tw"><table><tr><th>Lead</th><th class="num">Facilities</th><th class="num">Not started</th><th class="num">In progress</th><th class="num">On hold</th><th class="num">Complete</th><th class="num">Stalled 5+ days</th><th class="num">Avg days to complete</th></tr>${tbl || '<tr><td colspan="8" class="meta">No facilities yet.</td></tr>'}</table></div>`)}`;
}

function anBottlenecks(d, W) {
  const A = ui.an;
  const leads = [...new Set(W.map(w => w.lead))].sort(leadSort);
  const lc2 = Object.fromEntries(d.leads.map((e, i) => [e, LEAD_COLORS[i % LEAD_COLORS.length]]));
  const byWho = kind => { const ws = W.filter(w => w.kind === kind); return [...new Set(ws.map(w => w.who))].map(who => { const g = ws.filter(w => w.who === who); return { who, name: g[0].whoName, n: g.length, late: g.filter(w => w.late).length, oldest: Math.max(...g.map(w => w.days)), g }; }).sort((a, b) => b.n - a.n || b.oldest - a.oldest); };
  const groups = [['Waiting on others', byWho('others')], ['Waiting on the lead\'s own steps', byWho('lead')]].filter(([, r]) => r.length);
  const max = Math.max(1, ...groups.flatMap(([, r]) => r.map(x => x.n)));
  const people = groups.map(([t, rows]) => `<div class="an-sect">${t}</div>` + hbars(rows.map(r => ({ label: esc(r.name), plain: r.name, parts: leads.map(l => { const g = r.g.filter(w => w.lead === l); return [g.length, lc2[l] || 'var(--muted)', [[r.name + (r.g[0].kind === 'lead' ? ' (own steps)' : '')], ['Lead running it', leadName(l)], ['Open', g.length], ['Late', g.filter(w => w.late).length], ['Oldest', (g.length ? Math.max(...g.map(w => w.days)) : 0) + ' business days']]]; }), end: r.n + (r.late ? ` <span class="an-late">· ${r.late} late</span>` : ''), click: `data-anperson="${esc(r.who)}"`, on: A.person === r.who, dim: A.person && A.person !== r.who })), max)).join('');
  // turnaround: finished tasks by the person who did them, plus the 2 outside waits
  const fin = d.tasks.filter(t => t.status === 'Done' && t.doneOn && taskStart(t));
  const byPerson = [...new Set(fin.map(t => t.doneBy))].map(p => { const g = fin.filter(t => t.doneBy === p); return { name: g[0].doneByName || nameOf(p), a: avg(g.map(t => bizDays(taskStart(t), t.doneOn))), n: g.length }; });
  const outside = [['GNS Chicago', d.facs.filter(f => f.email1 && f.email2).map(f => bizDays(f.email1, f.email2))], ['Wound rep / regional', d.facs.filter(f => f.email3 && (f.e3Reply || f.e3Done)).map(f => bizDays(f.email3, (f.e3Reply && f.e3Reply.at ? String(f.e3Reply.at).slice(0, 10) : f.e3Done)))]].filter(([, xs]) => xs.length).map(([name, xs]) => ({ name, a: avg(xs), n: xs.length }));
  const pr = [...byPerson, ...outside].sort((a, b) => b.a - a.a), pmax = Math.max(1, ...pr.map(x => x.a));
  const turnP = hbars(pr.map((p, i) => ({ label: esc(p.name), plain: p.name, parts: [[p.a, i === 0 && pr.length > 1 ? 'var(--bad)' : 'var(--accent)', [[p.name], ['Avg business days', p.a], ['Finished', p.n]]]], end: p.a + ' d' })), pmax);
  const steps = MS.map(m => { const xs = d.facs.map(f => m.done(f) ? stepTook(m, f) : null).filter(x => x !== null && x !== undefined); return { m, a: avg(xs), n: xs.length }; });
  const smax = Math.max(1, ...steps.map(s => s.a || 0)), slow = Math.max(...steps.map(s => s.a || 0));
  const turnS = hbars(steps.map(s => ({ label: esc(s.m.name), plain: s.m.name, parts: [[s.a || 0, s.a && s.a === slow ? 'var(--bad)' : 'var(--accent)', [[s.m.name], ['Avg business days', s.a ?? '–'], ['Finished', s.n]]]], end: s.a === null ? '–' : s.a + ' d' })), smax);
  // the open list
  const R = A.role, list = W.filter(w => (!A.person || w.who === A.person) && (!R || w.kind === R)).sort((a, b) => b.days - a.days);
  const roleSel = `<select id="an_role" aria-label="Waiting on"><option value="">Everyone</option><option value="others" ${R === 'others' ? 'selected' : ''}>Waiting on others</option><option value="lead" ${R === 'lead' ? 'selected' : ''}>Waiting on the lead</option></select>`;
  const pName = A.person ? ((W.find(w => w.who === A.person) || {}).whoName || nameOf(A.person)) : '';
  const rows = list.map(w => `<tr ${w.task ? `class="click" data-task="${esc(w.task)}"` : ''}><td>${esc(w.whoName)}</td><td>${esc(w.what)}</td><td>${w.f ? `<button class="linkish an-plain" data-facpage="${w.f.id}">${esc(facName(w.f))}</button>` : '<span class="meta">' + esc(w.corp || '') + ' (whole corporate)</span>'}</td><td class="tl-hide-narrow">${esc(leadName(w.lead))}</td><td class="num tl-hide-narrow">${fmtS(w.since)}</td><td class="num ${w.late ? 'an-bad' : ''}">${w.days}</td><td>${w.t && typeof remindBtn === 'function' ? remindBtn(w.t) : ''}</td></tr>`).join('');
  return `${card('an_waiting', 'Who has tasks waiting on them', 'Open tasks by the person who has to act, colored by the lead running that transition. Tasks that haven\'t started yet and facilities on hold aren\'t counted. Late = past the task\'s due date, or 5+ business days for GNS Chicago and the wound rep / regional. Click a person to see their tasks below.', legend(leads.map(l => [leadName(l), lc2[l] || 'var(--muted)'])) + (people || '<div class="meta">Nothing is waiting on anyone.</div>'))}
  <div class="an-grid">${card('an_turnaround', 'Average turnaround by person', 'Business days from when a task could start to when it was done, for transitions run by the selected lead. GNS Chicago = handoff email to transfer notice. Wound rep / regional = contacts request to reply. Slowest in red.', turnP)}
  ${card('an_steptime', 'Average business days per step', 'Finished steps only, for the selected lead. The slowest step is in red. Transfer notice and contacts are waiting on people outside the team.', turnS)}</div>
  ${card('an_open', 'Open tasks', 'Oldest first. Red means waiting 5+ business days or past due.', `<div class="an-bar">${A.person ? `<button class="btn sm" data-anperson="">${esc(pName)} ×</button>` : ''}${roleSel}<span class="meta">${list.length}</span></div><div class="tablewrap an-tw an-scroll"><table><tr><th>Waiting on</th><th>Task</th><th>Facility</th><th class="tl-hide-narrow">Lead running it</th><th class="num tl-hide-narrow">Since</th><th class="num">Days waiting</th><th></th></tr>${rows || '<tr><td colspan="7" class="meta">Nothing.</td></tr>'}</table></div>`)}`;
}

function anSchedule(d) {
  const fs = d.facs.filter(f => f.dates && f.dates.dos && !f.hold);
  const monday = s => add(s, -((dow(s) + 6) % 7));
  const weeks = [...new Set(fs.map(f => monday(f.dates.dos)))].sort();
  const max = Math.max(1, ...weeks.map(w => fs.filter(f => monday(f.dates.dos) === w).length)), thisWk = monday(st.today);
  const cols = weeks.map(w => { const g = fs.filter(f => monday(f.dates.dos) === w), c = g.filter(f => f.complete).length, o = g.length - c;
    return `<div class="an-col ${w === thisWk ? 'now' : ''}"${tipAttr([['Week of ' + fmtS(w)], ['Complete', c], ['In progress', o], ...g.slice(0, 8).map(f => ['·', facName(f)])])}><div class="an-cn">${g.length}</div><div class="an-cb"><span style="height:${o / max * 100}%;background:var(--accent)"></span><span style="height:${c / max * 100}%;background:var(--ok)"></span></div><div class="an-cl">${fmtS(w).slice(0, -3)}</div></div>`; }).join('');
  const soon = fs.filter(f => !f.complete && f.dates.ord >= st.today && f.dates.ord <= addBiz(st.today, 15)).sort((a, b) => a.dates.ord.localeCompare(b.dates.ord));
  return `${card('an_sched', 'First dates of service by week', 'Week starting Monday. Complete facilities have a booked first DOS; in-progress ones show it once their dates are worked out (they need an address with a ship point).', legend([['Complete', 'var(--ok)'], ['In progress', 'var(--accent)']]) + (weeks.length ? `<div class="an-cols">${cols}</div>` : '<div class="meta">No dates yet.</div>'))}
  ${card('an_soon', 'Ordering in the next 3 weeks', 'Not complete yet, soonest first.', `<div class="tablewrap an-tw"><table><tr><th>Facility</th><th class="tl-hide-narrow">Corporate</th><th>Lead</th><th>Step</th><th class="num">Ordering</th><th class="num">First DOS</th><th class="num tl-hide-narrow">Delivery</th></tr>${soon.map(f => `<tr class="click" data-fac="${f.id}"><td><b>${esc(facName(f))}</b>${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</td><td class="tl-hide-narrow">${esc(f.group)}</td><td>${esc(leadName(amOf(f)))}</td><td>${esc(curStep(f))}</td><td class="num">${fmtS(f.dates.ord)}</td><td class="num">${fmtS(f.dates.dos)}</td><td class="num tl-hide-narrow">${fmtS(f.dates.del)}</td></tr>`).join('') || '<tr><td colspan="7" class="meta">Nothing ordering in the next 3 weeks.</td></tr>'}</table></div>`)}`;
}

function anCorporates(d) {
  const A = ui.an, q = lc(A.cq || '');
  const ck = f => lc(f.group || '__nocorp'), label = k => k === '__nocorp' ? 'No corporate yet' : (grp(k) ? grp(k).name : k);
  const keys = [...new Set(d.facs.map(ck))].sort((a, b) => d.facs.filter(f => ck(f) === b).length - d.facs.filter(f => ck(f) === a).length || label(a).localeCompare(label(b)));
  if (!A.corp || !keys.includes(A.corp)) { A.corp = keys[0] || null; A.step = null; }
  const picker = keys.filter(k => !q || lc(label(k)).includes(q)).map(k => { const g = d.facs.filter(f => ck(f) === k), n = b => g.filter(f => bucketOf(f) === b).length;
    return `<button class="an-pick" data-ancorp="${esc(k)}" aria-current="${k === A.corp}"><span class="n"><span>${esc(label(k))}</span><span>${n('Complete')}/${g.length}</span></span><span class="an-mini">${BUCKETS.map(([b, c]) => n(b) ? `<i style="flex:${n(b)};background:${c}"></i>` : '').join('')}</span></button>`; }).join('') || '<div class="meta">No match.</div>';
  const pick = `<aside class="card an-card an-picker"><h3>Corporate groups</h3><input type="text" id="an_cq" placeholder="Search" value="${esc(A.cq || '')}" aria-label="Search corporates"><div class="an-picklist">${picker}</div></aside>`;
  const k = A.corp; if (!k) return `<div class="an-corp">${pick}<div class="empty">No facilities yet.</div></div>`;
  const g = d.facs.filter(f => ck(f) === k), n = b => g.filter(f => bucketOf(f) === b).length;
  const who = (title, fn) => { const m = {}; g.forEach(f => { const e = fn(f) || ''; m[e] = (m[e] || 0) + 1; }); const es = Object.entries(m).sort((a, b) => b[1] - a[1]); return `<span>${es.length > 1 ? title + 's' : title}: ${es.map(([e, c]) => `<b>${esc(e ? nameOf(e) : 'none')}</b> (${c})`).join(', ')}</span>`; };
  const dd = g.filter(f => f.complete && f.requested).map(f => bizDays(f.requested, f.complete));
  const next = g.filter(f => !f.complete && !f.hold && f.dates && f.dates.dos >= st.today).map(f => f.dates.dos).sort()[0];
  const sc = STEP_ROWS.map(([no, l]) => [no, l, g.filter(f => stepNo(f) === no).length]), smax = Math.max(1, ...sc.map(x => x[2]));
  const filt = A.step !== null && A.step !== undefined;
  const cols = sc.map(([no, l, c]) => `<button class="an-col an-stagecol ${A.step === no ? 'on' : ''} ${filt && A.step !== no ? 'dim' : ''}" data-anstep="${no}"${tipAttr([[l], ['Facilities', c], ['Click to show only these', '']])}><div class="an-cn">${c}</div><div class="an-cb"><span style="height:${c / smax * 100}%;background:${c ? stepRowColor(no) : 'transparent'}"></span></div><div class="an-cl"><b>${no >= 1 && no <= 8 ? no : no === 0 ? 'Not started' : no === 9 ? 'Complete' : 'On hold'}</b>${no >= 1 && no <= 8 ? '<br>' + esc(MS[no - 1].s) : ''}</div></button>`).join('');
  const order = { 'In progress': 0, 'On hold': 1, 'Not started': 2, Complete: 3 };
  const list = g.filter(f => !filt || stepNo(f) === A.step).sort((a, b) => order[bucketOf(a)] - order[bucketOf(b)] || stepNo(b) - stepNo(a) || facName(a).localeCompare(facName(b)));
  const rows = list.map(f => { const ds = daysOnStep(f); return `<tr><td><button class="linkish an-plain" data-fac="${f.id}">${esc(facName(f))}</button><div class="meta">CT-${pad(f.id)}${chiName(f) ? ' · Chicago: ' + esc(f.name) : ''}</div></td><td>${statusPill(bucketOf(f))}${atRisk(f) ? ' <span class="pill p-risk">At risk</span>' : ''}</td><td style="min-width:190px">${track(f)}<div class="an-trklab">${esc(curStep(f))}</div></td><td class="num ${(ds || 0) >= 5 ? 'an-bad' : ''}">${ds === null ? '–' : ds}</td><td class="tl-hide-narrow">${esc(leadName(amOf(f)))}</td><td class="tl-hide-narrow">${esc(nameOf(acctOf(f)) || '–')}</td><td class="num">${f.dates ? fmtS(f.dates.dos) : '–'}</td></tr>`; }).join('');
  return `<div class="an-corp">${pick}<div class="an-corpmain"><div class="card an-card" id="an_corpdetail"><div class="an-cname">${esc(label(k))}</div><div class="an-people">${who('Lead', amOf)}${who('Account manager', acctOf)}</div>
  <div class="an-kpis an-kpis-sm">${tile('Facilities', g.length)}${tile('Complete', n('Complete'))}${tile('In progress', n('In progress'))}${tile('On hold', n('On hold'))}${tile('Avg days to complete', avg(dd))}${tile('Next first DOS', next ? fmtS(next) : '')}</div>
  <div class="an-sect">Facilities at each step</div><p class="an-note" style="margin-top:0">Click a step to show only those facilities.</p><div class="an-cols an-cols-sm">${cols}</div></div>
  <div class="card an-card" id="an_corpfac"><div class="an-bar" style="justify-content:space-between"><h3 style="margin:0">Facilities in this group <span class="meta">${list.length}</span></h3>${filt ? `<button class="btn sm" data-anstep="">${esc(STEP_ROWS.find(x => x[0] === A.step)[1])} ×</button>` : ''}</div>${legend([['Step done', 'var(--ok)'], ['Current step', 'var(--accent)'], ['On hold at this step', 'var(--warn)'], ['Not yet', 'var(--line2)']])}<div class="tablewrap an-tw an-scroll"><table><tr><th>Facility</th><th>Status</th><th>Progress</th><th class="num">Days on step</th><th class="tl-hide-narrow">Lead</th><th class="tl-hide-narrow">Account manager</th><th class="num">First DOS</th></tr>${rows || '<tr><td colspan="7" class="meta">None.</td></tr>'}</table></div></div></div></div>`;
}

const FAC_COLS = [['facility', 'Facility', f => facName(f)], ['corp', 'Corporate', f => f.group || ''], ['lead', 'Lead', f => leadName(amOf(f))], ['status', 'Status', f => bucketOf(f)], ['step', 'Step', f => stepNo(f)], ['days', 'Days on step', f => daysOnStep(f) ?? -1], ['dos', 'First DOS', f => (f.dates && f.dates.dos) || '']];
function anFacilities(d) {
  const A = ui.an, q = lc(A.fq || ''), S = A.fsort || { k: 'days', dir: -1 }, col = FAC_COLS.find(c => c[0] === S.k) || FAC_COLS[5];
  const list = d.facs.filter(f => (!A.fstatus || bucketOf(f) === A.fstatus) && (!q || lc(facName(f) + ' ' + f.name + ' ' + (f.group || '') + ' CT-' + pad(f.id)).includes(q)))
    .sort((a, b) => { const x = col[2](a), y = col[2](b); return ((x < y ? -1 : x > y ? 1 : 0) * S.dir) || facName(a).localeCompare(facName(b)); });
  const th = ([k, l]) => `<th class="${['days', 'dos'].includes(k) ? 'num' : ''} ${['corp', 'dos'].includes(k) ? 'tl-hide-narrow' : ''}" aria-sort="${S.k === k ? (S.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="thsort" data-anfsort="${k}">${l}${S.k === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  const rows = list.map(f => { const ds = daysOnStep(f); return `<tr class="click" data-fac="${f.id}"><td><b>${esc(facName(f))}</b><div class="meta">CT-${pad(f.id)}${chiName(f) ? ' · Chicago: ' + esc(f.name) : ''}</div></td><td class="tl-hide-narrow">${esc(f.group)}</td><td>${esc(leadName(amOf(f)))}</td><td>${statusPill(bucketOf(f))}</td><td>${esc(curStep(f))}</td><td class="num ${(ds || 0) >= 5 ? 'an-bad' : ''}">${ds === null ? '–' : ds}</td><td class="num tl-hide-narrow">${f.dates ? fmtS(f.dates.dos) : '–'}</td></tr>`; }).join('');
  return card('an_facs', 'All facilities', 'Filtered by the lead above. Click a header to sort, a row to open the facility.', `<div class="an-bar"><input type="text" id="an_fq" placeholder="Search facility, corporate, CT number" value="${esc(A.fq || '')}" aria-label="Search facilities"><select id="an_fstatus" aria-label="Status"><option value="">All statuses</option>${BUCKETS.map(([b]) => `<option ${A.fstatus === b ? 'selected' : ''}>${b}</option>`).join('')}</select><span class="meta">${list.length} of ${d.facs.length}</span></div><div class="tablewrap an-tw an-scroll"><table><tr>${FAC_COLS.map(th).join('')}</tr>${rows || '<tr><td colspan="7" class="meta">No facilities match.</td></tr>'}</table></div>`);
}

function analyticsAfter() { if (ui.an.focus) { const i = document.getElementById(ui.an.focus); if (i) { i.focus(); const p = i.value.length; i.setSelectionRange(p, p); } ui.an.focus = null; } }

// ---------- clicks / changes (called from ui.js) ----------
function analyticsClick(T) {
  if (ui.view !== 'analytics') return false;
  const tb = T.closest('[data-antab]'); if (tb) { ui.an.tab = tb.dataset.antab; anTipHide(); render(); return true; }
  const ld = T.closest('[data-anlead]'); if (ld) { ui.an.lead = ui.an.lead === ld.dataset.anlead ? '' : ld.dataset.anlead; ui.an.person = ''; render(); return true; }
  const pr = T.closest('[data-anperson]'); if (pr) { ui.an.person = ui.an.person === pr.dataset.anperson ? '' : pr.dataset.anperson; render(); return true; }
  const cp = T.closest('[data-ancorp]'); if (cp) { ui.an.corp = cp.dataset.ancorp; ui.an.step = null; render(); return true; }
  const sp = T.closest('[data-anstep]'); if (sp) { const v = sp.dataset.anstep === '' ? null : +sp.dataset.anstep; ui.an.step = v === null || ui.an.step === v ? null : v; render(); return true; }
  const fs = T.closest('[data-anfsort]'); if (fs) { const k = fs.dataset.anfsort, S = ui.an.fsort || { k: 'days', dir: -1 }; ui.an.fsort = S.k === k ? { k, dir: -S.dir } : { k, dir: ['days', 'dos', 'step'].includes(k) ? -1 : 1 }; render(); return true; }
  return false;
}
function analyticsChange(el) {
  if (el.id === 'an_lead') { ui.an.lead = el.value; ui.an.person = ''; render(); }
  if (el.id === 'an_role') { ui.an.role = el.value; render(); }
  if (el.id === 'an_fstatus') { ui.an.fstatus = el.value; render(); }
}
document.addEventListener('input', e => {
  if (e.target.id === 'an_cq') { ui.an.cq = e.target.value; ui.an.focus = 'an_cq'; render(); }
  if (e.target.id === 'an_fq') { ui.an.fq = e.target.value; ui.an.focus = 'an_fq'; render(); }
});
// hover popover for bars, columns and progress steps
function anTipHide() { const t = document.getElementById('an_tip'); if (t) t.style.display = 'none'; }
document.addEventListener('mousemove', e => {
  const tip = document.getElementById('an_tip'); if (!tip) return;
  const el = e.target.closest && e.target.closest('[data-tip]'); if (!el) { tip.style.display = 'none'; return; }
  let lines; try { lines = JSON.parse(el.dataset.tip); } catch (_) { return; }
  tip.replaceChildren(...lines.map(([k, v], i) => { const d = document.createElement('div'); if (i === 0) { d.className = 'k'; d.textContent = k; } else if (k === '·') d.textContent = v; else { d.append(k + (v === '' ? '' : ': ')); if (v !== '') { const b = document.createElement('b'); b.textContent = v; d.append(b); } } return d; }));
  tip.style.display = 'block';
  const box = tip.parentElement.getBoundingClientRect(), w = tip.offsetWidth;
  let x = e.clientX - box.left + 14; if (x + w > box.width) x = e.clientX - box.left - w - 14;
  x = Math.min(x, box.width - w);
  tip.style.left = Math.max(0, x) + 'px'; tip.style.top = (e.clientY - box.top + 14) + 'px';
});
window.addEventListener('resize', anTipHide);
