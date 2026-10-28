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
    chicagoGreeting: 'Christian', chicagoGreetingNoEnt: 'Brittany',
    // from the Email 1s sent on 10/7/2026
    e1To: ['darlene.kusek@gentell.com', 'christian.brandt@gentell.com', 'danielle.butler@gentell.com', 'bbarrows@gentell.com'],
    e1Cc: ['kyle.king@gentell.com', 'dproulx@gentell.com', 'bschorn@gentell.com', 'jvidal@gentell.com', 'linda.anwaya@gentell.com', 'aliyah.price@gentell.com'],
    // email to the Gentell WC Transition Lead (Oct 26 2026): extra To / CC on top of the people added automatically
    e1bTo: [], e1bCc: [], esignTo: [], esignGreet: 'Anthony',
    inserviceUrl: '',
    tier2Price: '2022 Tier 2',
    biller: 'Sreejith Sreekumar',
    helperDays: 2, amDays: 1,
    warehouses: ['GDD Boca Raton', 'GDD Bristol', 'GDD Chicago', 'GDD Chicopee', 'GDD Cleveland', 'GDD Dallas', 'GDD Evansville', 'GDD Minneapolis', 'GDD Ocala'],
    depts: 'Accounts Payable|F,Accounts Receivable|F,Administrator|F,Admissions|F,ADON|F,AP|C,Assistant Administrator|F,Business Office/Payers Contact|F,Census/Payers|C,Central Supply|F,Clinical Operations|F,Corporate Clinical|C,Corporate contact|C,Corporate Operations|C,Corporate Owner|C,Corporate Purchasing|C,Dietitian|F,Director of Purchasing|C,DON|F,EMR Access|C,Food Service|F,Medical Provider|F,Medical Records|F,Other|F,Other Nursing|F,Payers Contact|F,Regional|F,Regional Clinical|C,Regional Dietician|C,Rehab Director|F,Respiratory|F,Speech Therapist|F,Wound Care|F'
      .split(',').map(x => { const [n, t] = x.split('|'); return { name: n, type: t === 'F' ? 'Facility' : 'Corporate' }; }),
    shipEnt: { 1: 'CT DE IL OH MA MD ME MI MO NH NJ NY PA RI VT AL FL GA NC SC TN VA TX', 2: 'AR CO IA ID IN KY LA MS ND NE NM OK SD UT WI CA NV OR WA AZ DC KS MN MT WV', 3: 'WY HI' },
    shipOst: { 1: 'CT DE MA MD ME NH NJ NY PA RI VT', 2: 'OH WV', 3: 'DC FL GA KY NC SC TN VA AL TX AZ', 4: 'IL IN IA KS MI MN MO NE ND SD WI MS', 5: 'AR LA NM OK CO ID MT UT WY', 6: 'CA NV OR WA', 7: 'AK HI' }
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
const az = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
// A to Z by name, for dropdowns. Never sorts the saved list itself.
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
const sortedPeople = () => [...people()].sort(byName);
const amList = () => people().filter(p => p.am && validEmail(p.email)).sort(byName);
const repList = () => people().filter(p => p.rep && validEmail(p.email)).sort(byName);
const isAm = e => !!(person(e) || {}).am;
const isAdmin = e => !!(person(e) || {}).admin;
const fallbackOwner = () => roleEmail('escalate') || (people().find(p => p.admin && validEmail(p.email)) || {}).email || '';
function deptMap() { const m = {}; st.settings.depts.forEach(d => m[d.name] = d.type); return m; }
// the state decides the ship point, and the ship point decides the delivery date. No known state = no dates.
// Addresses come in every shape (copied from the portal, FastCare, emails): "…, Benson, AZ 85602", "… Benson Arizona 85602",
// "… benson az 85602-1234", "…, Benson, AZ 85602, USA". parseAddr reads the state (2 letters or the full name) and zip at the end.
const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const STATE_NAMES = Object.entries(US_STATES).map(([c, n]) => [c, n]).concat([['DC', 'Washington DC'], ['DC', 'Washington D.C.']]).sort((a, b) => b[1].length - a[1].length);
// → { street (everything before the state), state: 'AZ', zip: '85602' or '85602-1234', norm: '…, Benson, AZ 85602' } or null
function parseAddr(addr) {
  let s = String(addr || '').replace(/\s+/g, ' ').trim().replace(/[\s,.]*(u\.?s\.?a?\.?|united states( of america)?)$/i, '').trim();
  const m = s.match(/^(.*?)[\s,]+(\d{5})(?:\s*-\s*(\d{4}))?\s*\.?$/); if (!m) return null;
  const before = ' ' + m[1].replace(/[\s,.]+$/, ''), zip = m[2] + (m[3] ? '-' + m[3] : '');
  let state = '', street = '';
  const two = before.match(/^(.*)[\s,]([A-Za-z])\.?\s?([A-Za-z])\.?$/);
  if (two && US_STATES[(two[2] + two[3]).toUpperCase()]) { state = (two[2] + two[3]).toUpperCase(); street = two[1]; }
  else for (const [c, n] of STATE_NAMES) { const r = before.match(new RegExp('^(.*)[\\s,]' + n.replace(/\./g, '\\.?').replace(/ /g, '\\s+') + '$', 'i')); if (r) { state = c; street = r[1]; break; } }
  street = street.replace(/[\s,]+$/, '').trim();
  if (!state || !street) return null;
  return { street, state, zip, norm: street + ', ' + state + ' ' + zip };
}
const stateFrom = addr => (parseAddr(addr) || {}).state || '';
// saved addresses always end ", ST 12345" so they read the same everywhere; anything that can't be read is kept as typed
const normAddr = addr => { const p = parseAddr(addr); return p ? p.norm : String(addr || '').trim(); };
const stateOK = f => !!(f && f.state && shipOf(st.settings.shipEnt, f.state));
// '' when the address can be read (street, city, state, zip), otherwise what's wrong
function addressFormatProblem(addr) {
  return parseAddr(addr) ? '' : 'Type the full address with the city, state and zip at the end (…, Benson, AZ 85602). The state can be the 2 letters or the full name.';
}
// '' when the address is fine to schedule with (its state has a ship point), otherwise what's wrong
function addressProblem(addr) {
  if (addressFormatProblem(addr)) return addressFormatProblem(addr);
  const s = stateFrom(addr); if (!shipOf(st.settings.shipEnt, s)) return 'There\'s no ship point for ' + s + ' in Settings ("Ship points"), so the delivery date can\'t be worked out. Ask Raizy to add it.';
  return '';
}
function shipOf(tbl, state) { for (const k in tbl) if (tbl[k].split(/\s+/).includes(state)) return +k; return null; }

