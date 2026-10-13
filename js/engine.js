'use strict';
/* =====================================================================
   Chicago Transitions: business rules.
   Everything that decides WHAT happens lives here: dates, which tasks get
   created and when, every email and its wording. No screen code.
   - st          the whole app state (store.js loads it and saves changes)
   - run()       looks at every facility and creates whatever is due next.
                 Called after every action and on every page load.
   Emails are rows in the CT Outbox list. The "CT - Send emails" flow sends
   rows whose Status is "Queued" once their SendOn time has passed.
   ===================================================================== */

var st = null;
const CFG = Object.assign({ mailbox: 'transitions@gentell.com', appUrl: location.origin + location.pathname }, window.CT_CONFIG || {});

// ---------- fixed lists ----------
const AREAS = ['Enteral', 'Ostomy', 'Urological', 'Respiratory', 'Wound Care', 'Supplements'];
const COV = ['Covered and Noncovered', 'Covered Only', "Don't Supply"];
const COV_SUPP = [...COV, 'Purchase Order', 'Facility Bulk Order'];
const covOpts = a => a === 'Supplements' ? COV_SUPP : COV;
const ROLES = {
  rules: 'Picks the reps',
  price: 'Price tables',
  portal: 'Adds facilities to Brightree',
  emr: 'EMR access',
  pumps: 'Pumps',
  gdd: 'GDD orders',
  gddInfo: 'Gets the GDD FYI email',
  escalate: 'Gets 3rd reminders and anything with no owner'
};

function defaultSettings() {
  return {
    key: 'settings', nextCt: 1,
    people: [
      { name: 'Raizy Kreiser', email: 'raizy@gentell.com', am: true, admin: true },
      { name: 'Rucky Berger', email: 'rucky@gentell.com', am: true },
      { name: 'Kaila Mandelbaum', email: 'kaila@gentell.com', am: true },
      { name: 'Malka Heiman', email: 'malka@gentell.com' },
      { name: 'Yehuda Jacobs', email: 'yehuda@gentell.com' },
      { name: 'Amy Crawford', email: 'amy@gentell.com' },
      { name: 'Priscilla Cordero', email: 'priscilla.cordero@gentell.com' },
      { name: 'Eduardo Cruz', email: 'eduardo.cruz@gentell.com' },
      { name: 'Chris Anest', email: 'canest@gentell.com' },
      { name: 'Apol Escopin', email: 'apol@gentell.com' },
      { name: 'Hannah Goldstein', email: 'hannah@gentell.com', rep: true, ext: '346' },
      { name: 'Sori Stein', email: 'sori@gentell.com', rep: true, ext: '' },
      { name: 'Rafael Banal', email: 'rafael.banal@gentell.com', rep: true, ext: '' },
      { name: 'Aliyah Price', email: 'aliyah.price@gentell.com', rep: true, ext: '' },
      { name: 'Linda Anwaya', email: 'linda.anwaya@gentell.com', rep: true, ext: '' }
    ],
    roles: { rules: 'Malka Heiman', price: 'Yehuda Jacobs', portal: 'Amy Crawford', emr: 'Priscilla Cordero', pumps: 'Eduardo Cruz', gdd: 'Chris Anest', gddInfo: 'Apol Escopin', escalate: 'Raizy Kreiser' },
    chicagoGreeting: 'Christian',
    // from the Email 1s sent on 10/7/2026
    e1To: ['darlene.kusek@gentell.com', 'christian.brandt@gentell.com', 'danielle.butler@gentell.com', 'bbarrows@gentell.com'],
    e1Cc: ['kyle.king@gentell.com', 'dproulx@gentell.com', 'bschorn@gentell.com', 'jvidal@gentell.com', 'linda.anwaya@gentell.com', 'aliyah.price@gentell.com'],
    inserviceUrl: '',
    biller: 'Sreejith Sreekumar',
    helperDays: 2, amDays: 1,
    warehouses: ['GDD Boca Raton', 'GDD Bristol', 'GDD Chicago', 'GDD Chicopee', 'GDD Cleveland', 'GDD Dallas', 'GDD Evansville', 'GDD Minneapolis', 'GDD Ocala'],
    depts: 'Accounts Payable|F,Accounts Receivable|F,Administrator|F,Admissions|F,ADON|F,AP|C,Assistant Administrator|F,Business Office/Payers Contact|F,Census/Payers|C,Central Supply|F,Clinical Operations|F,Corporate Clinical|C,Corporate contact|C,Corporate Operations|C,Corporate Owner|C,Corporate Purchasing|C,Dietitian|F,Director of Purchasing|C,DON|F,EMR Access|C,Food Service|F,Medical Provider|F,Medical Records|F,Other|F,Other Nursing|F,Payers Contact|F,Regional|F,Regional Clinical|C,Regional Dietician|C,Rehab Director|F,Respiratory|F,Speech Therapist|F,Wound Care|F'
      .split(',').map(x => { const [n, t] = x.split('|'); return { name: n, type: t === 'F' ? 'Facility' : 'Corporate' }; }),
    shipEnt: { 1: 'CT DE IL OH MA MD ME MI MO NH NJ NY PA RI VT AL FL GA NC SC TN VA TX', 2: 'AR CO IA ID IN KY LA MS ND NE NM OK SD UT WI CA NV OR WA', 3: 'WY' },
    shipOst: { 1: 'CT DE MA MD ME NH NJ NY PA RI VT', 2: 'OH WV', 3: 'DC FL GA KY NC SC TN VA AL TX', 4: 'IL IN IA KS MI MN MO NE ND SD WI', 5: 'AR LA NM OK CO ID MT UT WY', 6: 'CA NV OR WA', 7: 'AK HI' }
  };
}

// ---------- small helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const validEmail = e => /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(e || '');
const lc = s => String(s || '').trim().toLowerCase();
const pad = n => String(n).padStart(4, '0');
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- dates (all YYYY-MM-DD strings, Eastern time) ----------
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const S = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const dow = s => D(s).getUTCDay();
const isWE = s => dow(s) === 0 || dow(s) === 6;
const addBiz = (s, n) => { let d = s, step = n < 0 ? -1 : 1, k = Math.abs(n); while (k > 0) { d = add(d, step); if (!isWE(d)) k--; } return d; };
const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = s => { if (!s) return ''; const d = D(s); return WD[d.getUTCDay()].slice(0, 3) + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear(); };
const fmtS = s => { if (!s) return ''; const d = D(s); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + String(d.getUTCFullYear()).slice(2); };
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nextBizDay = s => isWE(s) ? addBiz(s, 1) : s;

// ---------- people ----------
const people = () => st.settings.people;
function person(x) { const s = lc(x); if (!s) return null; return people().find(p => lc(p.email) === s) || people().find(p => lc(p.name) === s) || null; }
function roleEmail(role) { const p = person(st.settings.roles[role]); return p && validEmail(p.email) ? lc(p.email) : ''; }
function roleName(role) { const p = person(st.settings.roles[role]); return p ? p.name : '(not set)'; }
function nameOf(email) { if (!email) return ''; const p = person(email); if (p) return p.name; return (st.names && st.names[lc(email)]) || email; }
const amList = () => people().filter(p => p.am && validEmail(p.email));
const repList = () => people().filter(p => p.rep && validEmail(p.email));
const isAm = e => !!(person(e) || {}).am;
const isAdmin = e => !!(person(e) || {}).admin;
const fallbackOwner = () => roleEmail('escalate') || (people().find(p => p.admin && validEmail(p.email)) || {}).email || '';
function deptMap() { const m = {}; st.settings.depts.forEach(d => m[d.name] = d.type); return m; }
function shipOf(tbl, state) { for (const k in tbl) if (tbl[k].split(/\s+/).includes(state)) return +k; return null; }

function settingsProblems() {
  const s = st.settings, out = [];
  for (const r in ROLES) {
    const p = person(s.roles[r]);
    if (!p) out.push('Who does "' + ROLES[r] + '"? Pick a person.');
    else if (!validEmail(p.email)) out.push(p.name + ' needs an email (' + ROLES[r] + ').');
  }
  people().filter(p => (p.am || p.rep || p.admin) && !validEmail(p.email)).forEach(p => out.push(p.name + ' needs an email.'));
  if (!amList().length) out.push('Add at least 1 account manager.');
  if (!repList().length) out.push('Add at least 1 intake rep.');
  if (!s.e1To.length) out.push('Email 1 "To" list (Chicago) is empty.');
  if (!/^https?:\/\//.test(s.inserviceUrl || '')) out.push('In-service link is missing.');
  return [...new Set(out)];
}

// ---------- records ----------
const G = f => st.groups[lc(f.group)] || { name: '', cov: {}, contacts: [] };
const grp = name => st.groups[lc(name)];
function ensureGroup(name, standalone) {
  const k = lc(name);
  if (!st.groups[k]) st.groups[k] = { key: 'grp:' + k, name: name.trim(), cov: {}, contacts: [], standalone: !!standalone };
  return st.groups[k];
}
const facName = f => f.portalName || f.name;
const facById = i => st.facs.find(f => f.id === i);
const taskByKey = k => st.tasks.find(t => t.key === k);
const tasksOf = (f, type) => st.tasks.filter(t => t.fac === f.id && (!type || t.type === type));
const gTask = (gname, type) => st.tasks.find(t => !t.fac && lc(t.group) === lc(gname) && t.type === type);
const fTask = (f, type) => st.tasks.find(t => t.fac === f.id && t.type === type);
const done = t => !!t && (t.status === 'Done' || t.status === 'Not needed');
const isWaiting = t => !done(t) && !!t.opensOn && t.opensOn > st.today;
function amOf(f) { return f.am || G(f).am || fallbackOwner(); }
function FG(f) { const g = G(f); return Object.assign({}, g, { cov: Object.assign({}, g.cov || {}, f.cov || {}) }); }
function covKnown(g) { return !!g.cov && AREAS.every(a => g.cov[a]); }
function partB(g) { return AREAS.every(a => ['Covered Only', "Don't Supply", 'Purchase Order', 'Facility Bulk Order'].includes(g.cov[a])); }
function areasPhrase(g) {
  const ent = g.cov.Enteral !== "Don't Supply";
  const out = ['Ostomy', 'Urological', 'Respiratory'].some(a => g.cov[a] !== "Don't Supply");
  return ent && out ? ['both enteral and OUTs', 'enteral or OUT'] : ent ? ['enteral', 'enteral'] : ['OUTs', 'OUT'];
}
function mainCorp(g) { return (g.contacts || []).find(c => validEmail(c.email)) || null; }
function facsOfGroup(name) { return st.facs.filter(f => lc(f.group) === lc(name) && !f.archived); }

// ---------- dates for a facility ----------
function calcDates(f) {
  const b = f.bt, g = FG(f); if (!b || !covKnown(g) || !f.state) return null;
  let dos; const why = [];
  const e = b.lastEnt ? add(b.lastEnt, 30) : null, o = b.lastOuts ? add(b.lastOuts, 28) : null;
  if (e && o) { dos = e > o ? e : o; why.push('Enteral ' + fmtS(b.lastEnt) + ' + 30 = ' + fmtS(e) + '; OUTs ' + fmtS(b.lastOuts) + ' + 28 = ' + fmtS(o) + '. Later = ' + fmtS(dos)); }
  else if (e) { dos = e; why.push('Enteral only: ' + fmtS(b.lastEnt) + ' + 30 = ' + fmtS(e)); }
  else if (o) { dos = o; why.push('OUTs only: ' + fmtS(b.lastOuts) + ' + 28 = ' + fmtS(o)); }
  else return null;
  if (isWE(dos)) { const m = dow(dos) === 6 ? add(dos, 2) : add(dos, 1); why.push(fmtS(dos) + ' is a weekend → Monday ' + fmtS(m)); dos = m; }
  const pb = partB(g), back = pb ? 2 : 1, earliest = addBiz(st.today, 1); let pushed = false;
  while (addBiz(dos, -back) < earliest) { dos = addBiz(dos, 1); pushed = true; }
  if (pushed) why.push('Ordering date would be in the past → DOS pushed to ' + fmtS(dos));
  const sp = shipOf(st.settings.shipEnt, f.state) || 1;
  why.push((pb ? 'Part B only → ordering 2 business days' : 'Not Part B only → ordering 1 business day') + ' before DOS');
  why.push('Ship Point ' + f.state + ' = ' + sp + ' → delivery DOS + ' + sp + ' business day' + (sp > 1 ? 's' : ''));
  return Object.assign(derive(f, dos), { why });
}
function derive(f, dos) {
  const g = FG(f), pb = partB(g), back = pb ? 2 : 1, sp = shipOf(st.settings.shipEnt, f.state) || 1;
  const ord = addBiz(dos, -back), del = addBiz(dos, sp);
  return { dos, ord, del, os: diff(ord, del), day: WD[dow(del)], partB: pb, ship: sp, shipOst: shipOf(st.settings.shipOst, f.state), back };
}
function basisText(f) {
  const b = f.bt || {}; const e = b.lastEnt ? add(b.lastEnt, 30) : null, o = b.lastOuts ? add(b.lastOuts, 28) : null;
  if (e && o) return (e >= o ? '30 days after the last enteral delivery (' + fmtS(b.lastEnt) + ')' : '28 days after the last OUTs delivery (' + fmtS(b.lastOuts) + ')') + ', the later of the two';
  if (e) return '30 days after the last enteral delivery (' + fmtS(b.lastEnt) + '). Chicago bills a 30-day supply';
  if (o) return '28 days after the last OUTs delivery (' + fmtS(b.lastOuts) + ')';
  return '';
}
function dateWarn(f, dos) {
  const r = f.rec, w = []; if (!r) return w;
  if (dos < r.dos) { const n = diff(dos, r.dos); w.push('This DOS is ' + n + ' day' + (n > 1 ? 's' : '') + ' earlier than the recommended ' + fmt(r.dos) + ', which is ' + basisText(f) + '. Chicago\'s last delivery may not be used up yet, so this order could overlap their billing.'); }
  if (isWE(dos)) w.push('This DOS is on a ' + WD[dow(dos)] + '.');
  const d = derive(f, dos); if (d.ord < addBiz(st.today, 1)) w.push('The ordering date (' + fmt(d.ord) + ') has already passed or is today.');
  return w;
}
function saveDates(f, dos, by) {
  if (f.rec && dos === f.rec.dos) { f.dosChosen = ''; f.dosBy = ''; f.dates = f.rec; }
  else { f.dosChosen = dos; f.dosBy = by; f.dates = Object.assign(derive(f, dos), { why: [...(f.rec ? f.rec.why : []), 'Changed by ' + by + ' from the recommended ' + (f.rec ? fmtS(f.rec.dos) : '')], changed: true }); }
  if (f.email1) mail({ key: 'm:E13:dates:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, subject: 'Dates changed after Email 1: ' + facName(f), body: '<p>' + esc(by) + ' changed the dates after Email 1 went out. Fix the Ordering Calendar, then click "Dates changed: send correction" on the facility page.</p>', link: 'fac' });
}

// ---------- stage ----------
function stageOf(f) {
  if (f.hold) return ['On hold', 'p-hold'];
  if (f.complete) return ['Complete', 'p-done'];
  if (f.email2) return ['Sent by Chicago', 'p-sent'];
  if (f.email1) return ['Emailed Chicago to send', 'p-chi'];
  const sch = fTask(f, 'SCHEDULE'); if (sch && !done(sch)) return ['Ready to schedule', 'p-ready'];
  return ['In setup', 'p-setup'];
}
function atRisk(f) { const d = f.dates; return !!(d && !f.email1 && !f.hold && !f.complete && addBiz(st.today, 3) >= d.ord); }

// ---------- email ----------
const btnStyle = 'display:inline-block;background:#003171;color:#ffffff;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0';
const appLink = q => CFG.appUrl + (q ? '?' + q : '');
const taskUrl = (key, answer) => appLink('task=' + encodeURIComponent(key) + (answer ? '&answer=' + encodeURIComponent(answer) : ''));
// smaller grey line for side information (what happens next, why), under the main instruction
const note = s => '<p style="color:#6B6F75;font-size:9.5pt;margin:-4px 0 10px">' + s + '</p>';
// one line per task in emails that cover several: facility name + its own buttons
const taskList = (items, answers) => '<ul>' + items.map(([label, key]) => '<li style="margin:4px 0">' + label + ' &nbsp; ' + (answers || []).map(a => `<a href="${esc(taskUrl(key, a))}">${esc(a)}</a> &middot; `).join('') + `<a href="${esc(taskUrl(key))}">Open the task</a></li>`).join('') + '</ul>';
function emailHtml(body, m) {
  let links = '';
  if (m.task && m.buttons) links = '<p>' + m.buttons.map(b => `<a href="${esc(appLink('task=' + encodeURIComponent(m.task) + '&answer=' + encodeURIComponent(b)))}" style="${btnStyle}">${esc(b)}</a>`).join('') + `<a href="${esc(appLink('task=' + encodeURIComponent(m.task)))}" style="${btnStyle};background:#6B6F75">Open the task</a></p>`;
  else if (m.task && m.link !== 'none') links = `<p><a href="${esc(appLink('task=' + encodeURIComponent(m.task)))}" style="${btnStyle}">Open the task</a></p>`;
  else if (m.link === 'mytasks') links = `<p><a href="${esc(appLink('view=mytasks'))}" style="${btnStyle}">Open my tasks</a></p>`;
  else if (m.link === 'fac' && m.fac) links = `<p><a href="${esc(appLink('fac=' + m.fac))}" style="${btnStyle}">Open the facility</a></p>`;
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${body}${links}</div>`;
}
/* mail({key, code, to:[emails], cc, subject, body, task, fac, day, cond, buttons, link, noTag})
   key  must be unique and the same every time the same email would be made, so it is never sent twice.
   day  YYYY-MM-DD to send later (8 am Eastern). Leave out to send now.
   cond when to cancel a later email (see mailStillValid). */
// follow-ups go out as high importance; everything else normal (the "CT - Send emails" flow reads the Importance column)
const HIGH_CODES = new Set(['E15', 'E16F', 'E16A', 'E17']);
function mail(m) {
  if (st.mails.some(x => x.key === m.key)) return null;
  const clean = a => [...new Set((a || []).filter(Boolean).map(lc))];
  const toRaw = clean(m.to), ccRaw = clean(m.cc);
  const bad = [...toRaw, ...ccRaw].filter(e => !validEmail(e));
  const to = toRaw.filter(validEmail), cc = ccRaw.filter(e => validEmail(e) && !to.includes(e));
  let subject = m.subject;
  if (m.fac && !m.noTag) subject = '[CT-' + pad(m.fac) + '] ' + subject;
  const day = m.day && m.day > st.today ? m.day : st.today;
  const rec = {
    key: m.key, code: m.code, to, cc, subject, body: emailHtml(m.body, m), fac: m.fac || null, task: m.task || null, day,
    sendOn: day > st.today ? day + 'T12:00:00Z' : new Date(Date.now() - 60000).toISOString(),
    status: 'Queued', cond: m.cond || null, by: st.me ? st.me.email : '', importance: m.importance || (HIGH_CODES.has(m.code) ? 'High' : 'Normal')
  };
  if (!to.length) { rec.status = 'Failed'; rec.error = 'Nobody to send it to' + (bad.length ? ' (bad address: ' + bad.join(', ') + ')' : '') + '. Fix the address on this email in the Outbox and click "Send it again".'; }
  else if (bad.length) rec.error = 'Skipped (no valid email): ' + bad.join(', ');
  st.mails.unshift(rec); return rec;
}
let pending = [];
function queue(code, to, f, task, make) { pending.push({ code, to, f, task, make }); }
function flush() {
  // 1 email per helper per request when several facilities need the same ask
  const groups = {};
  pending.forEach(p => { const k = p.code + '|' + p.to + '|' + (p.f.req || ''); (groups[k] = groups[k] || []).push(p); });
  Object.values(groups).forEach(arr => {
    const m = arr[0].make(arr.map(a => a.f), arr.map(a => a.task));
    m.key = 'm:' + arr[0].code + ':' + hash(arr.map(a => a.task.key).sort().join(','));
    mail(m);
  });
  pending = [];
}
function mailStillValid(m) {
  const c = m.cond; if (!c) return true;
  if (c.task) {
    const t = taskByKey(c.task); if (!t || done(t)) return false;
    if (c.assignee && t.assignee !== c.assignee) return false;
    if (c.due && t.due !== c.due) return false;
    if (c.opensOn && t.opensOn !== c.opensOn) return false;
    const f = t.fac && facById(t.fac); if (f && (f.hold || f.deleted)) return false;
  }
  if (c.fac) {
    const f = facById(c.fac); if (!f || f.hold || f.complete || f.deleted) return false;
    if (c.untilEmail1 && f.email1) return false;
    if (c.untilEmail2 && f.email2) return false;
    if (c.untilE3Done && f.e3Done) return false;
    if (c.ord && (!f.dates || f.dates.ord !== c.ord)) return false;
  }
  return true;
}

// ---------- tasks ----------
const REPEATABLE = new Set(['RULE', 'CONTACTS_PORTAL', 'GDD_PORTAL']);
function newTask(type, o) {
  const base = 't:' + type + ':' + (o.fac ? 'f' + o.fac : 'g' + lc(o.group));
  let key = base;
  if (REPEATABLE.has(type)) { const n = st.tasks.filter(t => t.key === base || t.key.startsWith(base + '#')).length; if (n) key = base + '#' + (n + 1); }
  const existing = taskByKey(key); if (existing) return existing;
  const t = Object.assign({ key, type, status: 'Open', created: st.today, doneBy: '', doneOn: '', assignee: '' }, o);
  if (!t.assignee) t.assignee = fallbackOwner();
  if (!t.due) t.due = addBiz(t.opensOn && t.opensOn > st.today ? t.opensOn : st.today, isAm(t.assignee) ? st.settings.amDays : st.settings.helperDays);
  st.tasks.push(t); return t;
}
function taskTitle(t) { return (TT[t.type] && TT[t.type].title(t)) || t.type; }
function finishTask(t, by, byName) {
  t.status = 'Done'; t.doneBy = by; t.doneByName = byName; t.doneOn = st.today;
  if (by !== t.assignee && t.assignee) mail({ key: 'm:E19:' + t.key, code: 'E19', to: [t.assignee], fac: t.fac, subject: 'Done by ' + byName + ': ' + taskTitle(t), body: `<p>${esc(byName)} finished this. Nothing for you to do.</p>`, link: 'none' });
}
function reassign(t, to, byName) {
  if (!to || to === t.assignee) return;
  t.assignee = to; t.amTask = false;
  t.due = addBiz(isWaiting(t) ? t.opensOn : st.today, isAm(to) ? st.settings.amDays : st.settings.helperDays);
  mail({ key: 'm:E20:' + t.key + ':' + uid(), code: 'E20', to: [to], fac: t.fac, subject: 'Reassigned to you: ' + taskTitle(t), body: `<p>${esc(byName)} reassigned this to you. Due ${fmt(t.due)}.</p>`, task: t.key, cond: { task: t.key } });
}
// reminders and "this task is open now" emails, scheduled ahead of time; the flow sends them on the day
function ensureTaskMails() {
  st.tasks.forEach(t => {
    if (done(t) || t.archived) return;
    const f = t.fac ? facById(t.fac) : null; if (f && f.hold) return;
    if (!t.assignee) return;
    if (t.opensOn && t.opensOn > t.created) {
      const ok = t.opensOn + '|' + t.assignee;
      if (t.openMail !== ok) {
        t.openMail = ok; const om = TT[t.type].opens(t);
        mail({ key: 'm:open:' + t.key + ':' + hash(ok), code: 'E13', to: [t.assignee], cc: om.cc, fac: t.fac, subject: om.subject, body: om.body, task: t.key, day: t.opensOn, cond: { task: t.key, assignee: t.assignee, opensOn: t.opensOn } });
      }
    }
    // reminders: 1 business day after the due date, then 2 (CC the AM), then 4 (CC the escalation person).
    // Only the next one is ever queued; the one after is queued once its turn comes.
    const rk = t.assignee + '|' + t.due, days = [1, 2, 4];
    if (t.remFor !== rk) { t.remFor = rk; t.remNext = 0; }
    while (t.remNext < days.length && (t.remNext === 0 || st.today >= addBiz(t.due, days[t.remNext - 1]))) {
      const i = t.remNext, am = f ? amOf(f) : (grp(t.group) && grp(t.group).am) || fallbackOwner();
      mail({
        key: 'm:E17:' + t.key + ':' + hash(rk) + ':' + (i + 1), code: 'E17', to: [t.assignee],
        cc: [i >= 1 && am !== t.assignee ? am : '', i >= 2 ? roleEmail('escalate') : ''],
        fac: t.fac, subject: 'Reminder' + (i ? ' #' + (i + 1) : '') + ': ' + taskTitle(t), body: `<p>This was due ${fmt(t.due)}.</p>`,
        task: t.key, day: addBiz(t.due, days[i]), cond: { task: t.key, assignee: t.assignee, due: t.due }
      });
      t.remNext++;
    }
  });
}

// ---------- email templates ----------
function repLine(f) { const r = person(f.rep) || {}; return { name: r.name || nameOf(f.rep), email: r.email || f.rep, ext: r.ext || '' }; }
function email1Body(f) {
  const g = FG(f), [areas, orders] = areasPhrase(g), r = repLine(f), d = f.dates, cad = f.bt.cadence, s = st.settings;
  const cadLine = cad === '4' ? 'Orders will continue every 4 weeks thereafter, on the same day of the week, for consistency and ease of planning.' : `Enteral orders will continue ${cad === '1' ? 'every week' : 'every other week'} thereafter, on the same day of the week. Ostomy, tracheostomy and urological orders will continue every 4 weeks.`;
  return `<p>Hi ${esc(s.chicagoGreeting)},</p>
<p>We will be transitioning <b>${esc(facName(f))}</b> from the <b>${esc(f.group)}</b> group over to Lakewood for <b>${areas}</b>. Please send the below to the facility contacts (admin, DON, central supply, etc.) to inform them of this transition. Please include <b>${esc(r.name)}</b> and myself on the email to the facility, and CC <b>${esc(CFG.mailbox)}</b> so our system knows it went out.</p>
<p>Please don't send any additional <b>${orders}</b> orders, as Lakewood is now taking responsibility for the orders for this facility. Any order requests that come in for this facility should be forwarded to <b>${esc(r.name)}</b>.</p>
<p>The subject of the email to the facility should be: <b>${esc(facName(f))} - Transfer from GNS Chicago to Lakewood</b>.</p>
<p>Thank you!<br>${esc(nameOf(amOf(f)))}</p>
<hr>
<p>Hello,</p>
<p>I hope you're doing well!</p>
<p>We are pleased to inform you that your account is being transitioned to a new Gentell representative and an updated ordering process. As part of this transition, you can continue to expect great service, smooth ordering and maximum insurance coverage possible via Gentell's extensive network.</p>
<p>Moving forward, your new dedicated representative for enteral, ostomy, tracheostomy and urological products will be:</p>
<p>Name: <b>${esc(r.name)}</b><br>Location: Lakewood, NJ Processing Center<br>Email: <b>${esc(r.email)}</b>${r.ext ? '<br>Telephone: 732-363-3001 Ext <b>' + esc(r.ext) + '</b>' : ''}</p>
<p>Your first monthly order with <b>${esc(r.name)}</b> is scheduled to be placed on <b>${fmtS(d.dos)}</b> for <b>${fmtS(d.del)}</b> delivery. <b>${cadLine}</b></p>
<p>Your representative will connect with you prior to processing the first order to review all details. In addition, we offer a brief in-service call to walk through our modernized process and answer any questions. Please schedule a time that is convenient for you by using the link below:</p>
<p><a href="${esc(s.inserviceUrl)}">Click Here to Schedule an In-Service Call with GNS Lakewood</a></p>
<p>We're looking forward to continuing our relationship and making your process as smooth as possible! Going forward, please feel free to direct any requests or questions to your new representative.</p>
<p>Thank you, and we appreciate your partnership.</p>`;
}
function sendEmail1(f, correction) {
  const am = amOf(f), s = st.settings, subj = facName(f) + '- Transfer from GNS Chicago to Lakewood';
  mail({ key: 'm:' + (correction ? 'E22' : 'E14') + ':' + f.id + (correction ? ':' + uid() : ''), code: correction ? 'E22' : 'E14', to: [...s.e1To, f.rep], cc: [...s.e1Cc, am], fac: f.id, noTag: true, link: 'none', subject: (correction ? 'CORRECTION: ' : '') + subj, body: (correction ? '<p><b>Corrected dates below.</b></p>' : '') + email1Body(f) });
  if (correction) return;
  f.email1 = st.today;
  mail({ key: 'm:E15:' + f.id, code: 'E15', to: s.e1To, cc: [am], fac: f.id, noTag: true, link: 'none', day: addBiz(st.today, 3), cond: { fac: f.id, untilEmail2: true }, subject: 'RE: ' + subj, body: `<p>Hi ${esc(s.chicagoGreeting)},</p><p>Checking in, has the facility email for <b>${esc(facName(f))}</b> gone out? Please CC ${esc(CFG.mailbox)} on it.</p><p>Thank you!<br>${esc(nameOf(am))}</p>` });
  newTask('CHICAGO_FOLLOW', { fac: f.id, assignee: am, amTask: true, opensOn: addBiz(st.today, 5) });
}
// Email 3 goes to the wound rep and regional. They reply with one word, "Done", when it's all taken care of.
// No "Done" yet: follow-ups go out 3 and 6 business days later, then the AM gets told (see chaseEmail3).
const E3_SUBJECT = f => facName(f) + '- Transfer from GNS Chicago to Lakewood';
const e3Names = f => [...new Set([f.wound && f.wound.name, f.regional && f.regional.name].filter(Boolean).map(n => String(n).split(' ')[0]))];
const e3Hi = f => '<p>Hi ' + esc(e3Names(f).join(' and ')) + ',</p>';
const E3_DONE_ASK = '<p><b>Once everything is taken care of (the in-service is booked and you\'ve sent us the contacts or confirmed the ones above), please reply to this email with one word: "Done".</b> That\'s how we know it\'s all set.</p>';
function email3Body(f) {
  const g = FG(f), d = f.dates, am = amOf(f), areas = covKnown(g) ? areasPhrase(g)[0] : '';
  return `${e3Hi(f)}
<p>I hope all is well!</p>
<p>I would like to update you that <b>${esc(facName(f))}</b> from the <b>${esc(f.group)}</b> group is transitioning to the Lakewood branch${areas ? ' for <b>' + areas + '</b>' : ''}${d ? ', and is scheduled to have their first order with Lakewood placed on <b>' + fmtS(d.dos) + '</b> for <b>' + fmtS(d.del) + '</b> delivery' : ''}. It would be very helpful for us and the facility if the facility can schedule an in-service prior to their first scheduled order, so they can be aware of the updated ordering process and how to obtain supplies in between monthly orders if needed. Would you be able to be in touch with the facility to ensure they book an in-service? We typically want the admin, DON and central supply on the in-service call, so they can all be on the same page. Anyone else in the facility that is usually involved in the ordering and documentation is welcome to join as well.${st.settings.inserviceUrl ? ' Here is the link for them to book it: <a href="' + esc(st.settings.inserviceUrl) + '">Schedule an In-Service Call with GNS Lakewood</a>.' : ''}</p>
<p>In addition, can you assist us with obtaining the following contact information?</p>
<ul><li>Name and email of a medical provider that can sign forms via our e-sign platform, PandaDoc, so we can bill patients supplies to insurance (this can be a medical director, NP or PA).</li><li>Name and email of the speech therapist or director of rehab</li><li>Name and email of the dietician</li></ul>
<p>The following are the contacts we have on file. Can you please review and advise if there are any discrepancies with the names or email addresses of these contacts?</p>
<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>First Name</th><th>Last Name</th><th>Department</th><th>Email</th></tr>${f.contacts.map(c => `<tr><td>${esc(c.first)}</td><td>${esc(c.last)}</td><td>${esc(c.dept === 'Other' && c.note ? c.note : c.dept)}</td><td>${esc(c.email)}</td></tr>`).join('') || '<tr><td colspan="4">None yet</td></tr>'}</table>
${E3_DONE_ASK}
<p>Thank you for your help!<br>${esc(nameOf(am))}</p>`;
}
function sendEmail3(f) {
  f.email3 = st.today;
  mail({ key: 'm:E16:' + f.id, code: 'E16', to: [f.wound && f.wound.email, f.regional && f.regional.email], cc: [f.rep, roleEmail('rules'), amOf(f)], fac: f.id, noTag: true, link: 'none', subject: E3_SUBJECT(f), body: email3Body(f) });
}
// One step at a time: only the next follow-up is ever queued, and it's cancelled the moment "Done" comes in.
function chaseEmail3(f) {
  if (!f.email3 || f.e3Done) return;
  const mine = st.mails.filter(m => m.fac === f.id && m.key.startsWith('m:E3F:'));
  if (mine.some(m => m.status === 'Queued')) return;
  const used = mine.filter(m => m.status !== 'Cancelled');
  const step = used.length + 1; if (step > 3) return;
  const last = used.map(m => m.day).sort().pop() || f.email3;
  const day = addBiz(last, 3), key = 'm:E3F:' + f.id + ':' + step + ':' + mine.length, am = amOf(f), cond = { fac: f.id, untilE3Done: true };
  if (step < 3) mail({ key, code: 'E16F', day, cond, to: [f.wound && f.wound.email, f.regional && f.regional.email], cc: [am], fac: f.id, noTag: true, link: 'none', subject: 'RE: ' + E3_SUBJECT(f),
    body: `${e3Hi(f)}<p>${step === 1 ? 'Just following up on my email below' : 'Following up again on my email below'} about <b>${esc(facName(f))}</b>. Once the in-service is booked and you've sent us the contacts (or confirmed the ones we have), please reply to this email with one word: <b>"Done"</b>.</p><p>Thank you!<br>${esc(nameOf(am))}</p><hr>${email3Body(f)}` });
  else mail({ key, code: 'E16A', day, cond, to: [am], fac: f.id, link: 'fac', subject: 'No "Done" yet on Email 3: ' + facName(f),
    body: `<p>${esc(e3Names(f).join(' and ') || 'The wound rep and regional')} didn't reply "Done" to Email 3, even after 2 follow-ups. Please reach out to them.</p>` + note('When it\'s taken care of, click "Email 3 is taken care of" on the facility page. The facility can\'t be marked complete until then.') });
}
function markE3Done(f, by, day) { if (f.e3Done) return; f.e3Done = day || st.today; f.e3DoneBy = by; }
// a reply whose own text (above the quoted email) is just "Done"
function isDoneReply(preview) {
  let p = String(preview || ''); const cut = p.search(/(?:^|\s)(?:From:|-{2,}\s*Original Message|_{5,}|On [^\n]{0,150}? wrote:|Sent from my)/i);
  if (cut >= 0) p = p.slice(0, cut);
  p = p.replace(/\s+/g, ' ').trim();
  return p.length > 0 && p.length <= 60 && /\bdone\b/i.test(p) && !/\bnot\b|n't\b|\?/i.test(p);
}
function addAmy(f) {
  const g = G(f), t = newTask('PORTAL_ADD', { fac: f.id, assignee: roleEmail('portal') });
  mail({ key: 'm:E8:' + t.key, code: 'E8', to: [t.assignee], cc: [amOf(f)], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'Add ' + f.name + ' to Brightree',
    body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>Please add this facility to Brightree (if it's already there, just mark the task done).</p><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><td>Name</td><td>${esc(f.name)}</td></tr><tr><td>Address</td><td>${esc(f.address)}</td></tr><tr><td>Corporate</td><td>${g.standalone ? '<b>None. Set it up as its own corporate named "' + esc(f.group) + '"</b>' : esc(f.group)}</td></tr><tr><td>Price table</td><td>${esc(g.price)}</td></tr></table>` });
}
const first = n => String(n || '').split(' ')[0];
function makeStandalone(f) {
  const old = G(f), n = f.name, g = ensureGroup(n, true);
  if (!covKnown(g)) g.cov = Object.assign({}, old.cov || {}, g.cov || {});
  g.standalone = true; f.group = g.name;
  const amy = fTask(f, 'PORTAL_ADD');
  if (amy && !done(amy)) mail({ key: 'm:E8sa:' + amy.key, code: 'E8', to: [amy.assignee], fac: f.id, task: amy.key, subject: 'Update: ' + f.name + ' has no corporate', body: `<p><b>${esc(f.name)}</b> has no corporate. Please set it up as its own corporate, named <b>${esc(n)}</b>.</p>` });
}
function gddAnswer(f, a, wh) {
  f.gdd = a; f.gddWh = wh || '';
  if (a !== 'Yes') return;
  mail({ key: 'm:E11:' + f.id, code: 'E11', to: [roleEmail('gddInfo')], cc: [amOf(f)], fac: f.id, link: 'none', subject: 'New facility on GDD: ' + facName(f), body: `<p>Hi ${esc(first(roleName('gddInfo')))},</p><p>FYI, <b>${esc(facName(f))}</b> (${esc(f.group || 'corporate not known yet')}) is a new facility and it's going to be serviced through <b>${esc(f.gddWh)}</b>.</p><p>Thank you!</p>` });
  if (done(fTask(f, 'PORTAL_SETUP')) && !fTask(f, 'GDD_PORTAL')) {
    const n = newTask('GDD_PORTAL', { fac: f.id, assignee: amOf(f), amTask: true });
    mail({ key: 'm:E13:' + n.key, code: 'E13', to: [n.assignee], fac: f.id, task: n.key, cond: { task: n.key }, subject: 'To do: GDD warehouse for ' + facName(f), body: `<p>Chris says it's serviced through ${esc(f.gddWh)}. Set "Main Vendor" in the portal.</p>` });
  }
}
function addContacts(f, list, src) {
  list.forEach(c => {
    const dup = f.contacts.some(x => (x.email && c.email && lc(x.email) === lc(c.email)) || (!c.email && lc(x.first + x.last) === lc(c.first + c.last) && lc(x.first + x.last)));
    if (!dup) f.contacts.push({ first: c.first || '', last: c.last || '', dept: c.dept || '', note: c.note || '', email: c.email || '', src, inPortal: false });
  });
}
function ruleFacs(t) { return st.facs.filter(f => !f.rep && !f.hold && !f.archived && (t.group === '__nocorp' ? !f.group : lc(f.group) === lc(t.group))); }

// ---------- inbox (emails that arrived in the shared mailbox) ----------
function processInbox() {
  (st.inbox || []).forEach(m => {
    if (m.processed) return;
    m.processed = true;
    const subj = m.subject || '', ls = lc(subj), from = lc(m.from);
    const ct = subj.match(/\[CT-(\d+)\]/);
    if (ct && facById(+ct[1])) { m.fac = +ct[1]; return; }
    const mb = lc(CFG.mailbox), inTo = (m.to || []).map(lc).includes(mb), inCc = (m.cc || []).map(lc).includes(mb);
    const live = st.facs.filter(f => !f.archived);
    const match = f => ls.includes(lc(facName(f))) || ls.includes(lc(f.name));
    // "Done" reply to Email 3 (or one of its follow-ups) from anyone but us or GNS Chicago
    const chicago = [...(st.settings.e1To || []), ...(st.settings.e1Cc || [])].map(lc);
    if (from !== mb && !chicago.includes(from) && ls.includes('transfer from gns chicago') && isDoneReply(m.preview)) {
      const f = live.find(x => x.email3 && !x.e3Done && match(x));
      if (f) { markE3Done(f, m.from, (m.received || '').slice(0, 10) || st.today); m.fac = f.id; m.isE3Done = true; return; }
    }
    if (from !== mb && inCc && !inTo && ls.includes('transfer from gns chicago')) {
      const f = live.find(x => x.email1 && !x.email2 && match(x));
      if (f) { f.email2 = (m.received || '').slice(0, 10) || st.today; f.email2By = m.from + ' (seen in the mailbox)'; m.fac = f.id; m.isEmail2 = true; return; }
    }
    const f = live.find(match); if (f) m.fac = f.id;
  });
}

// ---------- the engine ----------
function run() {
  if (!st || !st.settings) return;
  processInbox();
  const groupsSeen = {};
  st.facs.forEach(f => {
    if (f.hold || f.complete || f.archived) return;
    const am = amOf(f);
    // tasks whose owner is "the facility's AM" follow the AM if it changes
    tasksOf(f).forEach(t => { if (t.amTask && !done(t) && t.assignee !== am) t.assignee = am; });

    // facility asks, once, right when the request is saved
    if (!f.asked) {
      f.asked = true;
      const need = { corp: !f.group, addr: !f.address };
      const tf = newTask('FASTCARE', { fac: f.id, assignee: am, amTask: true, need });
      mail({ key: 'm:E13:' + tf.key, code: 'E13', to: [am], fac: f.id, task: tf.key, cond: { task: tf.key }, subject: 'To do: FastCare for ' + f.name,
        body: '<p>Get from FastCare: ' + [need.corp ? 'the corporate' : '', need.addr ? 'the address' : '', 'the wound rep, regional and any contacts we don\'t have yet'].filter(Boolean).join('; ') + '.</p>' + note(['The contacts we already have are listed in the task.', need.corp ? 'The areas of care and price table requests go out as soon as you save the corporate.' : '', 'Email 3 goes to the wound rep and regional as soon as this task is done.'].filter(Boolean).join(' ')) });
      const tg = newTask('GDD', { fac: f.id, assignee: roleEmail('gdd') });
      queue('E10', tg.assignee, f, tg, (fs, ts) => fs.length === 1
        ? { code: 'E10', to: [ts[0].assignee], fac: fs[0].id, task: ts[0].key, buttons: ['No'], cond: { task: ts[0].key }, subject: 'GDD orders for ' + fs[0].name + '?', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>Did <b>${esc(fs[0].name)}</b> (${esc(fs[0].group || 'corporate not known yet')}) get orders from GDD? If yes, open the task and pick the warehouse.</p>` }
        : { code: 'E10', to: [ts[0].assignee], link: 'none', subject: 'GDD orders for ' + fs.length + ' facilities?', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>Did any of these get orders from GDD? Click "No" or open the task to pick the warehouse.</p>${taskList(fs.map((x, i) => ['<b>' + esc(x.name) + '</b>', ts[i].key]), ['No'])}` });
      const tb = newTask('BRIGHTREE', { fac: f.id, assignee: am, amTask: true });
      mail({ key: 'm:E13:' + tb.key, code: 'E13', to: [am], fac: f.id, task: tb.key, cond: { task: tb.key }, subject: 'To do: Brightree report for ' + f.name, body: '<p>Run the GNS Lakewood Report and enter what you find.</p>' + note('Dates calculate from it.') });
    }

    // corporate not known yet: Malka picks reps per facility; corporate asks wait for the FastCare task
    if (!f.group) {
      if (!f.rep && !st.tasks.some(t => t.group === '__nocorp' && t.type === 'RULE' && !done(t))) {
        const t = newTask('RULE', { group: '__nocorp', assignee: roleEmail('rules') });
        mail({ key: 'm:E3:' + t.key, code: 'E3', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Pick a rep: corporate not known yet', body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>These facilities don't have a corporate yet, so there's no corporate rule to use. Pick the reps per facility.</p><ul>${ruleFacs(t).map(x => '<li>' + esc(x.name) + '</li>').join('')}</ul>` });
      }
      return;
    }
    const g = G(f);
    // rep rule
    if (!f.rep && g.rep) { f.rep = g.rep; f.clin = g.clin || g.rep; if (!f.am && g.am) f.am = g.am; }
    if (!f.rep && !st.tasks.some(t => lc(t.group) === lc(g.name) && t.type === 'RULE' && !done(t))) {
      const t = newTask('RULE', { group: g.name, assignee: roleEmail('rules') });
      queue('E3', t.assignee, f, t, (fs, ts) => ({ code: 'E3', to: [ts[0].assignee], task: ts[0].key, cond: { task: ts[0].key }, subject: 'Pick a rep: ' + g.name, body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>These facilities from <b>${esc(g.name)}</b> have no rep and the corporate has no rep rule:</p><ul>${facsOfGroup(g.name).filter(x => !x.rep).map(x => '<li>' + esc(x.name) + '</li>').join('')}</ul><p>Pick the intake rep, clinical rep and AM. Tick "Save as the corporate rule" so future facilities under this corporate get them automatically.</p>` }));
    }
    // corporate asks, once per corporate
    if (!groupsSeen[lc(g.name)]) {
      groupsSeen[lc(g.name)] = 1;
      if (!covKnown(g) && !gTask(g.name, 'AREAS')) {
        const t = newTask('AREAS', { group: g.name, assignee: f.requester || fallbackOwner() });
        mail({ key: 'm:E4:' + t.key, code: 'E4', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Areas of care for ' + g.name, body: `<p>Which areas of care are we taking for <b>${esc(g.name)}</b>? Still needed: ${AREAS.filter(x => !(g.cov || {})[x]).join(', ')}. Pick 1 per area in the task.</p>` });
      }
      if (!g.price && !gTask(g.name, 'PRICE')) {
        const t = newTask('PRICE', { group: g.name, assignee: roleEmail('price') });
        mail({ key: 'm:E5:' + t.key, code: 'E5', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Price table for ' + g.name, body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>Which price table does <b>${esc(g.name)}</b> go on? Facilities: ${facsOfGroup(g.name).map(x => esc(x.name)).join(', ')}.</p>` });
      }
      const gf = facsOfGroup(g.name).filter(x => !x.hold);
      if (!g.emr && !gTask(g.name, 'EMR') && gf.length && gf.every(x => x.inPortal)) {
        const t = newTask('EMR', { group: g.name, assignee: roleEmail('emr') });
        mail({ key: 'm:E7:' + t.key, code: 'E7', to: [t.assignee], cc: [am], task: t.key, cond: { task: t.key }, subject: 'EMR access: ' + g.name, body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>We need EMR access for <b>${esc(g.name)}</b>. These are in the portal: ${gf.map(x => esc(facName(x))).join(', ')}.</p><p>Please enter "Emr", "Emr Username" and "Emr Password" on each one and save the QR code on the server in the "Authenticator" folder, named the username. Then mark the task done.</p>` });
      }
    }
    // dates (frozen once Email 1 went out)
    { const d = calcDates(f); if (d && !f.email1) { f.rec = d; f.dates = f.dosChosen ? Object.assign(derive(f, f.dosChosen), { why: [...d.why, 'Changed by ' + (f.dosBy || 'someone') + ' from the recommended ' + fmtS(d.dos)], changed: true }) : d; } }
    // Amy adds it to Brightree once the price table is in
    if (g.price && f.address && !fTask(f, 'PORTAL_ADD') && !f.inPortal) addAmy(f);
    // existing EMR login: ask corporate to add this facility
    const main = mainCorp(g);
    if (g.emr && !g.emrNew && !fTask(f, 'EMR_ADD')) {
      const t = newTask('EMR_ADD', { fac: f.id, assignee: am, amTask: true });
      if (main) mail({ key: 'm:E7b:' + t.key, code: 'E7b', to: [main.email], cc: [am], fac: f.id, link: 'none', subject: 'Add ' + f.name + ' to your EMR login', body: `<p>Hi ${esc(main.first)},</p><p>Can you add <b>${esc(f.name)}</b> to the existing EMR login <b>${esc(g.emr)}</b>? Thank you!<br>${esc(nameOf(am))}</p>` });
    }
    if (f.inPortal && !fTask(f, 'PUMPS') && !f.pumps) {
      const tp = newTask('PUMPS', { fac: f.id, assignee: roleEmail('pumps') });
      queue('E9', tp.assignee, f, tp, (fs, ts) => fs.length === 1
        ? { code: 'E9', to: [ts[0].assignee], fac: fs[0].id, task: ts[0].key, buttons: ['Checked'], cond: { task: ts[0].key }, subject: 'Pumps: ' + facName(fs[0]), body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p><b>${esc(facName(fs[0]))}</b> (${esc(fs[0].group)}) is in the portal now. Please check if GNS Chicago sent it pumps and add any to "Pump Tracking". Click "Checked" when you're done.</p>` }
        : { code: 'E9', to: [ts[0].assignee], link: 'none', subject: 'Pumps: ' + fs.length + ' facilities', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>These are in the portal now. Please check if GNS Chicago sent them pumps and add any to "Pump Tracking". Click "Checked" next to each one when you're done.</p>${taskList(fs.map((x, i) => ['<b>' + esc(facName(x)) + '</b>', ts[i].key]), ['Checked'])}` });
    }
    // portal setup: rep + price table + all areas of care + in the portal + dates
    if (!fTask(f, 'PORTAL_SETUP') && f.rep && g.price && covKnown(FG(f)) && f.inPortal && f.dates && f.bt) {
      const t = newTask('PORTAL_SETUP', { fac: f.id, assignee: am, amTask: true });
      mail({ key: 'm:E13:' + t.key, code: 'E13', to: [am], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'To do: portal setup for ' + f.name, body: '<p>Every value is ready in the task. Type them in and save.</p>' });
    }
    if (!fTask(f, 'EMR_PORTAL') && g.emr && !g.emrNew && f.inPortal && done(fTask(f, 'EMR_ADD'))) {
      const t = newTask('EMR_PORTAL', { fac: f.id, assignee: am, amTask: true });
      mail({ key: 'm:E13:' + t.key, code: 'E13', to: [am], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'To do: EMR info for ' + f.name, body: '<p>Fill "Emr", "Emr Username", "Emr Password". Save the QR code in "Authenticator" named the username.</p>' });
    }
    {
      const fc = fTask(f, 'FASTCARE'), openCP = tasksOf(f, 'CONTACTS_PORTAL').some(t => !done(t));
      if (!openCP && f.inPortal && done(fc) && f.contacts.some(c => !c.inPortal)) {
        const t = newTask('CONTACTS_PORTAL', { fac: f.id, assignee: am, amTask: true });
        mail({ key: 'm:E13:' + t.key, code: 'E13', to: [am], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'To do: add contacts for ' + facName(f), body: '<p>"Add Contact" in the portal for each one listed in the task.</p>' });
      }
    }
    if (!fTask(f, 'SCHEDULE') && done(fTask(f, 'PORTAL_SETUP'))) {
      const t = newTask('SCHEDULE', { fac: f.id, assignee: am, amTask: true });
      mail({ key: 'm:E13:' + t.key, code: 'E13', to: [am], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'To do: schedule ' + facName(f), body: '<p>Facility Schedule, Generate Dates, check the Ordering Calendar.</p>' + note('"Mark done" sends Email 1 to Chicago.') });
    }
    // Email 3 to the wound rep + regional: as soon as the FastCare task is done
    if (!f.email3 && done(fTask(f, 'FASTCARE')) && f.wound && f.regional) sendEmail3(f);
    // older facilities had an "Email 3 follow-up" task: carry over its answer, close it if still open
    const e3t = fTask(f, 'EMAIL3_FOLLOW');
    if (e3t && e3t.status === 'Done') markE3Done(f, e3t.doneBy, e3t.doneOn);
    if (e3t && !done(e3t)) { e3t.status = 'Not needed'; e3t.doneOn = st.today; }
    chaseEmail3(f);
    // after Email 2: the follow-up on Chicago isn't needed
    if (f.email2) { const cf = fTask(f, 'CHICAGO_FOLLOW'); if (cf && !done(cf)) { cf.status = 'Not needed'; cf.doneOn = st.today; } }
    // at risk: ordering date within 3 business days and Email 1 not out
    if (f.dates && !f.email1 && f.riskFor !== f.dates.ord) {
      f.riskFor = f.dates.ord; const day = addBiz(f.dates.ord, -3);
      mail({ key: 'm:risk:' + f.id + ':' + f.dates.ord, code: 'E18', to: [am], fac: f.id, link: 'fac', day: day > st.today ? day : st.today, cond: { fac: f.id, untilEmail1: true, ord: f.dates.ord }, subject: 'At risk: ' + facName(f) + ' orders ' + fmt(f.dates.ord) + ' and Chicago hasn\'t been emailed', body: '<p>Finish the open tasks so Email 1 can go out.</p>' });
    }
    // complete
    if (f.email2 && done(fTask(f, 'GDD')) && (!f.email3 || f.e3Done)) {
      f.complete = st.today;
      tasksOf(f).forEach(t => { if (!done(t) && ['CHICAGO_FOLLOW'].includes(t.type)) t.status = 'Not needed'; });
      mail({ key: 'm:E24:' + f.id, code: 'E24', to: [am, f.requester], fac: f.id, link: 'fac', subject: 'Transition complete: ' + facName(f), body: `<p><b>${esc(facName(f))}</b> is done. First DOS ${fmt(f.dates.dos)}, ordering ${fmt(f.dates.ord)}, delivery ${fmt(f.dates.del)}. Intake rep: ${esc(nameOf(f.rep))}.</p>` });
    }
  });
  // the "no corporate yet" rep task closes itself once every facility on it has a rep or a corporate
  st.tasks.filter(t => t.type === 'RULE' && t.group === '__nocorp' && !done(t) && !ruleFacs(t).length).forEach(t => { t.status = 'Not needed'; t.doneOn = st.today; });
  // archive facilities completed 30+ days ago (they drop out of the daily load; Tracker can still show them)
  st.facs.forEach(f => { if (f.complete && !f.archived && diff(f.complete, st.today) >= 30) { f.archived = true; tasksOf(f).forEach(t => t.archived = true); } });
  flush();
  ensureTaskMails();
  st.mails.forEach(m => { if (m.status === 'Queued' && !mailStillValid(m)) m.status = 'Cancelled'; });
}

// ---------- user actions that aren't tasks ----------
function holdToggle(f, on, byName) {
  f.hold = on;
  const open = tasksOf(f).filter(t => !done(t)), owners = [...new Set(open.map(t => t.assignee))];
  if (!on) open.forEach(t => { t.due = addBiz(isWaiting(t) ? t.opensOn : st.today, isAm(t.assignee) ? st.settings.amDays : st.settings.helperDays); });
  mail({ key: 'm:E23:' + f.id + ':' + uid(), code: 'E23', to: owners.length ? owners : [amOf(f)], cc: [amOf(f)], fac: f.id, link: 'fac', subject: (on ? 'On hold: ' : 'Back on: ') + facName(f), body: (on ? '<p>Your tasks for this facility are paused. Reminders stop.</p>' : '<p>Picking up where it stopped.</p>') + '<p>By ' + esc(byName) + '.</p>' });
}
// admin only: removes a test facility or a mistake. The rows stay in SharePoint (archived) but the app ignores them.
function deleteFacility(f, byName) {
  f.deleted = true; f.archived = true; f.deletedBy = byName; f.deletedOn = st.today;
  tasksOf(f).forEach(t => { if (!done(t)) { t.status = 'Not needed'; t.doneOn = st.today; } t.archived = true; });
  st.mails.forEach(m => { if (m.status === 'Queued' && m.fac === f.id) m.status = 'Cancelled'; });
}
function markEmail2(f, byName) {
  f.email2 = st.today; f.email2By = byName;
}