function settingsProblems() {
  const s = st.settings, out = [];
  for (const r in ROLES) {
    const p = person(s.roles[r]);
    if (!p) out.push('Who does "' + ROLES[r] + '"? Pick a person.');
    else if (!validEmail(p.email)) out.push(p.name + ' needs an email (' + ROLES[r] + ').');
  }
  people().filter(p => (p.am || p.rep || p.admin) && !validEmail(p.email)).forEach(p => out.push(p.name + ' needs an email.'));
  if (!amList().length) out.push('Tick at least 1 transition lead.');
  if (!repList().length) out.push('Add at least 1 intake rep.');
  if (!s.e1To.length) out.push('Chicago handoff email "To" list is empty.');
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
// the name GNS Chicago / Gentell uses (typed on the request). Shown small next to the portal name once that's different.
const facNames = f => [...new Set([facName(f), f.name, String(f.name || '').replace(/\s*\([^)]*\)\s*$/, '')].map(lc).filter(n => n.length >= 4))];
const chiName = f => f && f.portalName && lc(f.portalName) !== lc(f.name) ? f.name : '';
// "Portal name / Chicago name" (the Chicago handoff email subject), or just the one name
const bothNames = f => chiName(f) ? facName(f) + ' / ' + f.name : facName(f);
// Chicago handoff email greeting: Brittany when we don't take enteral, otherwise Christian (both in Settings)
const chiGreet = f => (FG(f).cov || {}).Enteral === "Don't Supply" ? (st.settings.chicagoGreetingNoEnt || 'Brittany') : st.settings.chicagoGreeting;
// Gentell WC Transition Lead (Oct 26 2026): the Gentell person who sends the transfer email to the facility. Anyone in the company
// address book, saved as { name, email } on the facility (f.ctl). Picked on the request (optional) or on "Pick the reps".
const ctlOf = f => f && f.ctl && validEmail(f.ctl.email) ? f.ctl : null;
const ctlEmail = f => ctlOf(f) ? lc(f.ctl.email) : '';
const facById = i => st.facs.find(f => f.id === i);
const taskByKey = k => st.tasks.find(t => t.key === k);
const tasksOf = (f, type) => st.tasks.filter(t => t.fac === f.id && (!type || t.type === type));
const gTask = (gname, type) => st.tasks.find(t => !t.fac && lc(t.group) === lc(gname) && t.type === type);
const fTask = (f, type) => st.tasks.find(t => t.fac === f.id && t.type === type);
const done = t => !!t && (t.status === 'Done' || t.status === 'Not needed');
const isWaiting = t => !done(t) && !!t.opensOn && t.opensOn > st.today;
// "am" in the data = the transition lead (runs this transition). The account manager is "acct": kept in the loop like the intake rep.
function amOf(f) { return f.am || G(f).am || fallbackOwner(); }
function acctOf(f) { return f.acct || (f.group ? G(f).acct : '') || ''; }
function FG(f) { const g = G(f); return Object.assign({}, g, { cov: Object.assign({}, g.cov || {}, f.cov || {}) }); }
// every area except wound care is "Covered Only" or "Don't Supply" → the default Tier 2 price table, nobody has to pick one
function isTier2(g) { return AREAS.filter(a => a !== 'Wound Care').every(a => ['Covered Only', "Don't Supply"].includes((g.cov || {})[a])); }
function areasTableHtml(g) { return `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Area of care</th><th>We supply</th></tr>${AREAS.map(a => `<tr><td>${a}</td><td>${esc((g.cov || {})[a] || 'Not decided yet')}</td></tr>`).join('')}</table>`; }
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
  const b = f.bt, g = FG(f); if (!b || !covKnown(g) || !stateOK(f)) return null;
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
  // first orders start processing a week before the ordering date: the ordering date is at least a week from today,
  // unless someone unticked "Push out a week" for a rush (f.noPush)
  const plain = dos, weekOut = add(st.today, 7); let wk = dos;
  while (addBiz(wk, -back) < weekOut) wk = addBiz(wk, 1);
  const weekPush = wk !== plain ? { from: plain, fromOrd: addBiz(plain, -back) } : null;
  if (weekPush && !f.noPush) { dos = wk; why.push('Ordering date ' + fmtS(weekPush.fromOrd) + ' is within a week of today → pushed so ordering is ' + fmtS(addBiz(dos, -back)) + ', a week out (time to process the first order). DOS ' + fmtS(dos)); }
  else if (weekPush) why.push('Ordering date is within a week of today, but "Push out a week" is unticked (rush), so it stays');
  // David's facilities: the intake rep is picked now, so the date moves on until someone on his team has room that day
  let capFrom = '';
  if (autoPending(f)) {
    const cd = autoDos(f, dos, back);
    if (cd !== dos) { capFrom = dos; why.push('Everyone on ' + first(nameOf(autoAcct())) + '\'s team already has ' + AUTO_REP_FULL + ' or more facilities ordering ' + fmtS(addBiz(dos, -back)) + ' → pushed so ordering is ' + fmtS(addBiz(cd, -back)) + '. DOS ' + fmtS(cd)); dos = cd; }
    const p = autoPick(addBiz(dos, -back), f.id);
    if (p) why.push('Intake rep: ' + nameOf(p) + ' (' + (repLoad(addBiz(dos, -back), f.id)[p] || 0) + ' other facilities ordering that day)');
  }
  const sp = shipOf(st.settings.shipEnt, f.state) || 1;
  why.push((pb ? 'Part B only → ordering 2 business days' : 'Not Part B only → ordering 1 business day') + ' before DOS');
  why.push('Ship Point ' + f.state + ' = ' + sp + ' → delivery DOS + ' + sp + ' business day' + (sp > 1 ? 's' : ''));
  return Object.assign(derive(f, dos), { why, weekPush, pushedWeek: !!weekPush && !f.noPush, capFrom });
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
  // pushed only because David's team was full that day: earlier is a capacity question, not a billing one
  if (r.capFrom && dos < r.dos && dos >= r.capFrom) w.push('The recommended ' + fmt(r.dos) + ' was pushed out because ' + first(nameOf(autoAcct())) + '\'s team was full on the earlier days. Check the intake rep below.');
  const billDos = r.capFrom || r.dos;
  if (dos < billDos) { const n = diff(dos, billDos); w.push('This DOS is ' + n + ' day' + (n > 1 ? 's' : '') + ' earlier than the recommended ' + fmt(billDos) + ', which is ' + basisText(f) + '. Chicago\'s last delivery may not be used up yet, so this order could overlap their billing.'); }
  if (isWE(dos)) w.push('This DOS is on a ' + WD[dow(dos)] + '.');
  const d = derive(f, dos); if (d.ord < addBiz(st.today, 1)) w.push('The ordering date (' + fmt(d.ord) + ') has already passed or is today.');
  else if (d.ord < add(st.today, 7) && !f.noPush) w.push('The ordering date (' + fmt(d.ord) + ') is less than a week from today. First orders usually start processing a week before the ordering date.');
  return w;
}
function saveDates(f, dos, by) {
  if (f.rec && dos === f.rec.dos) { f.dosChosen = ''; f.dosBy = ''; f.dates = f.rec; }
  else { f.dosChosen = dos; f.dosBy = by; f.dates = Object.assign(derive(f, dos), { why: [...(f.rec ? f.rec.why : []), 'Changed by ' + by + ' from the recommended ' + (f.rec ? fmtS(f.rec.dos) : '')], changed: true }); }
  if (f.email1) mail({ key: 'm:E13:dates:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, subject: 'Dates changed after the Chicago handoff email: ' + facName(f), body: '<p>' + esc(by) + ' changed the dates after the Chicago handoff email went out. Fix the Ordering Calendar, then click "Dates changed: send correction" on the facility page.</p>', link: 'fac' });
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

// a corporate we already work with in the portal (price table, EMR access) that's new to this app
const hasPrice = g => !!(g && (g.price || g.existing));
// "already done" flags. Since Oct 19 2026 (f.pre.v2) FastCare and the contacts request are 2 steps (wr, e3), and so are
// scheduling and the Chicago handoff email (sched, e1). Older flags: fc = wr + e3, e1 = sched + e1.
const preDone = (f, k) => { const p = f && f.pre; if (!p) return false; if (p[k]) return true; if (p.v2) return false; return (k === 'wr' || k === 'e3') ? !!p.fc : k === 'sched' ? !!p.e1 : false; };
// older flags spelled out in the new keys, so adding to them never changes what they meant
function normPre(p) { const o = Object.assign({}, p || {}); if (!o.v2) { if (o.fc) { o.wr = true; o.e3 = true; } if (o.e1) o.sched = true; o.v2 = true; } return o; }
// the handoff email was marked sent, but it wasn't scheduled yet: the Brightree report + schedule still happen (without sending the email again)
const handoffOnly = f => !!(f.email1 && f.pre && f.pre.v2 && f.pre.e1 && !f.pre.sched && !f.schedDone);
// dates still move (recalculate, can be changed) until the handoff email, or until the schedule is done after a handoff marked sent
const datesOpen = f => !f.email1 || handoffOnly(f);
// dates typed in because it was already scheduled (no Brightree report)
function manualDatesObj(f) {
  const m = f.manualDates; if (!m) return null;
  return { ord: m.ord, dos: m.dos, del: m.del, os: diff(m.ord, m.del), day: WD[dow(m.del)], manual: true, why: ['Already scheduled: dates entered by ' + (m.by || 'someone') + (m.on ? ' on ' + fmtS(m.on) : '')] };
}
const CAD_V = { Monthly: '4', Biweekly: '2', Weekly: '1' }, CAD_L = { 4: 'Monthly', 2: 'Biweekly', 1: 'Weekly' };
// FastCare done, or its info filled in when marked already done (new flag only, so older facilities get no new contacts task)
const fcDoneNew = f => done(fTask(f, 'FASTCARE')) || !!(f.pre && f.pre.v2 && f.pre.wr && !f.pre.fc);
// what an "already done" step needs typed in (per facility). info: { pn, gdd, gddWh, wound, regional, ord, dos, del, cad }. Returns '' or what's wrong.
function preInfoProblem(keys, i, label) {
  const L = label ? label + ': ' : '';
  if (keys.includes('added') && !i.pn) return L + '"Facility added to Brightree": type the name as Brightree shows it.';
  if (keys.includes('gdd') && !['Yes', 'No'].includes(i.gdd)) return L + '"GDD question answered": pick Yes or No.';
  if (keys.includes('gdd') && i.gdd === 'Yes' && !i.gddWh) return L + '"GDD question answered": which warehouse?';
  if (keys.includes('wr') && (!i.wound || !i.regional)) return L + '"FastCare info gathered": pick the wound rep and the regional from the list (start typing their name).';
  if (keys.includes('sched')) {
    if (!i.ord || !i.dos || !i.del) return L + '"Scheduled": enter the ordering date, date of service and delivery date.';
    if (!(i.ord < i.dos && i.dos <= i.del)) return L + '"Scheduled": the ordering date has to be before the date of service, and the delivery date on or after it.';
    if (!i.cad) return L + '"Scheduled": pick how often enteral ships.';
  }
  return '';
}
// what can be ticked as "already done" on the request. Order = the order of the flow.
const PRE_ITEMS = [
  ['corp', 'Corporate is already set up in the portal (we have the price table, EMR access and so on)', 'Skips the price table and EMR access requests. It still gets added here like any corporate.'],
  ['added', 'Facility added to Brightree', 'Skips Amy\'s "Add … to Brightree" task. Type the name exactly as Brightree shows it.'],
  ['pumps', 'Pumps checked and added to "Pump Tracking"', ''],
  ['gdd', 'GDD question answered', 'Skips the GDD question. Pick the answer, and the warehouse if Yes.'],
  ['wr', 'FastCare info gathered (we have the wound rep and regional)', 'Skips the FastCare task. Pick the wound rep and regional. The contacts request still goes to them, unless "Received contacts" is ticked too.'],
  ['e3', 'Received contacts', 'We already have the contacts and they\'re accurate (or the request already went out). Skips the contacts request and its follow-ups.'],
  ['ct', 'Added contacts to portal', 'The contacts are in the portal, so there\'s no "Contacts into portal" task. Ticks "Received contacts" too.'],
  ['es', 'Received eSign info', 'We have the provider(s) who sign the forms (name, NPI, email, eSign / email / fax). No email to Anthony Price. The transition lead still adds them to the portal, unless "Added eSign info to portal" is ticked too.'],
  ['esp', 'Added eSign info to portal', 'The providers are in the portal as physician contacts and in the eSign section of the portal setup. Ticks "Received eSign info" too.'],
  ['emr', 'EMR info for the facility is in the portal', ''],
  ['ps', 'Portal setup done', ''],
  ['sched', 'Scheduled', 'Skips the Brightree report and scheduling. Enter the dates from the Ordering Calendar. The Chicago handoff email goes out with them automatically, unless "Chicago handoff email sent" is ticked too.'],
  ['e1', 'Chicago handoff email sent', 'Skips sending it. If "Scheduled" isn\'t ticked, the Brightree report and schedule tasks still come, without sending the email again.'],
  ['e2', 'GNS Chicago sent the transfer notice to the facility', '']
];
// ticking a step ticks the ones it includes
const PRE_IMPLY = { e2: ['e1'], sched: ['ps'], ct: ['e3'], esp: ['es'] };
const PRE_INFO = ['added', 'gdd', 'wr', 'sched'];
// the AM's first tasks on new facilities, as links (skips ones ticked "already done")
const amFirstTasks = list => { const ts = list.flatMap(f => [preDone(f, 'wr') ? null : [esc(facName(f)) + ': FastCare', 't:FASTCARE:f' + f.id], preDone(f, 'sched') ? null : [esc(facName(f)) + ': Brightree report', 't:BRIGHTREE:f' + f.id]].filter(Boolean)); return ts.length ? '<p>Your tasks:</p>' + taskList(ts) : '<p>Nothing for you to do yet. You\'ll get an email when there is.</p>'; };
const preList = f => PRE_ITEMS.filter(([k]) => preDone(f, k)).map(x => x[1].split(' (')[0].split(',')[0]);

// ---------- email ----------
const btnStyle = 'display:inline-block;background:#003171;color:#ffffff;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0';
const appLink = q => CFG.appUrl + (q ? '?' + q : '');
const taskUrl = (key, answer) => appLink('task=' + encodeURIComponent(key) + (answer ? '&answer=' + encodeURIComponent(answer) : ''));
// smaller grey line for side information (what happens next, why), under the main instruction
const note = s => '<p style="color:#6B6F75;font-size:9.5pt;margin:-4px 0 10px">' + s + '</p>';
// one line per task in emails that cover several: facility name + its own buttons
const taskList = (items, answers) => '<ul>' + items.map(([label, key]) => '<li style="margin:4px 0">' + label + ' &nbsp; ' + (answers || []).map(a => `<a href="${esc(taskUrl(key, a))}">${esc(a)}</a> &middot; `).join('') + `<a href="${esc(taskUrl(key))}">Open the task</a></li>`).join('') + '</ul>';
// emails that only inform: they get a line at the bottom saying no action is needed
const FYI_CODES = new Set(['E1', 'E11', 'E19', 'E23', 'E24', 'E25']);
// said in the pumps email and task: from now on, every pump sent to the facility goes into the portal
const PUMP_RULE = 'Once the pumps are in the portal, any pumps sent to this facility in the future must also be entered in the portal.';
const PUMP_RULE_MANY = 'Once the pumps are in the portal, any pumps sent to these facilities in the future must also be entered in the portal.';
function emailHtml(body, m) {
  let links = '';
  if (m.task && m.buttons) links = '<p>' + m.buttons.map(b => `<a href="${esc(appLink('task=' + encodeURIComponent(m.task) + '&answer=' + encodeURIComponent(b)))}" style="${btnStyle}">${esc(b)}</a>`).join('') + `<a href="${esc(appLink('task=' + encodeURIComponent(m.task)))}" style="${btnStyle};background:#6B6F75">Open the task</a></p>`;
  else if (m.task && m.link !== 'none') links = `<p><a href="${esc(appLink('task=' + encodeURIComponent(m.task)))}" style="${btnStyle}">Open the task</a></p>`;
  else if (m.link === 'mytasks') links = `<p><a href="${esc(appLink('view=mytasks'))}" style="${btnStyle}">Open my tasks</a></p>`;
  else if (m.link === 'fac' && m.fac) links = `<p><a href="${esc(appLink('fac=' + m.fac))}" style="${btnStyle}">Open the facility</a></p>`;
  const cf = m.fac && !m.noTag && facById(m.fac), cn = cf ? chiName(cf) : '';
  if (cn) body += '<p style="color:#6B6F75;font-size:9pt;margin-top:10px">Chicago name: ' + esc(cn) + '</p>';
  const fyi = (m.fyi || FYI_CODES.has(m.code)) ? '<p style="color:#6B6F75;font-size:9.5pt;border-top:1px solid #E5E9ED;padding-top:6px;margin-top:12px">This email is for your information only. No action is needed on your part.</p>' : '';
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${body}${links}${fyi}</div>`;
}
/* mail({key, code, to:[emails], cc, subject, body, task, fac, day, cond, buttons, link, noTag})
   key  must be unique and the same every time the same email would be made, so it is never sent twice.
   day  YYYY-MM-DD to send later (8 am Eastern). Leave out to send now.
   cond when to cancel a later email (see mailStillValid). */
// "to do" email for a task with steps: just what to do; the details are in the task
function todo(t, subject, line, importance) {
  return mail({ key: 'm:E13:' + t.key, code: 'E13', to: [t.assignee], fac: t.fac, task: t.key, cond: { task: t.key }, subject: 'To do: ' + subject, body: '<p>' + line + '</p>', importance });
}
// follow-ups go out as high importance; everything else normal (the "CT - Send emails" flow reads the Importance column)
const HIGH_CODES = new Set(['E15', 'E16F', 'E16A', 'E17', 'E31F', 'E31A']);
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
    status: 'Queued', cond: m.cond || null, by: st.me ? st.me.email : '', attachPath: m.attachPath || '', attachName: m.attachName || '', attachPath2: m.attachPath2 || '', attachName2: m.attachName2 || '', importance: m.importance || (HIGH_CODES.has(m.code) ? 'High' : 'Normal')
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
  // "Pick a rep" is 1 email per corporate (its body and task are that corporate's), so a request with several corporates gets 1 each
  pending.forEach(p => { const k = p.code + '|' + p.to + '|' + (p.f.req || '') + (p.code === 'E3' ? '|' + lc(p.task.group) : ''); (groups[k] = groups[k] || []).push(p); });
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
    if (t.nf && typeof nfById === 'function') { const n = nfById(t.nf); if (!n || n.deleted) return false; }
  }
  if (c.fac) {
    const f = facById(c.fac); if (!f || f.hold || f.complete || f.deleted) return false;
    if (c.untilEmail1 && f.email1) return false;
    if (c.untilEmail2 && f.email2) return false;
    if (c.untilE3Done && (f.e3Done || f.e3Reply)) return false;
    if ('e3Round' in c && (f.e3Done || f.e3Reply || (f.e3Round || 0) !== c.e3Round)) return false;
    if ('esRound' in c && (f.esignGot || f.esignDone || (f.esignRound || 0) !== c.esRound)) return false;
    if (c.ord && (!f.dates || f.dates.ord !== c.ord)) return false;
  }
  return true;
}

// ---------- tasks ----------
const REPEATABLE = new Set(['PRICE', 'RULE', 'CONTACTS_PORTAL', 'GDD_PORTAL', 'E3_REPLY', 'ADDRESS', 'PORTAL_UPDATE', 'ESIGN_PORTAL']);
function newTask(type, o) {
  const base = 't:' + type + ':' + (o.fac ? 'f' + o.fac : o.nf ? 'n' + o.nf : 'g' + lc(o.group));
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
  t.status = 'Done'; t.doneBy = by; t.doneByName = byName; t.doneOn = st.today; t.doneAt = nowIso();
  if (by !== t.assignee && t.assignee) mail({ key: 'm:E19:' + t.key, code: 'E19', to: [t.assignee], fac: t.fac, subject: 'Done by ' + byName + ': ' + taskTitle(t), body: `<p>${esc(byName)} finished this.</p>`, link: 'none' });
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
    // reminders: 1 business day after the due date, then 2 (CC the transition lead), then 4 (CC the escalation person).
    // Only the next one is ever queued; the one after is queued once its turn comes.
    const rk = t.assignee + '|' + t.due, days = [1, 2, 4];
    if (t.remFor !== rk) { t.remFor = rk; t.remNext = 0; }
    while (t.remNext < days.length && (t.remNext === 0 || st.today >= addBiz(t.due, days[t.remNext - 1]))) {
      const i = t.remNext, am = f ? amOf(f) : t.nf ? ((typeof nfById === 'function' && nfById(t.nf)) || {}).lead || fallbackOwner() : (grp(t.group) && grp(t.group).am) || fallbackOwner();
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

// ---------- reminders: never 2 on the same task within 24 hours ----------
// A reminder is an E17 email on a task (the automatic ones above, or one a transition lead sends from "All open tasks").
const REM_GAP = 24 * 3600 * 1000;
const etDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
// demo mode runs on a pretend date: 9 am Eastern on st.today
const nowMs = () => st && st.demo ? Date.parse(st.today + 'T13:00:00Z') : Date.now();
const nowIso = () => new Date(nowMs()).toISOString();
const isReminder = m => m.code === 'E17' && !!m.task && m.status !== 'Cancelled' && m.status !== 'Failed';
const isManualRem = m => /:manual:/.test(m.key);
// when a reminder goes (or went) out: its send time, or 8 am Eastern on its day for ones queued "now" on another day (demo)
const remAt = m => m.sendOn && etDay(m.sendOn) === m.day ? Date.parse(m.sendOn) : Date.parse(m.day + 'T12:00:00Z');
const remindersOf = t => st.mails.filter(m => m.task === t.key && isReminder(m)).sort((a, b) => remAt(a) - remAt(b));
// the last reminder that went out or is going out now
function lastReminder(t) { const now = nowMs(); return remindersOf(t).filter(m => m.status === 'Sent' || remAt(m) <= now).pop() || null; }
function nextReminderAt(t) { const l = lastReminder(t); return l ? remAt(l) + REM_GAP : 0; }
const canRemind = t => !done(t) && !t.archived && !isWaiting(t) && nowMs() >= nextReminderAt(t);
// a weekend lands on 8 am Eastern the next business day
function remSlot(ms) { const d = etDay(new Date(ms).toISOString()); return isWE(d) ? Date.parse(nextBizDay(d) + 'T12:00:00Z') : ms; }
// scheduled reminders closer than 24 hours to the one before move later. Sent ones and ones a person sent never move.
function spaceReminders(t) {
  let last = -Infinity;
  remindersOf(t).forEach(m => {
    if (m.status === 'Queued' && !isManualRem(m) && remAt(m) < last + REM_GAP) { const iso = new Date(remSlot(last + REM_GAP)).toISOString(); m.sendOn = iso; m.day = etDay(iso); }
    last = Math.max(last, remAt(m));
  });
}
// a transition lead (or admin) reminds the person a task is assigned to. Returns '' or why it can't.
function sendReminder(t, by, byName) {
  if (!t || done(t)) return 'That task is done already.';
  if (isWaiting(t)) return 'That task hasn\'t started yet.';
  if (!canRemind(t)) return 'A reminder went out less than 24 hours ago. Next one possible ' + whenET(nextReminderAt(t)) + '.';
  const iso = new Date(nowMs() - 60000).toISOString();
  const m = mail({ key: 'm:E17:' + t.key + ':manual:' + etDay(iso), code: 'E17', to: [t.assignee], cc: [by !== t.assignee ? by : ''], fac: t.fac, task: t.key, cond: { task: t.key, assignee: t.assignee },
    subject: 'Reminder from ' + byName + ': ' + taskTitle(t), body: `<p>${esc(byName)} sent you a reminder about this task. ${st.today > t.due ? 'It was due' : 'It\'s due'} ${fmt(t.due)}.</p>` });
  if (!m) return 'A reminder for this task already went out today.';
  m.sendOn = iso; m.day = etDay(iso);
  t.lastRemind = { at: iso, by, byName };
  spaceReminders(t);
  return '';
}
const whenET = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- email templates ----------
function repLine(f) { const r = person(f.rep) || {}; return { name: r.name || nameOf(f.rep), email: r.email || f.rep, ext: r.ext || '' }; }
// the facility notice: what the Gentell WC Transition Lead sends to the facility (below the line on their email)
function facilityNotice(f) {
  const r = repLine(f), d = f.dates, cad = String((f.bt || f.manualDates || {}).cadence || '4'), s = st.settings;
  const cadLine = cad === '4' ? 'Orders will continue every 4 weeks thereafter, on the same day of the week, for consistency and ease of planning.' : `Enteral orders will continue ${cad === '1' ? 'every week' : 'every other week'} thereafter, on the same day of the week. Ostomy, tracheostomy and urological orders will continue every 4 weeks.`;
  return `<p>Hello,</p>
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
// the Chicago handoff email as sent before Oct 26 2026 (1 email: stop supplying + the facility notice to forward). Only for corrections
// on facilities that got it.
function email1BodyOld(f) {
  const g = FG(f), [areas, orders] = areasPhrase(g), r = repLine(f);
  return `<p>Hi ${esc(chiGreet(f))},</p>
<p>We will be transitioning <b>${esc(facName(f))}</b> from the <b>${esc(f.group)}</b> group over to Lakewood for <b>${areas}</b>. Please send the below to the facility contacts (admin, DON, central supply, etc.) to inform them of this transition. Please include <b>${esc(r.name)}</b> and myself on the email to the facility, and CC <b>${esc(CFG.mailbox)}</b> so our system knows it went out.</p>
<p>Please don't send any additional <b>${orders}</b> orders, as Lakewood is now taking responsibility for the orders for this facility. Any order requests that come in for this facility should be forwarded to <b>${esc(r.name)}</b>.</p>
<p>The subject of the email to the facility should be: <b>${esc(facName(f))} - Transfer from GNS Chicago to Lakewood</b>.</p>
${inserviceAsk(f)}<p>Thank you!<br>${esc(nameOf(amOf(f)))}</p>
<hr>
${facilityNotice(f)}`;
}
// Since Oct 26 2026 the handoff is 2 emails (f.e1Split):
// 1. Chicago handoff email (E14): Settings "Chicago handoff email" list + the Gentell WC Transition Lead. Only the new date and "stop supplying".
// 2. Email to the Gentell WC Transition Lead (E14b): they send the facility notice to the facility. Goes out once there is a Gentell WC Transition Lead.
function email1Body(f) {
  const g = FG(f), [areas, orders] = areasPhrase(g), r = repLine(f), d = f.dates;
  return `<p>Hi ${esc(chiGreet(f))},</p>
<p>We will be transitioning <b>${esc(facName(f))}</b> from the <b>${esc(f.group)}</b> group over to Lakewood for <b>${areas}</b>. Lakewood's first order for this facility is scheduled to be placed on <b>${fmtS(d.dos)}</b> for <b>${fmtS(d.del)}</b> delivery.</p>
<p>Please don't send any additional <b>${orders}</b> orders, as Lakewood is now taking responsibility for the orders for this facility. Any order requests that come in for this facility should be forwarded to <b>${esc(r.name)}</b>.</p>
<p>Thank you!<br>${esc(nameOf(amOf(f)))}</p>`;
}
const ctlSubject = f => bothNames(f) + '- Facility email needed: Transfer from GNS Chicago to Lakewood';
function ctlEmailBody(f, withIns) {
  const g = FG(f), [areas] = areasPhrase(g), r = repLine(f), c = ctlOf(f);
  return `<p>Hi ${esc(first(c.name))},</p>
<p>We're transitioning <b>${esc(facName(f))}</b>${f.group ? ' from the <b>' + esc(f.group) + '</b> group' : ''} over to Lakewood for <b>${areas}</b>. Can you please send the email below to the facility contacts (admin, DON, central supply, etc.) to let them know about the transition? Please include <b>${esc(r.name)}</b> and me on it, and CC <b>${esc(CFG.mailbox)}</b> so our system knows it went out.</p>
<p>The subject of the email to the facility should be: <b>${esc(facName(f))} - Transfer from GNS Chicago to Lakewood</b>.</p>
${withIns ? inserviceAsk(f) : ''}<p>Thank you!<br>${esc(nameOf(amOf(f)))}</p>
<hr>
${facilityNotice(f)}`;
}
// the in-service ask on the email to the Gentell WC Transition Lead, addressed to the wound rep + regional (only when they haven't been asked yet)
const woundRegEmails = f => [f.wound && f.wound.email, f.regional && f.regional.email].filter(Boolean);
function inserviceAsk(f) {
  if (!woundRegEmails(f).length) return '';
  const d = f.dates;
  return `<p><b>${esc(e3Names(f).join(' and '))}:</b> please speak to the facility and get them to sign up for an in-service${d ? ' before their first Lakewood order on <b>' + fmtS(d.dos) + '</b>' : ''}, so they know the updated ordering process and how to get supplies in between monthly orders. We typically want the admin, DON and central supply on the call; anyone else involved in ordering is welcome too. The booking link is in the facility email below.</p>`;
}
// the wound rep + regional were already asked to get the facility to book an in-service (or the facility predates asking that way)
// Asked on: the in-service & contacts request (f.e3Ins), the in-service email (f.inserviceMail), the email to the Gentell WC Transition Lead
// (f.inserviceAsked), the old combined contacts email (no e3v2), or the old 1-email handoff (email1 without e1Split).
const inserviceDone = f => !!(f.inserviceAsked || f.inserviceMail || f.e3Ins || (f.email3 && !f.e3v2) || (f.email1 && !f.e1Split));
// the in-service ask on its own: for facilities that get no contacts request (contacts didn't need reviewing / already received),
// and older facilities whose handoff went out before FastCare (f.e1NoWound)
function sendInservice(f) {
  f.inserviceMail = st.today;
  const d = f.dates, am = amOf(f);
  mail({ key: 'm:E27:' + f.id, code: 'E27', to: woundRegEmails(f), cc: [ctlEmail(f), f.rep, acctOf(f), am], fac: f.id, noTag: true, link: 'none', subject: facName(f) + '- In-service needed: Transfer from GNS Chicago to Lakewood',
    body: `${e3Hi(f)}<p>I hope all is well!</p><p>We're working on switching <b>${esc(facName(f))}</b>${f.group ? ' from the <b>' + esc(f.group) + '</b> group' : ''} over to GNS Lakewood${d && f.email1 ? ', and their first Lakewood order is scheduled for <b>' + fmtS(d.dos) + '</b> for <b>' + fmtS(d.del) + '</b> delivery' : ''}.</p><p>Could you please reach out to the facility, let them know we're transitioning them, and have them sign up for an in-service${d && f.email1 ? ' before then' : ''}? The in-service walks them through the updated ordering process and how to get supplies in between monthly orders. We typically want the admin, DON and central supply on the call; anyone else involved in ordering is welcome too.${st.settings.inserviceUrl ? ' Here is the link for them to book it: <a href="' + esc(st.settings.inserviceUrl) + '">Schedule an In-Service Call with GNS Lakewood</a>.' : ''}</p><p>Thank you!<br>${esc(nameOf(am))}</p>` });
}
function sendEmail1(f, correction) {
  const am = amOf(f), s = st.settings, subj = bothNames(f) + '- Transfer from GNS Chicago to Lakewood';
  const key = 'm:' + (correction ? 'E22' : 'E14') + ':' + f.id + (correction ? ':' + uid() : ''), code = correction ? 'E22' : 'E14';
  // handed off the old way (1 combined email): a correction is the same combined email
  if (correction && !f.e1Split) { mail({ key, code, to: [...s.e1To, f.rep, ...woundRegEmails(f)], cc: [...s.e1Cc, am, acctOf(f)], fac: f.id, noTag: true, link: 'none', subject: 'CORRECTION: ' + subj, body: '<p><b>Corrected dates below.</b></p>' + email1BodyOld(f) }); return; }
  mail({ key, code, to: [...s.e1To, f.rep, ctlEmail(f)], cc: [...s.e1Cc, am, acctOf(f)], fac: f.id, noTag: true, link: 'none', subject: (correction ? 'CORRECTION: ' : '') + subj, body: (correction ? '<p><b>Corrected dates below.</b></p>' : '') + email1Body(f) });
  if (correction) { if (f.e1b) sendCtlEmail(f, true); return; }
  f.email1 = st.today; f.e1Split = true;
  // the email to the Gentell WC Transition Lead goes out from run() as soon as there is one (right away when there already is)
}
// the email to the Gentell WC Transition Lead: please send the facility notice. The wound rep + regional are on it too.
function sendCtlEmail(f, correction) {
  const am = amOf(f), s = st.settings, c = ctlOf(f); if (!c) return;
  const withIns = !correction && !inserviceDone(f) && woundRegEmails(f).length > 0;
  mail({ key: 'm:' + (correction ? 'E22b' : 'E14b') + ':' + f.id + (correction ? ':' + uid() : ''), code: correction ? 'E22' : 'E14', to: [c.email, f.regional && f.regional.email, f.wound && f.wound.email, ...(s.e1bTo || [])], cc: [...(s.e1bCc || []), am, f.rep, acctOf(f)], fac: f.id, noTag: true, link: 'none',
    subject: (correction ? 'CORRECTION: ' : '') + ctlSubject(f), body: (correction ? '<p><b>Corrected dates below.</b> If you already sent the facility email, please send them this corrected one.</p>' : '') + ctlEmailBody(f, withIns) });
  if (correction) return;
  f.e1b = st.today; f.e1bCtl = lc(c.email);
  if (withIns) f.inserviceAsked = st.today;
  mail({ key: 'm:E15:' + f.id, code: 'E15', to: [c.email], cc: [am], fac: f.id, noTag: true, link: 'none', day: addBiz(st.today, 3), cond: { fac: f.id, untilEmail2: true }, subject: 'RE: ' + ctlSubject(f), body: `<p>Hi ${esc(first(c.name))},</p><p>Checking in, has the facility email for <b>${esc(facName(f))}</b> gone out? Please CC ${esc(CFG.mailbox)} on it.</p><p>Thank you!<br>${esc(nameOf(am))}</p>` });
  newTask('CHICAGO_FOLLOW', { fac: f.id, assignee: am, amTask: true, opensOn: addBiz(st.today, 5) });
}
// who to reach out to when the facility email hasn't gone out: the Gentell WC Transition Lead (since Oct 26 2026), else the handoff greeting
const facEmailWho = f => f.e1Split && ctlOf(f) ? ctlOf(f).name : chiGreet(f);
// Email 3 = the contacts request to the wound rep and regional, sent as soon as the FastCare task is done. When anyone replies
// (to the mailbox), the follow-ups stop and the transition lead gets a "Contacts reply" task to put in what they sent.
// No reply: follow-ups at +3 and +6 business days, then the transition lead is told.
// Oct 16 2026: it only asked for contacts (f.e3v2); the in-service ask was on the Chicago handoff email.
// Oct 26 2026: the in-service ask is back on it (f.e3Ins), unless they were already asked (inserviceDone). It waits for the Chicago
// transition lead, who is CC'd. Facilities that got the older combined email (no e3v2) keep its wording and subject on their follow-ups.
// The "contacts needed" subject keeps replies to the handoff emails (same "Transfer from GNS Chicago" subject) from counting as contacts replies.
const E3_SUBJECT = f => facName(f) + (f.e3Ins ? '- In-service and contacts needed: Transfer from GNS Chicago to Lakewood' : f.e3v2 ? '- Contacts needed: Transfer from GNS Chicago to Lakewood' : '- Transfer from GNS Chicago to Lakewood');
const e3Names = f => [...new Set([f.wound && f.wound.name, f.regional && f.regional.name].filter(Boolean).map(n => String(n).split(' ')[0]))];
const e3Hi = f => '<p>Hi ' + esc(e3Names(f).join(' and ')) + ',</p>';
// contacts part of the contacts request: the screenshot from the FastCare task and/or the contacts typed into the app
// (request, facility page, corporate). Nothing at all → ask for them instead of asking them to review.
const e3List = f => { const seen = new Set(); return [...(f.contacts || []), ...((f.group && G(f).contacts) || [])].filter(c => { const k = lc(c.email || (c.first + ' ' + c.last)); if (!k.trim() || seen.has(k)) return false; seen.add(k); return true; }); };
// up to 2 screenshots from the FastCare task: facility contacts and corporate contacts
const e3Shots = f => [['Facility contacts', f.contactsShot], ['Corporate contacts', f.corpShot]].filter(([, s]) => s && s.name);
function contactsTableHtml(list) {
  return `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>First Name</th><th>Last Name</th><th>Department</th><th>Email</th></tr>${list.map(c => `<tr><td>${esc(c.first)}</td><td>${esc(c.last)}</td><td>${esc(c.dept === 'Other' && c.note ? c.note : c.dept)}</td><td>${esc(c.email)}</td></tr>`).join('')}</table>`;
}
function e3Contacts(f) {
  const shots = e3Shots(f), list = e3List(f);
  const ask = 'Can you please review and advise if there are any discrepancies with the names or email addresses of these contacts?';
  if (!shots.length && !list.length) return '<p>We don\'t have any facility contacts on file yet. Can you please also send us the names and email addresses of the administrator, DON, central supply and anyone else involved in ordering?</p>';
  const imgs = shots.map(([label, s]) => `<p><b>${label} (from FastCare):</b></p><p><img src="cid:${esc(s.name)}" alt="${label} on file for ${esc(facName(f))}" width="450" style="width:450px;max-width:100%;height:auto;border:1px solid #cccccc"></p>`).join('');
  return `<p>The following are the contacts we have on file. ${ask}</p>${imgs}${list.length ? (shots.length ? '<p><b>And these, which we got separately:</b></p>' : '') + contactsTableHtml(list) : ''}`;
}
const e3Attach = f => { const [a, b] = e3Shots(f).map(x => x[1]); return Object.assign({}, a ? { attachPath: a.path, attachName: a.name } : {}, b ? { attachPath2: b.path, attachName2: b.name } : {}); };
function email3Body(f) {
  if (!f.e3v2) return email3BodyOld(f);
  const g = FG(f), am = amOf(f), areas = covKnown(g) ? areasPhrase(g)[0] : '';
  return `${e3Hi(f)}
<p>I hope all is well!</p>
<p>I would like to update you that we are working on transitioning <b>${esc(facName(f))}</b>${f.group ? ' from the <b>' + esc(f.group) + '</b> group' : ''} to the Lakewood branch${areas ? ' for <b>' + areas + '</b>' : ''}.${f.e3Ins ? '' : ' Can you assist us with obtaining the following contact information?'}</p>
${f.e3Ins ? `<p>Could you please reach out to the facility, let them know we're transitioning them, and have them sign up for an in-service? The in-service walks them through the updated ordering process and how to get supplies in between monthly orders. We typically want the admin, DON and central supply on the call, and anyone else in the facility involved in ordering and documentation is welcome to join too.${st.settings.inserviceUrl ? ' Here is the link for them to book it: <a href="' + esc(st.settings.inserviceUrl) + '">Schedule an In-Service Call with GNS Lakewood</a>.' : ''}</p>
<p>In addition, can you assist us with obtaining the following contact information?</p>` : ''}
<ul><li>Name and email of the speech therapist or director of rehab</li><li>Name and email of the dietician</li></ul>
${e3Contacts(f)}
<p>Thank you for your help!<br>${esc(nameOf(am))}</p>`;
}
// the combined in-service + contacts email, as sent before Oct 16 2026 (only for follow-ups on facilities that got it)
function email3BodyOld(f) {
  const g = FG(f), d = f.dates, am = amOf(f), areas = covKnown(g) ? areasPhrase(g)[0] : '';
  return `${e3Hi(f)}
<p>I hope all is well!</p>
<p>I would like to update you that <b>${esc(facName(f))}</b> from the <b>${esc(f.group)}</b> group is transitioning to the Lakewood branch${areas ? ' for <b>' + areas + '</b>' : ''}${d ? ', and is scheduled to have their first order with Lakewood placed on <b>' + fmtS(d.dos) + '</b> for <b>' + fmtS(d.del) + '</b> delivery' : ''}. It would be very helpful for us and the facility if the facility can schedule an in-service prior to their first scheduled order, so they can be aware of the updated ordering process and how to obtain supplies in between monthly orders if needed. Would you be able to be in touch with the facility to ensure they book an in-service? We typically want the admin, DON and central supply on the in-service call, so they can all be on the same page. Anyone else in the facility that is usually involved in the ordering and documentation is welcome to join as well.${st.settings.inserviceUrl ? ' Here is the link for them to book it: <a href="' + esc(st.settings.inserviceUrl) + '">Schedule an In-Service Call with GNS Lakewood</a>.' : ''}</p>
<p>In addition, can you assist us with obtaining the following contact information?</p>
<ul><li>Name and email of a medical provider that can sign forms via our e-sign platform, PandaDoc, so we can bill patients supplies to insurance (this can be a medical director, NP or PA).</li><li>Name and email of the speech therapist or director of rehab</li><li>Name and email of the dietician</li></ul>
${e3Contacts(f)}
<p>Thank you for your help!<br>${esc(nameOf(am))}</p>`;
}
function sendEmail3(f) {
  if (!inserviceDone(f)) f.e3Ins = true; // set before the subject and body are built
  f.email3 = st.today; f.e3v2 = true;
  mail({ key: 'm:E16:' + f.id, code: 'E16', to: [f.wound && f.wound.email, f.regional && f.regional.email], cc: [ctlEmail(f), f.rep, acctOf(f), roleEmail('rules'), amOf(f)], fac: f.id, noTag: true, link: 'none', subject: E3_SUBJECT(f), body: email3Body(f), ...e3Attach(f) });
}
// One step at a time: only the next follow-up is ever queued, and it's cancelled the moment "Done" comes in.
function chaseEmail3(f) {
  if (!f.email3 || f.e3Done || f.e3Reply) return;
  const round = f.e3Round || 0, pre = 'm:E3F:' + f.id + ':' + (round ? 'r' + round + ':' : '');
  const roundOf = k => +((k.match(/^m:E3F:\d+:r(\d+):/) || [])[1] || 0);
  const mine = st.mails.filter(m => m.fac === f.id && m.key.startsWith('m:E3F:') && roundOf(m.key) === round);
  if (mine.some(m => m.status === 'Queued')) return;
  const used = mine.filter(m => m.status !== 'Cancelled');
  const step = used.length + 1; if (step > 3) return;
  const last = used.map(m => m.day).sort().pop() || (round ? f.e3RoundFrom : f.email3);
  const day = addBiz(last, 3), key = pre + step + ':' + mine.length, am = amOf(f), cond = { fac: f.id, e3Round: round };
  if (step < 3) mail({ key, code: 'E16F', day, cond, ...e3Attach(f), to: [f.wound && f.wound.email, f.regional && f.regional.email], cc: [ctlEmail(f), am], fac: f.id, noTag: true, link: 'none', subject: 'RE: ' + E3_SUBJECT(f),
      body: `${e3Hi(f)}<p>${step === 1 ? 'Just following up on my email below' : 'Following up again on my email below'} about <b>${esc(facName(f))}</b>. Can you please ${f.e3v2 && !f.e3Ins ? '' : 'get the in-service booked and '}send over the contact info?</p><p>Thank you!<br>${esc(nameOf(am))}</p><hr>${email3Body(f)}` });
  else mail({ key, code: 'E16A', day, cond, to: [am], fac: f.id, link: 'fac', subject: 'No reply to the contacts request: ' + facName(f),
      body: `<p>${esc(e3Names(f).join(' and ') || 'The wound rep and regional')} didn't reply to the contacts request for <b>${esc(facName(f))}</b>, even after 2 follow-ups. Please reach out to them.</p>` + note('When it\'s taken care of, click "Contacts: taken care of" on the facility page. The facility can\'t be marked complete until then.') });
}
// request said some steps are already done: set what those steps would have set, so their tasks never get made
function applyPre(f, pre, l, info) {
  if (!Object.keys(pre).length) return;
  const p = Object.assign({}, pre), i = info || {}; Object.keys(PRE_IMPLY).forEach(k => { if (p[k]) PRE_IMPLY[k].forEach(x => p[x] = true); }); p.v2 = true;
  f.pre = p;
  const by = 'Done before the request';
  if (p.added) { f.inPortal = true; f.portalName = i.pn || l.name; f.addedBefore = true; }
  if (p.pumps) f.pumps = 'already done';
  if (p.gdd) { f.gdd = i.gdd || 'Already done'; f.gddWh = i.gdd === 'Yes' ? i.gddWh || '' : ''; } // a "Yes" emails the GDD contact once the request is saved (run)
  if (p.wr) { f.wound = i.wound; f.regional = i.regional; }
  if (p.e3) { f.noE3 = true; markE3Done(f, by); if (!p.ct) f.ctNeed = true; }
  if (p.es) markEsignGot(f, by);
  if (p.esp) markEsignDone(f, by);
  if (p.sched) setManualDates(f, i, by);
  if (p.e1) { f.email1 = st.today; f.email1By = by; }
  if (p.e2) { f.email2 = st.today; f.email2By = by; }
}
function setManualDates(f, i, byName) {
  f.manualDates = { ord: i.ord, dos: i.dos, del: i.del, cadence: CAD_V[i.cad] || i.cad || '4', by: byName, on: st.today };
  f.dates = manualDatesObj(f); f.rec = null;
}
function markE3Done(f, by, day) { if (f.e3Done) return; f.e3Done = day || st.today; f.e3DoneBy = by; }
// someone replied to Email 3: stop the follow-ups, AM puts in what they sent
const e3Who = (f, from) => { const x = [f.wound, f.regional].find(p => p && lc(p.email) === lc(from)); return x ? x.name : (nameOf(from) || from); };
function gotE3Reply(f, m) {
  f.e3Reply = { from: m.from, at: (m.received || '').slice(0, 10) || st.today, inbox: m._id || '' };
  const t = newTask('E3_REPLY', { fac: f.id, assignee: amOf(f), amTask: true, reply: f.e3Reply });
  todo(t, 'reply to the contacts request for ' + facName(f), esc(e3Who(f, m.from)) + ' replied to the contacts request for <b>' + esc(facName(f)) + '</b>. Put in the info they sent.');
}
// ---------- provider + eSign info (Oct 28 2026) ----------
// 1 email per facility to Anthony Price (Settings "Provider and eSign info"), CC the transition lead, the moment the request is saved
// (and once for every facility that was open on Oct 28 2026). He replies to the mailbox with the same subject: the [CT-0042] tag
// matches it to the facility. Reply in → the transition lead adds the providers to the portal: on the portal setup task if it isn't
// done yet, otherwise on its own "eSign info into portal" task. Nothing waits on it except completion.
const ES_SUBJECT = f => '[CT-' + pad(f.id) + '] ' + f.name + '- Provider and eSign info needed';
const esTo = () => (st.settings.esignTo || []).map(lc).filter(validEmail);
const esGreet = () => st.settings.esignGreet || 'Anthony';
const esPsDone = f => !!done(fTask(f, 'PORTAL_SETUP')) || preDone(f, 'ps');
const esignOk = f => !!f.esignDone;
// the facility still needs it (for the facility page and the waiting list)
const esignOpen = f => !f.esignDone && !f.deleted;
function esignBody(f, signer) {
  return `<p>Hi ${esc(esGreet())},</p>
<p>We're transitioning <b>${esc(f.name)}</b>${f.group ? ' (' + esc(f.group) + ')' : ''} from GNS Chicago to the Lakewood branch.</p>
<p>Can you please send us the provider(s) who signed the forms for this facility? For each one we need:</p>
<ul><li>Name</li><li>NPI</li><li>Email address</li><li>Whether they prefer to sign through eSign, email, or fax</li></ul>
<p>Please reply all and keep the subject as is, so your reply gets to the right place.</p>
<p>Thank you!<br>${esc(signer || nameOf(amOf(f)))}</p>`;
}
function sendEsign(f) {
  f.esignAsk = st.today;
  mail({ key: 'm:E31:' + f.id, code: 'E31', to: esTo(), cc: [amOf(f)], fac: f.id, noTag: true, link: 'none', subject: ES_SUBJECT(f), body: esignBody(f) });
}
// no reply: follow-ups at +2 and +4 business days, then (2 business days later) the transition lead is told. 1 step queued at a time.
function chaseEsign(f) {
  if (!f.esignAsk || f.esignGot || f.esignDone) return;
  const round = f.esignRound || 0, pre = 'm:E31F:' + f.id + ':' + (round ? 'r' + round + ':' : '');
  const roundOf = k => +((k.match(/^m:E31F:\d+:r(\d+):/) || [])[1] || 0);
  const mine = st.mails.filter(m => m.fac === f.id && m.key.startsWith('m:E31F:') && roundOf(m.key) === round);
  if (mine.some(m => m.status === 'Queued')) return;
  const used = mine.filter(m => m.status !== 'Cancelled');
  const step = used.length + 1; if (step > 3) return;
  const last = used.map(m => m.day).sort().pop() || (round ? f.esignRoundFrom : f.esignAsk);
  const day = addBiz(last, 2), key = pre + step + ':' + mine.length, am = amOf(f), cond = { fac: f.id, esRound: round };
  if (step < 3) mail({ key, code: 'E31F', day, cond, to: esTo(), cc: [am], fac: f.id, noTag: true, link: 'none', subject: 'RE: ' + ES_SUBJECT(f),
      body: `<p>Hi ${esc(esGreet())},</p><p>${step === 1 ? 'Just following up on my email below' : 'Following up again on my email below'} about <b>${esc(f.name)}</b>. Can you please send over the provider info?</p><p>Thank you!<br>${esc(nameOf(am))}</p><hr>${esignBody(f)}` });
  else mail({ key, code: 'E31A', day, cond, to: [am], fac: f.id, link: 'fac', subject: 'No reply about provider and eSign info: ' + facName(f),
      body: `<p>${esc(esGreet())} didn't reply about the provider and eSign info for <b>${esc(facName(f))}</b>, even after 2 follow-ups. Please reach out to ${esc(esGreet())}.</p>` + note('Once you have it, tick "Received eSign info" under "Mark steps done" on the facility page, and you\'ll get the task to add it to the portal. The facility can\'t be marked complete until the providers are in the portal.') });
}
function markEsignGot(f, by, day) { if (f.esignGot) return; f.esignGot = day || st.today; f.esignBy = by || ''; }
function markEsignDone(f, by) { if (f.esignDone) return; markEsignGot(f, by); f.esignDone = st.today; f.esignDoneBy = by || ''; }
function gotEsignReply(f, m) {
  const r = { from: m.from, at: (m.received || '').slice(0, 10) || st.today, inbox: m._id || '', preview: (m.preview || '').slice(0, 1000) };
  f.esignReplies = [...(f.esignReplies || []), r];
  markEsignGot(f, m.from, r.at);
}
// the replies to show on the task: everything since the latest round started
const esReplies = f => (f.esignReplies || []).slice(f.esignRoundIdx || 0);
// what to put in the portal, used on the portal setup task and the separate task
function esignPortalBox(f, pfx) {
  const reps = esReplies(f), m = r => (st.inbox || []).find(x => x._id && x._id === r.inbox);
  const list = reps.map(r => { const x = m(r), pv = (x && x.preview) || r.preview; return `<div class="note"><b>${esc(esTo().includes(lc(r.from)) ? esGreet() : nameOf(r.from) || r.from)}</b>, ${fmt(r.at)}${x && x.path ? ` · <a href="${esc(STORE.fileUrl(x.path))}" target="_blank" rel="noopener">Open the email</a>` : ''}${pv ? '<div>"' + esc(pv.slice(0, 600)) + '"</div>' : ''}</div>`; }).join('');
  return `<div class="instr">Add each provider as a physician contact in the portal, and in the eSign section at the bottom of the portal setup (name, NPI, email, and how they prefer to sign: eSign, email or fax).</div>${list || `<div class="meta">The eSign info was received outside the app${f.esignBy ? ' (' + esc(f.esignBy) + ')' : ''}. Add it from wherever it came in (an email, or the facility's attachments).</div>`}${fld('Where things stand', sel(pfx + 'es', [['done', 'The providers are in the portal'], ['more', 'Anthony didn\'t send everything yet: keep following up']], '', true))}`;
}
function esignAnswer(f, v, byName) {
  if (v === 'more') { f.esignRoundIdx = (f.esignReplies || []).length; f.esignGot = ''; f.esignBy = ''; f.esignRound = (f.esignRound || 0) + 1; f.esignRoundFrom = st.today; if (!f.esignAsk) f.esignAsk = st.today; }
  else markEsignDone(f, byName);
}
function addAmy(f) {
  const g = G(f), t = newTask('PORTAL_ADD', { fac: f.id, assignee: roleEmail('portal') });
  mail({ key: 'm:E8:' + t.key, code: 'E8', to: [t.assignee], cc: [amOf(f)], fac: f.id, task: t.key, cond: { task: t.key }, subject: 'Add ' + f.name + ' to Brightree',
    body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>Please add <b>${esc(f.name)}</b> to Brightree.</p>` });
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
    if (f.portalSnap) f.portalSnap.vendor = f.gddWh || ''; // the GDD warehouse task covers "Main Vendor", so no "Update the portal" task for it
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
// ---------- rep rule ----------
// A corporate's rep rule can fill only some positions (Oct 2026). g.ruleIndiv lists the positions left blank in the rule:
// those get picked per facility on the "Pick the reps" task. Corporates whose rule was saved before then have no ruleIndiv
// and work exactly as before (blank account manager = none; the rule only applies when it has an intake rep).
const RULE_POS = [['rep', 'intake rep'], ['clin', 'clinical rep'], ['acct', 'account manager'], ['am', 'transition lead']];
const posName = p => p === 'ctl' ? 'Gentell WC Transition Lead' : (RULE_POS.find(x => x[0] === p) || [, p])[1];
const partialRule = g => !!(g && Array.isArray(g.ruleIndiv));
// The Gentell WC Transition Lead is needed while something still waits on them: the handoff, the email to them, the in-service &
// contacts request (it waits for them so they're CC'd) or the in-service email. Not part of a corporate's rule: always picked per facility.
const e3Pending = f => !f.email3 && !f.noE3 && !preDone(f, 'e3');
function ctlNeeded(f) {
  if (!f || ctlOf(f) || f.complete || f.deleted) return false;
  return !f.email1 || (f.e1Split && !f.e1b && !f.email2) || e3Pending(f) || !inserviceDone(f);
}
// what this facility still needs picked by hand. The intake rep always; the rule's blank positions until the Chicago handoff email;
// the Gentell WC Transition Lead (ctlNeeded).
function ruleNeeds(f) {
  const g = f.group ? G(f) : null, n = [];
  if (!f.rep && !autoPending(f)) n.push('rep'); // David's facilities: the intake rep is picked at scheduling
  if (ctlNeeded(f)) n.push('ctl');
  if (partialRule(g) && !f.email1 && !f.complete) {
    if (g.ruleIndiv.includes('clin') && !f.clin) n.push('clin');
    if (g.ruleIndiv.includes('acct') && !f.acct) n.push('acct');
    if (g.ruleIndiv.includes('am') && !f.am) n.push('am');
  }
  return n;
}
// fills a facility's empty positions from the corporate's rule (never overwrites what a facility already has)
// sets the Gentell WC Transition Lead. Changed after their email went out (and the facility email hasn't): the transition lead is told to forward it.
function setCtl(f, c, byName) {
  if (!c || !validEmail(c.email)) return;
  if (ctlOf(f) && lc(c.email) !== ctlEmail(f) && f.e1b && !f.email2) mail({ key: 'm:E13:ctl:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, link: 'fac', subject: 'Gentell WC Transition Lead changed: ' + facName(f), body: '<p>' + esc(byName) + ' changed the Gentell WC Transition Lead from ' + esc(f.ctl.name) + ' to ' + esc(c.name) + '. The email asking them to send the facility the transfer email went to ' + esc(f.ctl.name) + ' on ' + fmt(f.e1b) + '. Forward it to ' + esc(c.name) + ' if they need it.</p>' });
  f.ctl = { name: c.name, email: lc(c.email) };
}
function applyRule(f, g) {
  // Gentell WC Transition Lead from the corporate (g.ctl, Oct 27 2026): fills a facility that has none, never overwrites
  if (g && g.ctl && !ctlOf(f) && !f.complete) f.ctl = { name: g.ctl.name, email: lc(g.ctl.email) };
  if (autoPending(f)) { if (!f.am && g.am) f.am = g.am; if (!f.clin && g.clin && !g.clinSame) f.clin = g.clin; return; } // intake rep waits for scheduling
  if (!partialRule(g)) { if (!f.rep && g.rep) { f.rep = g.rep; f.clin = g.clin || g.rep; if (!f.am && g.am) f.am = g.am; } return; } // older rules: unchanged
  if (!f.rep && g.rep) f.rep = g.rep;
  if (!f.clin && f.rep && (g.clin || g.clinSame)) f.clin = g.clinSame ? f.rep : g.clin;
  if (!f.am && g.am) f.am = g.am;
}
// saves the rule from a form: blank = picked per facility; clin '__same' = same as each facility's intake rep
function setRule(g, v) {
  g.rep = v.rep || ''; g.acct = v.acct || ''; g.am = v.am || '';
  g.clinSame = v.clin === '__same'; g.clin = g.clinSame ? g.rep : (v.clin || '');
  g.ruleIndiv = RULE_POS.map(x => x[0]).filter(p => p === 'clin' ? !v.clin : !v[p]);
}
const ruleText = g => { if (!g.rep && !g.clin && !g.clinSame && !g.acct && !g.am) return g.ctl ? 'Gentell WC Transition Lead: ' + g.ctl.name : ''; return RULE_POS.map(([p, l]) => { const v = p === 'clin' && g.clinSame ? 'same as intake' : g[p] ? nameOf(g[p]) : (partialRule(g) ? 'per facility' : (p === 'acct' ? 'none' : '-')); return l + ': ' + v; }).join(' · ') + (g.ctl ? ' · Gentell WC Transition Lead: ' + g.ctl.name : ''); };
function ruleFacs(t) { return st.facs.filter(f => !f.hold && !f.archived && (t.group === '__nocorp' ? !f.group && ruleNeeds(f).length : lc(f.group) === lc(t.group) && ruleNeeds(f).length)); }

// ---------- intake rep picked automatically at scheduling (David's team, Oct 20 2026) ----------
// Settings "autoRep": { acct: the account manager's email, reps: [emails, in the order they get picked] }.
// A facility whose account manager is that person gets no intake rep until it's scheduled. Then the rep with the fewest
// facilities ordering that day gets it: 0 or 1 first (first in the list wins a tie), else 2. Everyone at 3+ → the next business day.
// Facilities already scheduled (or with the Chicago handoff email sent) keep the rep they have and count toward that rep's day.
const AUTO_REP_FULL = 3; // facilities ordering the same day before a rep counts as full
const autoCfg = () => (st && st.settings && st.settings.autoRep) || null;
const autoReps = () => { const c = autoCfg(); return c ? (c.reps || []).map(lc).filter(e => validEmail(e) && person(e)) : []; };
const autoAcct = () => { const c = autoCfg(); return c && validEmail(c.acct) && autoReps().length ? lc(c.acct) : ''; };
const isAutoAcct = email => !!autoAcct() && lc(email) === autoAcct();
// scheduled = its dates won't move anymore (handoff email sent and scheduled, or dates typed in as already scheduled)
const isScheduled = f => !!((f.email1 && !handoffOnly(f)) || f.manualDates);
// the intake rep waits for scheduling: account manager is David, not scheduled, no handoff email yet
const autoPending = f => !!f && !f.deleted && !f.complete && !f.email1 && !f.manualDates && isAutoAcct(acctOf(f));
// facilities each rep has ordering on that day (scheduled ones only). except = a facility id to leave out (the one being scheduled)
function repLoad(ord, except) {
  const n = {};
  st.facs.forEach(f => { if (f.deleted || f.id === except || !f.rep || !f.dates || f.dates.ord !== ord || !isScheduled(f)) return; n[lc(f.rep)] = (n[lc(f.rep)] || 0) + 1; });
  // new facility scheduling (Oct 22 2026) counts toward the same day: both kinds share the team's capacity
  (st.nfs || []).forEach(x => { if (x.deleted || x.id === except || !x.rep || !x.dates || x.dates.ord !== ord || !x.scheduled) return; n[lc(x.rep)] = (n[lc(x.rep)] || 0) + 1; });
  return n;
}
// the rep the rules pick for that ordering day, or '' when everyone on the team already has 3 or more
function autoPick(ord, except) {
  const n = repLoad(ord, except), team = autoReps(), c = e => n[e] || 0;
  return team.find(e => c(e) <= 1) || team.find(e => c(e) === 2) || '';
}
// David's facilities only: the first ordering day (from the recommended DOS on) where someone on the team has room
function autoDos(f, dos, back) {
  let d = dos, k = 0;
  while (!autoPick(addBiz(d, -back), f.id) && k < 60) { d = addBiz(d, 1); k++; }
  return d;
}
// warnings for the intake rep + ordering date picked on the schedule task
function autoRepWarn(f, rep, ord) {
  const w = [], n = repLoad(ord, f.id), c = e => n[lc(e)] || 0, team = autoReps();
  if (!rep) return w;
  if (c(rep) >= AUTO_REP_FULL) w.push('There ' + (c(rep) === 1 ? 'is' : 'are') + ' already ' + c(rep) + ' facilit' + (c(rep) === 1 ? 'y' : 'ies') + ' assigned to ' + nameOf(rep) + ' ordering on ' + fmt(ord) + '.');
  if (team.length && !team.includes(lc(rep))) w.push(nameOf(rep) + ' isn\'t on ' + first(nameOf(autoAcct())) + '\'s team (Settings, "Intake reps picked at scheduling").');
  const freer = lc(rep) === autoPick(ord, f.id) ? [] : team.filter(e => e !== lc(rep) && c(e) < c(rep));
  if (freer.length) { const best = freer.reduce((a, e) => c(e) < c(a) ? e : a); w.push(nameOf(best) + ' has more time that day (' + c(best) + ' facilit' + (c(best) === 1 ? 'y' : 'ies') + ' ordering ' + fmt(ord) + ', ' + nameOf(rep) + ' has ' + c(rep) + ').'); }
  if (!autoPick(ord, f.id)) w.push('Everyone on ' + first(nameOf(autoAcct())) + '\'s team already has ' + AUTO_REP_FULL + ' or more facilities ordering on ' + fmt(ord) + '.');
  return w;
}
// keeps David's not-yet-scheduled facilities without an intake rep (the old one is kept in f.repHistory) and with David as clinical rep
function autoRepPrep(f) {
  if (!autoPending(f)) return;
  const acct = autoAcct();
  if (f.rep) {
    const was = f.rep;
    (f.repHistory = f.repHistory || []).push({ rep: was, clin: f.clin || '', on: st.today, why: 'Cleared: account manager ' + nameOf(acct) + ', intake rep picked at scheduling' });
    if (!f.clin || lc(f.clin) === lc(was)) f.clin = acct;
    f.rep = '';
  }
  if (!f.clin) f.clin = acct;
}
// gives the facility its intake rep at scheduling. rep = picked on the schedule task ('' = the rules pick). Returns the rep.
function autoAssign(f, rep, by) {
  const ord = f.dates.ord, pick = autoPick(ord, f.id), n = repLoad(ord, f.id);
  let r = lc(rep) || pick;
  // nobody has room that day (dates typed in as already scheduled): the least busy, first in the list on a tie
  if (!r) r = autoReps().reduce((a, e) => (n[e] || 0) < (n[a] || 0) ? e : a, autoReps()[0]) || '';
  if (!r) return '';
  f.rep = r;
  if (!f.clin) f.clin = autoAcct() || r;
  f.repAuto = { rep: r, pick, ord, load: n[r] || 0, by: by || '', on: st.today, override: !!rep && lc(rep) !== pick };
  // the schedule task says to type the intake rep (and clinical) into the portal, so it doesn't need an "Update the portal" task
  if (f.portalSnap) { const cur = portalVals(f); f.portalSnap.rep = cur.rep; f.portalSnap.clin = cur.clin; }
  return r;
}

// ---------- inbox (emails that arrived in the shared mailbox) ----------
function processInbox() {
  (st.inbox || []).forEach(m => {
    if (m.processed) return;
    m.processed = true;
    const subj = m.subject || '', ls = lc(subj), from = lc(m.from);
    const ct = subj.match(/\[CT-(\d+)\]/);
    const mb = lc(CFG.mailbox), inTo = (m.to || []).map(lc).includes(mb), inCc = (m.cc || []).map(lc).includes(mb);
    // a reply about the provider + eSign info: the [CT-…] tag (or, if it was dropped, the Chicago name) + "esign info needed",
    // from Anthony or anyone outside the team, on or after the ask
    if (from !== mb && ls.includes('esign info needed')) {
      const team = (st.settings.people || []).map(p => lc(p.email)), ok = x => x.esignAsk && !x.esignDone && !x.deleted && (m.received || '').slice(0, 10) >= x.esignAsk && (esTo().includes(from) || !team.includes(from));
      const byTag = ct && facById(+ct[1]), cands = byTag ? [byTag] : st.facs.filter(x => !x.archived && facNames(x).some(n => ls.includes(n)));
      const f = cands.length === 1 && ok(cands[0]) ? cands[0] : null;
      if (f) { gotEsignReply(f, m); m.fac = f.id; m.isEsign = true; return; }
    }
    if (ct && facById(+ct[1])) { m.fac = +ct[1]; return; }
    const live = st.facs.filter(f => !f.archived);
    // either name counts: the portal name or the Chicago name (also without the "(IN)"-style state in parentheses)
    const match = f => facNames(f).some(n => ls.includes(n));
    // a reply to Email 3 (or a follow-up): sent to the mailbox, after Email 3, not from us or GNS Chicago
    const chicago = [...(st.settings.e1To || []), ...(st.settings.e1Cc || [])].map(lc);
    if (from !== mb && inTo && !chicago.includes(from) && ls.includes('transfer from gns chicago')) {
      const team = (st.settings.people || []).map(p => lc(p.email)), them = x => [x.wound && x.wound.email, x.regional && x.regional.email].map(lc);
      const f = live.find(x => x.email3 && !x.e3Done && !x.e3Reply && match(x) && (!x.e3v2 || ls.includes('contacts needed')) && (m.received || '').slice(0, 10) >= x.email3 && (them(x).includes(from) || !team.includes(from)));
      if (f) { gotE3Reply(f, m); m.fac = f.id; m.isE3Reply = true; return; }
    }
    if (from !== mb && inCc && !inTo && ls.includes('transfer from gns chicago')) {
      const f = live.find(x => x.email1 && !x.email2 && match(x));
      if (f) { f.email2 = (m.received || '').slice(0, 10) || st.today; f.email2By = m.from + ' (seen in the mailbox)'; m.fac = f.id; m.isEmail2 = true; return; }
    }
    const f = live.find(match); if (f) m.fac = f.id;
  });
}

// ---------- the engine ----------
const TEAM_2026_10_15 = 'Amy Crawford,amy@gentell.com,339|Vicky Custodio,vicky@isgmed.com,371|Bassie Kessner,bassie@gentell.com,376|Apol Escopin,apol@gentell.com,329|Cindy Lampert,cindyl@gentell.com,319|David Alan,david@gentell.com,394|Ester Newman,ester@gentell.com,335|Esti Kaminsky,esti@gentell.com,378|Fay Raider,fay@gentell.com,356|Hannah Goldstein,hannah@gentell.com,346|Leah Rosenshein,leah@gentell.com,341|Leya Sommer,leya@gentell.com,327|Malka Heiman,malka@gentell.com,303|Naomi Cohen,naomi@gentell.com,316|Rochel Schechter,rochel@gentell.com,358|Rochelle Reifman,rochelle@gentell.com,404|Rucky Berger,rucky@gentell.com,353|Shaindy Levin,shaindy@gentell.com,336|Shalini Srinivas,shalini@gentell.com,|Shani Craven,shani@gentell.com,345|Essie Teichman,essie@gentell.com,351|Malky Cohen,malky@gentell.com,387|Raye Gorelik,raye@gentell.com,317|Chani Paretzky,chani@gentell.com,344|Simi Shain,simi@gentell.com,328|Sheva Yeret,sheva@gentell.com,367|Yehuda Jacobs,yehuda@gentell.com,324|Zevi Hofstatter,zevi@gentell.com,343|Shayna Oppen,shayna@gentell.com,405|Jay Ringle,jay@gentell.com,|Tzipora Landau,tzipora@gentell.com,314|Kaila Mandelbaum,kaila@gentell.com,355|Linda Anwaya,linda.anwaya@gentell.com,|Aliyah Price,aliyah.price@gentell.com,|Rafael Banal,rafael.banal@gentell.com,|Shaindel Housman,shaindel@gentell.com,325|Priscilla Cordero,priscilla.cordero@gentell.com,|Etti Pam,etti@gentell.com,|Sori Stein,sori@gentell.com,354|Bessie Snyder,bessie@gentell.com,369|Darlene Kusek,darlene.kusek@gentell.com,|Chaya Hirsch,chaya@gentell.com,|Martha Stern,martha@gentell.com,';
// One-time add (10/15/2026): everyone from the portal user list, as Rep / account manager.
// Skips anyone already in Settings (same email or same name). Runs once, then remembers it ran.
function importTeam20261015() {
  const s = st.settings; if (!s || (s.imported || []).includes('team-2026-10-15')) return;
  TEAM_2026_10_15.split('|').forEach(x => {
    let [name, email, ext] = x.split(',');
    if (st.demo) email = lc(name).replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@demo.gentell.com'; // demo never uses real addresses
    if (s.people.some(p => lc(p.email) === email || lc(p.name) === lc(name))) return;
    s.people.push({ name, email, rep: true, ext: ext || '' });
  });
  s.imported = [...(s.imported || []), 'team-2026-10-15'];
}

// One-time add (10/16/2026): ship points for states that were missing. Only adds a state that isn't anywhere in that table yet,
// so a ship point someone already set in Settings is never changed. Runs once, then remembers it ran.
const SHIP_2026_10_16 = { shipEnt: { 2: 'AZ DC KS MN MT WV', 3: 'HI' }, shipOst: { 3: 'AZ', 4: 'MS' } };
function importShip20261016() {
  const s = st.settings; if (!s || (s.imported || []).includes('ship-2026-10-16')) return;
  for (const tbl in SHIP_2026_10_16) {
    s[tbl] = Object.assign({}, s[tbl] || {});
    for (const n in SHIP_2026_10_16[tbl]) SHIP_2026_10_16[tbl][n].split(' ').forEach(code => {
      if (shipOf(s[tbl], code)) return;
      s[tbl][n] = ((s[tbl][n] || '') + ' ' + code).trim();
    });
  }
  s.imported = [...(s.imported || []), 'ship-2026-10-16'];
}

// One-time add (10/20/2026): David Alan's intake reps, ticked as Rep / account manager (added if missing, ticked if not),
// and the "Intake reps picked at scheduling" setting (account manager David Alan, these 5 in this order). Runs once.
const AUTO_REP_2026_10_20 = { acct: 'David Alan,david@gentell.com', reps: 'Shalini Srinivas,shalini@gentell.com|Manjunath Ranganath,manjunath@gentell.com|Kalavathi Venkatesh,kalavathi@gentell.com|Malini Dorairaj,malini@gentell.com|Swapna Rawal,swapna@gentell.com' };
// One-time (10/28/2026): provider + eSign info goes to Anthony Price. Only fills it when nobody set it yet.
function importEsign20261028() {
  const s = st.settings; if (!s || (s.imported || []).includes('esign-2026-10-28')) return;
  if (!(s.esignTo || []).length) s.esignTo = [st.demo ? 'anthony.price@demo.gentell.com' : 'anthony.price@gentell.com'];
  if (!s.esignGreet) s.esignGreet = 'Anthony';
  s.imported = [...(s.imported || []), 'esign-2026-10-28'];
}
function importAutoRep20261020() {
  const s = st.settings; if (!s || (s.imported || []).includes('autorep-2026-10-20')) return;
  const add = x => {
    let [name, email] = x.split(',');
    if (st.demo) email = lc(name).replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@demo.gentell.com'; // demo never uses real addresses
    let p = s.people.find(q => lc(q.email) === lc(email)) || s.people.find(q => lc(q.name) === lc(name));
    if (!p) { p = { name, email, rep: true, ext: '' }; s.people.push(p); }
    if (!p.rep) p.rep = true;
    if (!validEmail(p.email)) p.email = email;
    return lc(p.email);
  };
  const reps = AUTO_REP_2026_10_20.reps.split('|').map(add);
  if (!s.autoRep) s.autoRep = { acct: add(AUTO_REP_2026_10_20.acct), reps };
  s.imported = [...(s.imported || []), 'autorep-2026-10-20'];
}

function run() {
  if (!st || !st.settings) return;
  importTeam20261015();
  importShip20261016();
  importAutoRep20261020();
  importEsign20261028();
  processInbox();
  // new facility scheduling: dates and the schedule lead's task (js/newfac.js)
  if (typeof nfRun === 'function') nfRun();
  // David's facilities not scheduled yet: no intake rep until scheduling (on hold too, so it never shows a rep that isn't theirs)
  st.facs.forEach(autoRepPrep);
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
      if (!preDone(f, 'wr')) { const tf = newTask('FASTCARE', { fac: f.id, assignee: am, amTask: true, need }); todo(tf, 'FastCare for ' + facName(f), 'Look up <b>' + esc(f.name) + '</b> in FastCare.'); }
      if (!preDone(f, 'gdd')) { const tg = newTask('GDD', { fac: f.id, assignee: roleEmail('gdd') });
      queue('E10', tg.assignee, f, tg, (fs, ts) => fs.length === 1
        ? { code: 'E10', to: [ts[0].assignee], fac: fs[0].id, task: ts[0].key, buttons: ['No'], cond: { task: ts[0].key }, subject: 'GDD orders for ' + facName(fs[0]) + '?', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>Did <b>${esc(facName(fs[0]))}</b>${chiName(fs[0]) ? ' (Chicago name: ' + esc(fs[0].name) + ')' : ''} (${esc(fs[0].group || 'corporate not known yet')}) get orders from GDD? If yes, open the task and pick the warehouse.</p>` }
        : { code: 'E10', to: [ts[0].assignee], link: 'none', subject: 'GDD orders for ' + fs.length + ' facilities?', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>Did any of these get orders from GDD? Click "No" or open the task to pick the warehouse.</p>${taskList(fs.map((x, i) => ['<b>' + esc(facName(x)) + '</b>', ts[i].key]), ['No'])}` }); }
      if (preDone(f, 'gdd') && f.gdd === 'Yes' && f.gddWh) gddAnswer(f, 'Yes', f.gddWh); // marked answered on the request: same FYI as Chris answering
      if (!preDone(f, 'sched')) { const tb = newTask('BRIGHTREE', { fac: f.id, assignee: am, amTask: true }); todo(tb, 'Brightree report for ' + facName(f), 'Run the Brightree report for <b>' + esc(facName(f)) + '</b>' + (chiName(f) ? ' (Chicago name: ' + esc(f.name) + ')' : '') + '.'); }
    }

    // provider + eSign info: to Anthony right away (nothing waits on it but completion)
    if (!f.esignAsk && !f.esignGot && !f.esignDone && !preDone(f, 'es') && esTo().length) sendEsign(f);
    chaseEsign(f);
    // it came in after the portal setup was done: its own task (before that, it's on the portal setup task)
    if (f.esignGot && !f.esignDone && esPsDone(f) && !tasksOf(f, 'ESIGN_PORTAL').some(t => !done(t))) {
      const t = newTask('ESIGN_PORTAL', { fac: f.id, assignee: am, amTask: true });
      todo(t, 'add the eSign providers for ' + facName(f), 'The provider and eSign info for <b>' + esc(facName(f)) + '</b> came in. Add the providers to the portal.');
    }

    // corporate not known yet: Malka picks reps per facility; corporate asks wait for the FastCare task
    if (!f.group) {
      if (ruleNeeds(f).length && !st.tasks.some(t => t.group === '__nocorp' && t.type === 'RULE' && !done(t))) {
        const t = newTask('RULE', { group: '__nocorp', assignee: roleEmail('rules') });
        mail({ key: 'm:E3:' + t.key, code: 'E3', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Pick a rep: corporate not known yet', body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>These facilities don't have a corporate yet, so there's no corporate rule to use. Pick the reps per facility.</p><ul>${ruleFacs(t).map(x => '<li>' + esc(facName(x)) + ': ' + ruleNeeds(x).map(posName).join(', ') + '</li>').join('')}</ul>` });
      }
      return;
    }
    const g = G(f);
    // rep rule
    applyRule(f, g);
    if (ruleNeeds(f).length && !st.tasks.some(t => lc(t.group) === lc(g.name) && t.type === 'RULE' && !done(t))) {
      const t = newTask('RULE', { group: g.name, assignee: roleEmail('rules') });
      queue('E3', t.assignee, f, t, (fs, ts) => ({ code: 'E3', to: [ts[0].assignee], task: ts[0].key, cond: { task: ts[0].key }, subject: 'Pick a rep: ' + g.name, body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p>${partialRule(g) && (g.rep || g.clin || g.clinSame || g.acct || g.am) ? `<p>These facilities from <b>${esc(g.name)}</b> need reps the corporate rule leaves to each facility:</p><ul>${facsOfGroup(g.name).filter(x => ruleNeeds(x).length).map(x => '<li>' + esc(facName(x)) + ': ' + ruleNeeds(x).map(posName).join(', ') + '</li>').join('')}</ul><p>Pick them in the task. The rule fills the rest.</p>` : facsOfGroup(g.name).filter(x => ruleNeeds(x).length).every(x => ruleNeeds(x).every(p => p === 'ctl')) ? `<p>These facilities from <b>${esc(g.name)}</b> need a Gentell WC Transition Lead (the Gentell person who sends the transfer email to the facility):</p><ul>${facsOfGroup(g.name).filter(x => ruleNeeds(x).length).map(x => '<li>' + esc(facName(x)) + '</li>').join('')}</ul><p>Pick them in the task.</p>` : `<p>These facilities from <b>${esc(g.name)}</b> have no rep and the corporate has no rep rule:</p><ul>${facsOfGroup(g.name).filter(x => ruleNeeds(x).length).map(x => '<li>' + esc(facName(x)) + '</li>').join('')}</ul><p>Pick the intake rep, clinical rep, account manager, transition lead and Gentell WC Transition Lead. Tick "Save as the corporate rule" so future facilities under this corporate get the reps automatically (the Gentell WC Transition Lead is always picked per facility). Leave a position blank in the top row to keep picking it per facility.</p>`}` }));
    }
    // corporate asks, once per corporate
    if (!groupsSeen[lc(g.name)]) {
      groupsSeen[lc(g.name)] = 1;
      if (!covKnown(g) && !gTask(g.name, 'AREAS')) {
        const t = newTask('AREAS', { group: g.name, assignee: f.requester || fallbackOwner() });
        mail({ key: 'm:E4:' + t.key, code: 'E4', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Areas of care for ' + g.name, body: `<p>Which areas of care are we taking for <b>${esc(g.name)}</b>? Still needed: ${AREAS.filter(x => !(g.cov || {})[x]).join(', ')}. Pick 1 per area in the task.</p>` });
      }
      // price table: wait for the areas of care. Only covered / don't supply (wound care doesn't count) → the Tier 2 default, no task.
      if (!g.existing && covKnown(g)) {
        const tier2 = isTier2(g), open = st.tasks.find(t => t.type === 'PRICE' && lc(t.group) === lc(g.name) && !done(t));
        if (g.priceAuto && !tier2) { g.price = ''; g.priceAuto = false; }                       // areas changed: not Tier 2 any more
        if (!g.price && tier2) { g.price = st.settings.tier2Price || '2022 Tier 2'; g.priceAuto = true; }
        if (open && g.price) { open.status = 'Not needed'; open.doneOn = st.today; }
        if (!g.price && !open) {
          const t = newTask('PRICE', { group: g.name, assignee: roleEmail('price') });
          mail({ key: 'm:E5:' + t.key, code: 'E5', to: [t.assignee], task: t.key, cond: { task: t.key }, subject: 'Price table for ' + g.name, body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>Which price table does <b>${esc(g.name)}</b> go on?</p>${areasTableHtml(g)}<p>Facilities: ${facsOfGroup(g.name).map(x => esc(facName(x))).join(', ')}.</p>` });
        }
      }
      const gf = facsOfGroup(g.name).filter(x => !x.hold);
      if (!g.emr && !g.existing && !gTask(g.name, 'EMR') && gf.length && gf.every(x => x.inPortal)) {
        const t = newTask('EMR', { group: g.name, assignee: roleEmail('emr') });
        mail({ key: 'm:E7:' + t.key, code: 'E7', to: [t.assignee], cc: [am], task: t.key, cond: { task: t.key }, subject: 'EMR access: ' + g.name, body: `<p>Hi ${esc(first(nameOf(t.assignee)))},</p><p>We need EMR access for <b>${esc(g.name)}</b>. These are in the portal: ${gf.map(x => esc(facName(x))).join(', ')}.</p><p>Please enter "Emr", "Emr Username" and "Emr Password" on each one and save the QR code on the server in the "Authenticator" folder, named the username. Then mark the task done.</p>` });
      }
    }
    // dates (frozen once Email 1 went out)
    // no usable state (address missing or no ship point for it): no dates, so nothing can be scheduled with a wrong delivery date
    // already scheduled (dates typed in): those dates, nothing recalculates
    if (f.manualDates) { if (!f.email1) { f.dates = manualDatesObj(f); f.rec = null; } }
    else { const d = calcDates(f); if (datesOpen(f)) { f.rec = d || null; f.dates = !d ? null : f.dosChosen ? Object.assign(derive(f, f.dosChosen), { why: [...d.why, 'Changed by ' + (f.dosBy || 'someone') + ' from the recommended ' + fmtS(d.dos)], changed: true }) : d; } }
    if (stateOK(f)) tasksOf(f, 'ADDRESS').forEach(t => { if (!done(t)) { t.status = 'Not needed'; t.doneOn = st.today; } });
    // address still missing (or its state has no ship point) once FastCare is done: the transition lead gets a task for it
    if (datesOpen(f) && !f.manualDates && !stateOK(f) && (done(fTask(f, 'FASTCARE')) || preDone(f, 'wr')) && !tasksOf(f, 'ADDRESS').some(t => !done(t))) {
      const t = newTask('ADDRESS', { fac: f.id, assignee: am, amTask: true });
      todo(t, 'address for ' + facName(f), 'We need the full address for <b>' + esc(facName(f)) + '</b> before it can be scheduled.');
    }
    // Amy adds it to Brightree once the price table is in
    if (hasPrice(g) && f.address && !fTask(f, 'PORTAL_ADD') && !f.inPortal) addAmy(f);
    // existing EMR login: ask corporate to add this facility
    const main = mainCorp(g);
    if ((g.emr || g.existing) && !g.emrNew && !fTask(f, 'EMR_ADD') && !preDone(f, 'emr')) {
      const t = newTask('EMR_ADD', { fac: f.id, assignee: am, amTask: true });
      if (main) mail({ key: 'm:E7b:' + t.key, code: 'E7b', to: [main.email], cc: [am], fac: f.id, link: 'none', subject: 'Add ' + facName(f) + ' to your EMR login', body: `<p>Hi ${esc(main.first)},</p><p>Can you add <b>${esc(facName(f))}</b> to the existing EMR login${g.emr ? ' <b>' + esc(g.emr) + '</b>' : ''}? Thank you!<br>${esc(nameOf(am))}</p>` });
    }
    if (f.inPortal && !fTask(f, 'PUMPS') && !f.pumps) {
      const tp = newTask('PUMPS', { fac: f.id, assignee: roleEmail('pumps') });
      queue('E9', tp.assignee, f, tp, (fs, ts) => fs.length === 1
        ? { code: 'E9', to: [ts[0].assignee], fac: fs[0].id, task: ts[0].key, buttons: ['Checked'], cond: { task: ts[0].key }, subject: 'Pumps: ' + facName(fs[0]), body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p><b>${esc(facName(fs[0]))}</b> (${esc(fs[0].group)}) is in the portal now. Please check if GNS Chicago sent it pumps and add any to "Pump Tracking". Click "Checked" when you're done.</p><p><b>${PUMP_RULE}</b></p>` }
        : { code: 'E9', to: [ts[0].assignee], link: 'none', subject: 'Pumps: ' + fs.length + ' facilities', body: `<p>Hi ${esc(first(nameOf(ts[0].assignee)))},</p><p>These are in the portal now. Please check if GNS Chicago sent them pumps and add any to "Pump Tracking". Click "Checked" next to each one when you're done.</p><p><b>${PUMP_RULE_MANY}</b></p>${taskList(fs.map((x, i) => ['<b>' + esc(facName(x)) + '</b>', ts[i].key]), ['Checked'])}` });
    }
    // portal setup: rep + price table + all areas of care + in the portal + dates
    if (!fTask(f, 'PORTAL_SETUP') && !preDone(f, 'ps') && (f.rep || autoPending(f)) && hasPrice(g) && covKnown(FG(f)) && f.inPortal && f.dates && f.bt) {
      const t = newTask('PORTAL_SETUP', { fac: f.id, assignee: am, amTask: true });
      todo(t, 'portal setup for ' + facName(f), 'Set up <b>' + esc(facName(f)) + '</b> in the portal.');
    }
    if (!fTask(f, 'EMR_PORTAL') && (g.emr || g.existing) && !g.emrNew && !preDone(f, 'emr') && f.inPortal && done(fTask(f, 'EMR_ADD'))) {
      const t = newTask('EMR_PORTAL', { fac: f.id, assignee: am, amTask: true });
      todo(t, 'EMR info for ' + facName(f), 'Put the EMR info for <b>' + esc(facName(f)) + '</b> in the portal.');
    }
    {
      const fc = fTask(f, 'FASTCARE'), openCP = tasksOf(f, 'CONTACTS_PORTAL').some(t => !done(t));
      // "Received contacts" ticked without "Added contacts to portal": 1 task to add them, even if none are typed into the app
      const needRec = f.ctNeed && !f.ctNeedTask && !preDone(f, 'ct');
      // wound rep / regional picked after the portal setup was done also go on it
      if (!openCP && f.inPortal && ((fcDoneNew(f) && (f.contacts.some(c => !c.inPortal) || needRec)) || gtMissing(f).length)) {
        const t = newTask('CONTACTS_PORTAL', { fac: f.id, assignee: am, amTask: true });
        if (needRec) f.ctNeedTask = t.key;
        todo(t, 'add contacts for ' + facName(f), 'Add the contacts for <b>' + esc(facName(f)) + '</b> to the portal.');
      }
    }
    if (!fTask(f, 'SCHEDULE') && datesOpen(f) && !preDone(f, 'sched') && f.dates && (done(fTask(f, 'PORTAL_SETUP')) || preDone(f, 'ps'))) {
      const t = newTask('SCHEDULE', { fac: f.id, assignee: am, amTask: true });
      todo(t, 'schedule ' + facName(f), 'Schedule <b>' + esc(facName(f)) + '</b>. The Brightree report is done, so schedule it as soon as you can: the longer it waits, the more likely the last delivery dates change.', 'High');
    }
    // already scheduled, handoff email not sent: it goes out by itself once it has what it needs
    // David's facility typed in as already scheduled: its intake rep is picked by the same rules, for the ordering date typed in
    if (!f.email1 && f.manualDates && preDone(f, 'sched') && f.dates && !f.rep && isAutoAcct(acctOf(f))) autoAssign(f, '', 'Automatic (already scheduled)');
    if (!f.email1 && f.manualDates && preDone(f, 'sched') && f.dates && f.rep && covKnown(FG(f)) && !settingsProblems().length) { sendEmail1(f); f.email1By = 'Sent automatically (already scheduled)'; }
    // Email 3 to the wound rep + regional: as soon as the FastCare task is done (or its info was filled in), unless no contacts request is needed
    const fcIn = done(fTask(f, 'FASTCARE')) || preDone(f, 'wr');
    // since Oct 26 2026 it waits for the Gentell WC Transition Lead (CC'd on it)
    if (!f.email3 && !f.noE3 && !preDone(f, 'e3') && fcIn && f.wound && f.regional && ctlOf(f)) sendEmail3(f);
    if (f.email1 && f.e1NoWound && !f.inserviceMail && fcIn && woundRegEmails(f).length) sendInservice(f);
    // no contacts request (contacts didn't need reviewing / already received): the in-service ask goes on its own
    else if (!e3Pending(f) && !f.email3 && !inserviceDone(f) && fcIn && f.wound && f.regional && ctlOf(f)) sendInservice(f);
    // handoff sent: the email to the Gentell WC Transition Lead, once there is one
    if (f.email1 && f.e1Split && !f.e1b && !f.email2 && ctlOf(f)) sendCtlEmail(f);
    // portal setup done while EMR access wasn't ready: check it as soon as it is
    if (f.emrCheckDue && !f.emrChecked && emrReady(f) && !fTask(f, 'EMR_CHECK')) { const t = newTask('EMR_CHECK', { fac: f.id, assignee: am, amTask: true }); todo(t, 'check EMR access for ' + facName(f), 'EMR access for <b>' + esc(facName(f)) + '</b> is set up now. Log in and check it works.'); }
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
      mail({ key: 'm:risk:' + f.id + ':' + f.dates.ord, code: 'E18', to: [am], fac: f.id, link: 'fac', day: day > st.today ? day : st.today, cond: { fac: f.id, untilEmail1: true, ord: f.dates.ord }, subject: 'At risk: ' + facName(f) + ' orders ' + fmt(f.dates.ord) + ' and Chicago hasn\'t been emailed', body: '<p>Finish the open tasks so the Chicago handoff email can go out.</p>' });
    }
    // complete
    // never complete while the FastCare task is still open (Oct 2026). Facilities already marked complete stay as they are.
    const fcOpen = !!fTask(f, 'FASTCARE') && !done(fTask(f, 'FASTCARE'));
    if (f.email2 && (done(fTask(f, 'GDD')) || preDone(f, 'gdd')) && (!f.email3 || f.e3Done) && !fcOpen && esignOk(f)) {
      f.complete = st.today;
      tasksOf(f).forEach(t => { if (!done(t) && ['CHICAGO_FOLLOW'].includes(t.type)) t.status = 'Not needed'; });
      mail({ key: 'm:E24:' + f.id, code: 'E24', to: [am, f.requester], fac: f.id, link: 'fac', subject: 'Transition complete: ' + facName(f), fyi: true, body: `<p><b>${esc(facName(f))}</b> is done.${f.dates ? ` First DOS ${fmt(f.dates.dos)}, ordering ${fmt(f.dates.ord)}, delivery ${fmt(f.dates.del)}.` : ''} Intake rep: ${esc(nameOf(f.rep)) || '-'}.</p>` });
    }
  });
  // the "no corporate yet" rep task closes itself once every facility on it has a rep or a corporate
  // the "pick the reps" tasks close themselves once every facility on them has what it needs (filled on the facility page, a rule, …)
  st.tasks.filter(t => t.type === 'RULE' && !done(t) && !ruleFacs(t).length).forEach(t => { t.status = 'Not needed'; t.doneOn = st.today; });
  // completed facilities are never archived (Oct 2026). Ones archived before that come back, with their done tasks.
  // Their open tasks stay put away, so nobody gets reminders on old work. (Deleted facilities stay archived.)
  st.facs.forEach(f => { if (f.archived && f.complete && !f.deleted) { f.archived = false; tasksOf(f).forEach(t => { if (t.archived && done(t)) t.archived = false; }); } });
  // details changed after the portal setup (on the facility page, the corporate, the tracker): the transition lead updates the portal
  st.facs.forEach(trackPortal);
  flush();
  ensureTaskMails();
  st.tasks.forEach(t => { if (!done(t) && !t.archived) spaceReminders(t); });
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

// ---------- put a done task back in the queue (it was checked off by mistake) ----------
// Nothing the task saved is erased: re-doing it shows what's on file, so the person only changes what was wrong.
// Not for "Schedule" (it sent the Chicago handoff email: use "Dates changed: send correction") or "Chicago hasn't sent".
const NO_REOPEN = new Set(['SCHEDULE', 'CHICAGO_FOLLOW', 'EMAIL3_FOLLOW']);
function canReopen(t) {
  if (!t || t.status !== 'Done' || NO_REOPEN.has(t.type)) return false;
  const f = t.fac ? facById(t.fac) : null;
  return !(f && (f.deleted || f.archived));
}
function reopenTask(t, to, by, byName) {
  if (!canReopen(t)) return 'This task can\'t be put back.';
  (t.history = t.history || []).push({ doneBy: t.doneBy, doneByName: t.doneByName, doneOn: t.doneOn, reopenedBy: by, reopenedByName: byName, reopenedOn: st.today });
  t.status = 'Open'; t.doneBy = ''; t.doneByName = ''; t.doneOn = ''; t.reopened = st.today;
  if (to) { t.assignee = to; t.amTask = false; }
  t.due = addBiz(st.today, isAm(t.assignee) ? st.settings.amDays : st.settings.helperDays);
  // the pumps answer is what the task recorded; undo it so the portal setup shows "not checked yet" again
  if (t.type === 'PUMPS') { const f = facById(t.fac); if (f && f.pumps === 'checked') f.pumps = ''; }
  // portal setup done again covers every field, so any open "Update the portal" task isn't needed; the snapshot is retaken when it's done
  if (t.type === 'PORTAL_SETUP') { const f = facById(t.fac); if (f) { delete f.portalSnap; tasksOf(f, 'PORTAL_UPDATE').forEach(x => { if (!done(x)) { x.status = 'Not needed'; x.doneOn = st.today; } }); } }
  mail({ key: 'm:E26:' + t.key + ':' + uid(), code: 'E26', to: [t.assignee], fac: t.fac, task: t.key, cond: { task: t.key },
    subject: 'Back in your queue: ' + taskTitle(t), body: `<p>${esc(byName)} put this task back in the queue. It still needs to be done. Due ${fmt(t.due)}.</p>` });
  return '';
}

// ---------- steps marked done from the facility page (same list as "Already done" on the request) ----------
// which open tasks each step closes. Corporate-wide steps also close the corporate's own tasks.
function stepTasks(f, k) {
  const open = types => tasksOf(f).filter(t => types.includes(t.type) && !done(t) && !t.archived);
  const g = f.group ? G(f) : null;
  switch (k) {
    case 'corp': return g ? st.tasks.filter(t => !t.fac && lc(t.group) === lc(g.name) && ['PRICE', 'EMR'].includes(t.type) && !done(t)) : [];
    case 'added': return open(['PORTAL_ADD']);
    case 'pumps': return open(['PUMPS']);
    case 'gdd': return open(['GDD']);
    case 'wr': return open(['FASTCARE']);
    case 'e3': return open(['E3_REPLY', 'EMAIL3_FOLLOW']);
    case 'ct': return open(['CONTACTS_PORTAL']);
    case 'es': return [];
    case 'esp': return open(['ESIGN_PORTAL']);
    case 'emr': return open(['EMR_ADD', 'EMR_PORTAL']);
    case 'ps': return open(['PORTAL_SETUP']);
    case 'sched': return open(['BRIGHTREE', 'SCHEDULE', 'ADDRESS']);
    case 'e1': return [];
    case 'e2': return open(['CHICAGO_FOLLOW']);
  }
  return [];
}
// is this step already taken care of? (then its box shows ticked and can't be changed)
function stepIsDone(f, k) {
  if (stepTasks(f, k).length) return false; // an open task (new, or put back in the queue) means it isn't done
  if (preDone(f, k)) return true;
  const g = G(f);
  switch (k) {
    case 'corp': return !!(g.existing || (g.price && g.emr));
    case 'added': return !!f.inPortal;
    case 'pumps': return !!f.pumps;
    case 'gdd': return !!f.gdd;
    case 'wr': return !!done(fTask(f, 'FASTCARE'));
    case 'e3': return !!(f.e3Done || f.noE3);
    case 'ct': return (f.contacts || []).every(c => c.inPortal) && !stepTasks(f, 'ct').length && fcDoneNew(f) && !(f.ctNeed && !done(taskByKey(f.ctNeedTask)));
    case 'es': return !!(f.esignGot || f.esignDone);
    case 'esp': return !!f.esignDone;
    case 'emr': return !!done(fTask(f, 'EMR_PORTAL')) || (!!g.emrNew && !!g.emr);
    case 'ps': return !!done(fTask(f, 'PORTAL_SETUP'));
    case 'sched': return !!(f.manualDates || f.schedDone || done(fTask(f, 'SCHEDULE')) || (f.email1 && !handoffOnly(f)));
    case 'e1': return !!f.email1;
    case 'e2': return !!f.email2;
  }
  return false;
}
// EMR access for this facility is in the portal (new login entered by the EMR person, or the existing login + EMR info task)
const emrReady = f => { const g = G(f); return preDone(f, 'emr') || done(fTask(f, 'EMR_PORTAL')) || (!!g.emrNew && !!g.emr && !!f.inPortal && done(gTask(g.name, 'EMR'))); };
// later steps include the earlier ones (same as the request form)
const stepChain = keys => { const p = new Set(keys); Object.keys(PRE_IMPLY).forEach(k => { if (p.has(k)) PRE_IMPLY[k].forEach(x => p.add(x)); }); return [...p]; };
function stepProblem(f, keys) {
  if (!keys.length) return 'Tick at least 1 step.';
  if (keys.includes('corp') && !f.group) return 'This facility has no corporate yet. Pick it under "Edit details" first.';
  if (keys.includes('wr') && !f.group) return '"FastCare info gathered" needs the corporate. Pick it under "Edit details" first.';
  return '';
}
// sets what the skipped steps would have set, closes their open tasks, and tells the people those tasks were sent to
function markStepsDone(f, picked, by, byName, info) {
  const keys = stepChain(picked).filter(k => !stepIsDone(f, k)), g = f.group ? G(f) : null, i = info || {};
  const err = stepProblem(f, keys) || preInfoProblem(keys, i); if (err) return { err };
  const closed = [];
  keys.forEach(k => stepTasks(f, k).forEach(t => { if (!closed.includes(t)) closed.push(t); }));
  f.pre = normPre(f.pre); keys.forEach(k => f.pre[k] = true);
  f.stepsDone = [...(f.stepsDone || []), { keys, by, byName, on: st.today }];
  if (keys.includes('corp') && g && !g.price) g.existing = true;
  if (keys.includes('added')) { f.inPortal = true; f.portalName = i.pn || f.portalName || f.name; f.addedBefore = true; }
  if (keys.includes('pumps') && !f.pumps) f.pumps = 'already done';
  if (keys.includes('gdd')) gddAnswer(f, i.gdd, i.gddWh);
  if (keys.includes('wr')) { f.wound = i.wound; f.regional = i.regional; }
  if (keys.includes('e3')) { f.noE3 = true; markE3Done(f, byName); if (!keys.includes('ct') && !preDone(f, 'ct')) f.ctNeed = true; }
  if (keys.includes('sched')) { if (f.email1) f.schedDone = st.today; else setManualDates(f, i, byName); }
  if (keys.includes('ct')) (f.contacts || []).forEach(c => c.inPortal = true);
  if (keys.includes('es')) markEsignGot(f, byName);
  if (keys.includes('esp')) markEsignDone(f, byName);
  if (keys.includes('e1') && !f.email1) { f.email1 = st.today; f.email1By = byName + ' (marked on the facility page)'; }
  if (keys.includes('e2') && !f.email2) { f.email2 = st.today; f.email2By = byName + ' (marked on the facility page)'; }
  closed.forEach(t => { t.status = 'Done'; t.doneBy = by; t.doneByName = byName; t.doneOn = st.today; t.closedOnFac = true; });
  notifyClosed(f, closed, by, byName, ts => 'marked ' + (ts.length === 1 ? 'this' : 'these') + ' as already done');
  return { keys, closed };
}
// 1 email per person whose task was removed (not the person who did it)
function notifyClosed(f, closed, by, byName, what) {
  const byWho = {}; closed.forEach(t => { if (t.assignee && t.assignee !== by) (byWho[t.assignee] = byWho[t.assignee] || []).push(t); });
  Object.entries(byWho).forEach(([who, ts]) => mail({ key: 'm:E25:' + hash(ts.map(t => t.key).sort().join(',')) + ':' + uid(), code: 'E25', to: [who], fac: f.id, link: 'none',
    subject: (ts.length === 1 ? 'Not needed anymore: ' + taskTitle(ts[0]) : 'Not needed anymore: ' + ts.length + ' tasks for ' + facName(f)),
    body: `<p>Hi ${esc(first(nameOf(who)))},</p><p>${esc(byName)} ${what(ts)} for <b>${esc(facName(f))}</b>, so ${ts.length === 1 ? 'it\'s' : 'they\'ve'} been removed from your tasks. You don't need to do ${ts.length === 1 ? 'it' : 'them'}.</p><ul>${ts.map(t => '<li>' + esc(taskTitle(t)) + '</li>').join('')}</ul>` }));
}
// closes a facility's open tasks of these types as Done (what they ask for was filled in on the facility page)
function closeFilled(f, types, by, byName) {
  const ts = tasksOf(f).filter(t => types.includes(t.type) && !done(t) && !t.archived);
  ts.forEach(t => { t.status = 'Done'; t.doneBy = by; t.doneByName = byName; t.doneOn = st.today; t.doneAt = nowIso(); t.closedOnFac = true; });
  return ts;
}

// ---------- Brightree report → portal setup → schedule, done together when possible ----------
// The schedule is based on the last delivery dates on the Brightree report. If scheduling waits, Chicago may ship again,
// the dates change and billing overlaps. So once the report is done, the schedule task is high importance, and finishing
// the report or the portal setup points straight to the next one.
const isHighTask = t => !!t && t.type === 'SCHEDULE' && !done(t) && !!(facById(t.fac) || {}).bt;
const BT_STALE_MS = 8 * 3600 * 1000;
// when the Brightree report dates were last entered or rechecked: { ms, day, exact } (exact = we know the time, not just the day)
function btWhen(f) {
  if (!f || !f.bt) return null;
  if (f.btAt) return { ms: Date.parse(f.btAt), day: etDay(f.btAt), exact: true };
  const t = fTask(f, 'BRIGHTREE');
  if (t && t.doneAt) return { ms: Date.parse(t.doneAt), day: etDay(t.doneAt), exact: true };
  if (t && t.doneOn) return { ms: Date.parse(t.doneOn + 'T12:00:00Z'), day: t.doneOn, exact: false };
  return null;
}
// more than 8 hours since the report (only the day known: any earlier day counts)
function btStale(f) { const w = btWhen(f); if (!w) return false; return w.exact ? nowMs() - w.ms > BT_STALE_MS : w.day < st.today; }
const btWhenText = w => w.exact ? whenET(w.ms) : fmt(w.day);
// what portal setup still waits on (it's made once all of these are in)
function psWaiting(f) {
  const g = f.group ? G(f) : null, w = [];
  if (!f.group) w.push('The corporate (FastCare task)');
  if (!f.rep && !autoPending(f)) w.push('The intake rep (' + roleName('rules') + ', "Pick the reps")');
  if (g && !covKnown(FG(f))) w.push('The areas of care');
  if (g && !hasPrice(g)) w.push('The price table (' + roleName('price') + ')');
  if (!f.inPortal) w.push('Adding it to Brightree (' + roleName('portal') + ')');
  if (!f.bt) w.push('The Brightree report');
  if (!f.dates && f.bt) w.push('The dates (a full address with a state that has a ship point)');
  return w;
}
// after a task is done: the task it's recommended to do right away. { to: 'PORTAL_SETUP'|'SCHEDULE', task, waiting: [...] } or null
function nextStep(f, from) {
  if (!f || !datesOpen(f) || f.hold || f.complete || f.deleted) return null;
  const ps = fTask(f, 'PORTAL_SETUP'), psDone = done(ps) || preDone(f, 'ps');
  if (from === 'BRIGHTREE' && !psDone) return { to: 'PORTAL_SETUP', task: ps && !done(ps) ? ps : null, waiting: ps ? [] : psWaiting(f) };
  if (from === 'BRIGHTREE' || from === 'PORTAL_SETUP') {
    const sc = fTask(f, 'SCHEDULE');
    return { to: 'SCHEDULE', task: sc && !done(sc) ? sc : null, waiting: sc ? [] : !f.dates ? ['The dates (a full address with a state that has a ship point)'] : [] };
  }
  return null;
}
// new Brightree report dates (rechecked on the schedule task or changed on the facility page). Only before the Chicago handoff email.
// The dates recalculate. A DOS someone picked by hand was based on the old report, so it goes back to the new recommended one.
// Returns '' or what's wrong.
function btProblem(f, v) {
  const b = f.bt || {};
  if (!v.le && !v.lo) return 'Enter at least 1 last delivery date.';
  if ((v.le && v.le > st.today) || (v.lo && v.lo > st.today)) return 'A last delivery date can\'t be in the future.';
  if ((b.lastEnt && !v.le) || (b.lastOuts && !v.lo)) return 'A last delivery date that was entered can\'t be cleared here. If it was entered by mistake, put the Brightree report task back in the queue and do it again.';
  if (!v.cad) return 'Pick how often enteral ships.';
  return '';
}
const updateBtCheck = (f, v) => !datesOpen(f) ? 'The Chicago handoff email already went out with these dates, so the report dates can\'t change. Use "Dates changed: send correction" on the facility page.' : btProblem(f, v);
function updateBt(f, v, by, byName) {
  const err = updateBtCheck(f, v); if (err) return { err };
  const cad = ({ Monthly: '4', Biweekly: '2', Weekly: '1' })[v.cad] || v.cad || '4';
  const old = Object.assign({}, f.bt || {}), nb = { lastEnt: v.le || '', lastOuts: v.lo || '', cadence: cad };
  const changed = (old.lastEnt || '') !== nb.lastEnt || (old.lastOuts || '') !== nb.lastOuts;
  const dropped = changed && !!f.dosChosen, oldDos = f.dates ? f.dates.dos : '';
  (f.btHistory = f.btHistory || []).push({ bt: old, at: f.btAt || '', by: f.btBy || '' });
  f.bt = nb; f.btAt = nowIso(); f.btBy = byName;
  if (dropped) { f.dosChosen = ''; f.dosBy = ''; }
  return { changed, dropped, oldDos, cadChanged: (old.cadence || '4') !== cad };
}

// ---------- editing a facility's details (facility page "Edit details") ----------
// Anything that was entered can be changed, but not cleared: a task that was done stays done. Wrong from the start? Put the task back in the queue.
// v holds only the fields the form showed. Returns '' or what's wrong (then nothing is changed).
// Brightree report dates typed in on the facility page before the report task was done (only while dates can still move)
const btNew = (f, v) => v.le !== undefined && !f.bt && datesOpen(f) && !f.manualDates && !!(v.le || v.lo);
const btChanged = (f, v) => { const b = f.bt || {}, cad = ({ 4: 'Monthly', 2: 'Biweekly', 1: 'Weekly' })[b.cadence] || 'Monthly'; return v.le !== undefined && !!f.bt && datesOpen(f) && ((b.lastEnt || '') !== v.le || (b.lastOuts || '') !== v.lo || cad !== v.cad); };
function editFacilityCheck(f, v) {
  if (!f) return 'That facility isn\'t there anymore.';
  const blank = (had, now, label) => had && now !== undefined && !now ? label + ' can\'t be left blank. It was entered before; if it was wrong, change it, or put the task that entered it back in the queue.' : '';
  const errs = [
    blank(f.name, v.name, 'Facility name'), blank(f.portalName, v.pn, 'Portal name'), blank(f.address, v.addr, 'Address'),
    autoPending(Object.assign({}, f, { acct: v.acct || f.acct })) ? '' : blank(f.rep, v.rep, 'Intake rep'), // David's facilities: picked at scheduling
    blank(f.clin, v.clin, 'Clinical rep'), blank(f.acct, v.acct, 'Account manager'), blank(f.am, v.am, 'Transition lead'),
    v.why !== undefined ? blank(f.why, v.why, 'Reason for transition') : ''
  ];
  for (const [k, label] of [['wound', 'Wound and Product Specialist'], ['regional', 'Regional Manager'], ['ctl', 'Gentell WC Transition Lead']]) {
    if (v[k] === undefined) continue;
    if (v[k + 'Raw'] && !v[k]) errs.push('Pick the ' + label + ' from the list (start typing their name).');
    else errs.push(blank(f[k], v[k], label));
  }
  if (v.gdd !== undefined) { if (['Yes', 'No'].includes(f.gdd) && !v.gdd) errs.push('The GDD answer can\'t be left blank.'); if (v.gdd === 'Yes' && !v.gddWh) errs.push('Which GDD warehouse?'); }
  if (v.addr && addressFormatProblem(v.addr)) errs.push(addressFormatProblem(v.addr));
  if (btChanged(f, v) || btNew(f, v)) errs.push(btProblem(f, v));
  return errs.find(Boolean) || '';
}
function editFacility(f, v, by, byName) {
  const err = editFacilityCheck(f, v); if (err) return err;
  const btv = btChanged(f, v) ? v : null;
  // what changes, and what each change sets off
  if (v.addr) { v.addr = normAddr(v.addr); }
  const state = v.addr ? stateFrom(v.addr) : f.state, oldState = f.state;
  if (f.email1 && v.addr && state !== oldState) mail({ key: 'm:E13:state:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, link: 'fac', subject: 'Address changed after the Chicago handoff email: ' + facName(f), body: '<p>' + esc(byName) + ' changed the state from ' + esc(oldState || '(none)') + ' to ' + esc(state) + '. The dates didn\'t change. Check the ship point and delivery date, and send Chicago a correction if they\'re wrong.</p>' });
  if (f.email1 && v.rep && v.rep !== f.rep) mail({ key: 'm:E13:rep:' + f.id + ':' + uid(), code: 'E13', to: [amOf(f)], fac: f.id, link: 'fac', subject: 'Intake rep changed after the Chicago handoff email: ' + facName(f), body: '<p>' + esc(byName) + ' changed the intake rep from ' + esc(nameOf(f.rep)) + ' to ' + esc(nameOf(v.rep)) + '. The Chicago handoff email (and the transfer notice to the facility) named ' + esc(nameOf(f.rep)) + '. Click "Dates changed: send correction" on the facility page to send Chicago the corrected email with the new rep, or let the facility know yourself.</p>' });
  const oldAm = amOf(f), closed = [], wrWas = JSON.stringify([f.wound || null, f.regional || null]);
  // a portal name typed in for the first time means it's in Brightree: Amy's "Add to Brightree" task isn't needed
  if (v.pn && !f.inPortal && v.pn !== (f.portalName || '')) { f.inPortal = true; f.addedOnFac = byName; closed.push(...closeFilled(f, ['PORTAL_ADD'], by, byName)); }
  f.name = v.name || f.name; if (v.pn) f.portalName = v.pn;
  if (v.addr) { f.address = v.addr; f.state = state; }
  if (v.rep) f.rep = v.rep; if (v.clin) f.clin = v.clin; if (v.acct) f.acct = v.acct; if (v.am) f.am = v.am;
  if (v.none) { if (!G(f).standalone) makeStandalone(f); } else if (v.grp && lc(v.grp) !== lc(f.group) && grp(v.grp)) f.group = grp(v.grp).name;
  if (v.wound) f.wound = v.wound; if (v.regional) f.regional = v.regional;
  // a new Gentell WC Transition Lead after their email went out (and the facility email hasn't): the new one never got it
  if (v.ctl) setCtl(f, v.ctl, byName);
  if (v.why) f.why = v.why;
  // first GDD answer here: same as Chris answering (FYI to the GDD contact if Yes), and his task closes
  if (['Yes', 'No'].includes(v.gdd) && !['Yes', 'No'].includes(f.gdd)) { gddAnswer(f, v.gdd, v.gddWh); closed.push(...closeFilled(f, ['GDD'], by, byName)); }
  else if (v.gdd && (v.gdd !== f.gdd || (v.gdd === 'Yes' && v.gddWh !== f.gddWh))) {
    const was = f.gdd === 'Yes' ? f.gddWh : '';
    f.gdd = v.gdd; f.gddWh = v.gdd === 'Yes' ? v.gddWh : '';
    if (was || f.gddWh) mail({ key: 'm:E11:' + f.id + ':' + hash(was + '>' + f.gddWh), code: 'E11', to: [roleEmail('gddInfo')], cc: [amOf(f)], fac: f.id, link: 'none', subject: 'GDD changed: ' + facName(f), body: `<p>Hi ${esc(first(roleName('gddInfo')))},</p><p>FYI, ${esc(byName)} changed the GDD answer for <b>${esc(facName(f))}</b>: ${f.gddWh ? 'it\'s serviced through <b>' + esc(f.gddWh) + '</b>' : 'it\'s <b>not</b> serviced through GDD'}${was ? ' (it was ' + esc(was) + ')' : ''}.</p>` });
    if (!f.gddWh) tasksOf(f, 'GDD_PORTAL').forEach(t => { if (!done(t)) { t.status = 'Not needed'; t.doneOn = st.today; } });
  }
  let btRes = null; if (btv) btRes = updateBt(f, btv, by, byName);
  // report dates typed in here before the report task: it closes
  if (btNew(f, v)) { f.bt = { lastEnt: v.le || '', lastOuts: v.lo || '', cadence: CAD_V[v.cad] || '4' }; f.btAt = nowIso(); f.btBy = byName; closed.push(...closeFilled(f, ['BRIGHTREE'], by, byName)); }
  // wound rep + regional both in: the FastCare task isn't needed (it also needs the corporate; a missing address gets its own task)
  let fcLeft = '';
  const wrNew = JSON.stringify([f.wound || null, f.regional || null]) !== wrWas; // only when they were filled in or changed just now
  if (wrNew && f.wound && f.regional && fTask(f, 'FASTCARE') && !done(fTask(f, 'FASTCARE'))) { if (f.group) closed.push(...closeFilled(f, ['FASTCARE'], by, byName)); else fcLeft = 'The FastCare task stays open: it still needs the corporate.'; }
  if (closed.length) notifyClosed(f, closed, by, byName, ts => 'filled in what ' + (ts.length === 1 ? 'this task asks' : 'these tasks ask') + ' for on the facility page');
  if (amOf(f) !== oldAm) {
    const open = tasksOf(f).filter(t => !done(t) && !t.archived && t.amTask);
    mail({ key: 'm:E20:lead:' + f.id + ':' + uid(), code: 'E20', to: [amOf(f)], cc: [oldAm], fac: f.id, link: 'fac', subject: 'You\'re now the transition lead: ' + facName(f), body: `<p>${esc(byName)} made you the transition lead for <b>${esc(facName(f))}</b> (it was ${esc(nameOf(oldAm))}).</p>${open.length ? '<p>Its open tasks moved to you:</p>' + taskList(open.map(t => [esc(taskTitle(t)), t.key])) : '<p>No open tasks right now.</p>'}` });
  }
  return { ok: true, bt: btRes, closed, fcLeft };
}
// tracker "Change selected" (Oct 27 2026): Edit details for many facilities at once, only for the boxes filled in.
// ch = { rep, clin ('__same' = each facility's intake rep), acct, am, ctl, wound, regional }. Same checks and side effects as Edit details
// (new transition lead → E20, intake rep after the handoff → E13, wound rep + regional → FastCare closes, WC lead after their email → E13).
// Returns { done, skipped: [[facility, why]] }.
function bulkEdit(ids, ch, by, byName) {
  const out = { done: 0, skipped: [] };
  ids.forEach(id => {
    const f = facById(id); if (!f || f.deleted) return;
    const v = {}, skip = why => out.skipped.push([facName(f), why]);
    if (ch.acct) v.acct = ch.acct;
    if (ch.am) v.am = ch.am;
    const pending = autoPending(Object.assign({}, f, { acct: v.acct || f.acct }));
    if (ch.rep) { if (pending) skip('intake rep not set: it\'s picked at scheduling (account manager ' + nameOf(autoAcct()) + ')'); else v.rep = ch.rep; }
    // clinical: picked, or "same as intake rep". Not picked: follows a new intake rep when it was blank or the same as the old one (as before)
    if (ch.clin === '__same') { if (v.rep || f.rep) v.clin = v.rep || f.rep; else skip('clinical rep not set: no intake rep yet'); }
    else if (ch.clin) v.clin = ch.clin;
    else if (v.rep && (!f.clin || lc(f.clin) === lc(f.rep))) v.clin = v.rep;
    if (ch.ctl) v.ctl = ch.ctl;
    if (ch.wound) v.wound = ch.wound;
    if (ch.regional) v.regional = ch.regional;
    if (!Object.keys(v).length) return;
    const err = editFacilityCheck(f, v); if (err) { skip(err); return; }
    editFacility(f, v, by, byName); out.done++;
  });
  return out;
}
// contacts edited on the facility page. A contact that's new or changed goes on the next "Contacts into portal" task.
function saveContacts(f, list, byName) {
  const same = (a, b) => ['first', 'last', 'dept', 'note', 'email'].every(k => lc(a[k]) === lc(b[k]));
  const old = f.contacts || [], used = new Set();
  let fresh = 0;
  f.contacts = list.map(c => { const o = old.find((x, i) => !used.has(i) && same(x, c) && used.add(i)); if (o) return o; fresh++; return { first: c.first || '', last: c.last || '', dept: c.dept || '', note: c.note || '', email: c.email || '', src: byName, inPortal: false }; });
  // edited rows pair up with the old ones they replaced; only what's left over was removed
  const goneInPortal = old.filter((o, i) => !used.has(i) && o.inPortal).length, gone = old.filter((o, i) => !used.has(i)).length;
  return { removedInPortal: Math.max(0, Math.min(goneInPortal, gone - fresh)) };
}

// ---------- "Update the portal" after the portal setup ----------
// The values the transition lead typed into the portal at setup. A snapshot is taken when the portal setup is done; when any of them
// changes later (facility page, corporate page, tracker, a rule), an "Update the portal" task lists what changed. Changing it back takes it off.
const PV_LABELS = { acct: '"Account Manager"', clin: '"Clinical Review"', rep: '"Insurance Specialist", "Intake Specialist"', price: '"Price Table"', vendor: '"Main Vendor"', ship: '"Ship Point"', shipOst: '"Ship Point- United Ostomy, Fordmed"', corp: 'Corporate', addr: 'Address (portal and Brightree)', 'gt:wound': 'Contact: "Gentell Wound & Product Specialist"', 'gt:regional': 'Contact: "Gentell Regional Manager"' };
const pvLabel = k => PV_LABELS[k] || (k.startsWith('cov:') ? '"CoverageType": ' + k.slice(4) : k);
function portalVals(f) {
  const g = FG(f), o = { acct: nameOf(acctOf(f)), clin: nameOf(f.clin || f.rep), rep: nameOf(f.rep), price: G(f).price || '', vendor: f.gdd === 'Yes' ? (f.gddWh || '') : '',
    ship: String(shipOf(st.settings.shipEnt, f.state) || ''), shipOst: String(shipOf(st.settings.shipOst, f.state) || ''), corp: f.group || '', addr: f.address || '' };
  AREAS.forEach(a => o['cov:' + a] = (g.cov || {})[a] || '');
  // wound rep + regional as portal contacts: only facilities whose portal setup was done with that step (f.gtc, since Oct 26 2026)
  if (f.gtc) GT_ROLES.forEach(r => o['gt:' + r.k] = gtLabel(f[r.k]));
  return o;
}

// ---------- Gentell wound rep + regional as portal contacts (Malka, Oct 26 2026) ----------
// Their portal Departments set "Include On" (overview email + doc request email), so they get the facility's emails.
// f.gtc = { wound, regional }: the email of the person added to the portal ('' = not added yet). Set when portal setup is done.
// No f.gtc = portal setup done before this (or by hand): nothing changes for that facility.
const GT_ROLES = [{ k: 'wound', dept: 'Gentell Wound & Product Specialist' }, { k: 'regional', dept: 'Gentell Regional Manager' }];
const gtLabel = p => p ? (p.name ? p.name + ' (' + p.email + ')' : p.email) : '';
const gtSplit = p => { const w = String((p && p.name) || '').trim().split(/\s+/); return { first: w[0] || '', last: w.slice(1).join(' ') }; };
// the wound rep / regional to add to the portal: all of them at portal setup, after it the ones picked later that aren't in yet
const gtRows = (f, all) => GT_ROLES.filter(r => f[r.k] && (all || (f.gtc && !f.gtc[r.k]))).map(r => Object.assign({ role: r.k, dept: r.dept, email: f[r.k].email }, gtSplit(f[r.k])));
const gtMissing = f => f.gtc && done(fTask(f, 'PORTAL_SETUP')) ? gtRows(f, false) : [];
const gtMark = (f, rows) => rows.forEach(r => { f.gtc[r.role] = r.email; });
const gtTable = rows => `<div class="tablewrap"><table><tr><th>First</th><th>Last</th><th>Department</th><th>Email</th></tr>${rows.map(r => `<tr><td>${esc(r.first)}</td><td>${esc(r.last)}</td><td><b>${esc(r.dept)}</b></td><td>${esc(r.email)}</td></tr>`).join('')}</table></div>`;
function trackPortal(f) {
  if (f.deleted || f.archived) return;
  if (!(done(fTask(f, 'PORTAL_SETUP')) || preDone(f, 'ps'))) return;
  const cur = portalVals(f);
  // David's facilities waiting for scheduling: the intake rep (and clinical) go into the portal on the schedule task, not here
  if (autoPending(f) && f.portalSnap) { cur.rep = f.portalSnap.rep ?? cur.rep; cur.clin = f.portalSnap.clin ?? cur.clin; }
  if (!f.portalSnap) { f.portalSnap = cur; return; } // first time (or portal setup done again): nothing to update
  // wound rep / regional not in the portal yet: they go on "Contacts into portal" (gtMissing), so the snapshot just follows them
  GT_ROLES.forEach(r => { const k = 'gt:' + r.k; if (k in cur && !(f.gtc && f.gtc[r.k])) f.portalSnap[k] = cur[k]; });
  const diffs = Object.keys(cur).filter(k => cur[k] !== (f.portalSnap[k] ?? cur[k]));
  Object.keys(cur).forEach(k => { if (!(k in f.portalSnap)) f.portalSnap[k] = cur[k]; }); // a value added to the list later starts as it is
  if (!diffs.length) return;
  let t = tasksOf(f, 'PORTAL_UPDATE').find(x => !done(x) && !x.archived), isNew = false;
  if (!t) { t = newTask('PORTAL_UPDATE', { fac: f.id, assignee: amOf(f), amTask: true, items: [] }); isNew = true; }
  t.items = t.items || [];
  diffs.forEach(k => { const it = t.items.find(i => i.k === k); if (it) { it.to = cur[k]; it.on = st.today; } else t.items.push({ k, from: f.portalSnap[k], to: cur[k], on: st.today }); });
  t.items = t.items.filter(i => i.from !== i.to);
  f.portalSnap = Object.assign({}, f.portalSnap, cur);
  if (!t.items.length) { if (isNew) st.tasks.splice(st.tasks.indexOf(t), 1); else { t.status = 'Not needed'; t.doneOn = st.today; } return; }
  if (isNew) todo(t, 'update the portal for ' + facName(f), 'Some details for <b>' + esc(facName(f)) + '</b> changed after the portal setup. Update them in the portal.');
}
