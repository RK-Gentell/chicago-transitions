'use strict';
/* =====================================================================
   Bulk upload (Oct 22 2026): many facilities at once, from many corporates.
   2 flows, same screen (views "bulkct" and "bulknf"):
     ct = Chicago transitions (same fields as "+ New transition request", minus contacts and attachments)
     nf = new facility scheduling (same fields as "+ New facility scheduling request")
   1. "Download the template": an Excel file (ExcelJS, loaded only when needed) with
      an Instructions tab, a Facilities tab with dropdowns, and a hidden Lists tab.
      Pasting over the dropdowns is fine: everything is checked again on upload.
   2. Drop or browse an .xlsx or .csv. Every row is checked with the same rules as
      the form (bulkCheck). Wound rep / regional emails are looked up in the
      company address book, like the form's pickers.
   3. Preview: every facility with exactly what will be saved, plus the tasks and
      emails it sets off right away. Those come from a dry run: a copy of the data,
      the same build + run() the real upload uses, then thrown away.
   4. Approve → act(): checked again on the latest data, numbers allocated, built, saved.
   Chicago: the whole upload is 1 request (req), so "New transition" goes once per transition lead.
   ===================================================================== */

const BULK_MAX = 300;
const YES = /^(yes|y|true|x|1|✓|✔)$/i, NO = /^(no|n|false|0)$/i;
// ---------- the columns ----------
// [key, header, help, list (dropdown name in the Lists tab), width]
const PRE_HDR = { corp: 'Corporate set up in the portal', added: 'Added to Brightree', pumps: 'Pumps checked', gdd: 'GDD question answered', wr: 'FastCare info gathered', e3: 'Received contacts', ct: 'Added contacts to portal', emr: 'EMR info in the portal', ps: 'Portal setup done', sched: 'Scheduled', e1: 'Chicago handoff email sent', e2: 'Transfer notice sent by GNS Chicago' };
const BULK_PRE = PRE_ITEMS.map(x => x[0]).filter(k => PRE_HDR[k]);
// headers from older templates that still mean the same column
const HDR_OLD = { 'already done: no contacts request needed': 'pre_e3', 'chicago transition lead email': 'ctl' };
const CT_COLS = [
  ['name', 'Facility (Chicago name)', 'Required. The Chicago (Gentell) name, usually with the state in parentheses.', '', 34],
  ['addr', 'Address', 'Optional. Full address ending with the state and zip: 123 Main St, LaGrange, IN 46761.', '', 40],
  ['corp', 'Corporate', 'Blank or ? = not known yet (the transition lead finds it in FastCare). "none" = no corporate.', 'corps', 30],
  ['why', 'Reason for transition', 'Optional.', '', 30],
  ...AREAS.map(a => ['cov_' + a, a, 'Area of care. Blank or "Not sure" = asked later. Facilities in the same corporate need the same answer.', a === 'Supplements' ? 'covSupp' : 'cov', 18]),
  ['acct', 'Account manager', 'Optional. Pick from the list.', 'reps', 22],
  ['rep', 'Intake rep', 'Optional. Leave blank when the account manager is ' + '{AUTO}' + ' (picked at scheduling).', 'reps', 22],
  ['am', 'Transition lead', 'Optional.', 'leads', 22],
  ['ctl', 'Gentell WC Transition Lead email', 'Optional. Their Gentell email (anyone in the company address book). Blank → {RULES} picks one.', '', 28],
  ...BULK_PRE.map(k => ['pre_' + k, 'Already done: ' + PRE_HDR[k], ((PRE_ITEMS.find(x => x[0] === k) || [])[2] || '') + ' Yes or blank.', 'yes', 16]),
  ['pn', 'Brightree name', 'Only with "Already done: Added to Brightree". Exactly as Brightree shows it.', '', 28],
  ['gdd', 'GDD orders?', 'Only with "Already done: GDD question answered". Yes or No.', 'yesno', 12],
  ['gddWh', 'GDD warehouse', 'Only when "GDD orders?" is Yes.', 'wh', 20],
  ['wound', 'Wound rep email', 'Only with "Already done: FastCare info gathered". Their Gentell email.', '', 28],
  ['regional', 'Regional email', 'Only with "Already done: FastCare info gathered". Their Gentell email.', '', 28],
  ['ord', 'Ordering date', 'Only with "Already done: Scheduled".', 'date', 14],
  ['dos', 'Date of service', 'Only with "Already done: Scheduled".', 'date', 14],
  ['del', 'Delivery date', 'Only with "Already done: Scheduled".', 'date', 14],
  ['cad', 'Enteral ships', 'Only with "Already done: Scheduled". Monthly, Weekly or Biweekly.', 'cad', 14]
];
const NF_COLS = [
  ['name', 'Facility name', 'Required. As it is in the portal.', '', 34],
  ['corp', 'Corporate', 'Required. No corporate? Type the facility name.', 'corps', 30],
  ['addr', 'Address', 'Required. Full address ending with the state and zip: 1 Main St, Toms River, NJ 08753.', '', 40],
  ['pb', 'Part B only', 'Required. Yes = Part B only (ordering 2 business days before the date of service). No = not Part B only.', 'yesno', 12],
  ['last', 'Last supply date with previous provider', 'Fill this or "No previous provider".', 'date', 18],
  ['noPrev', 'No previous provider', 'Yes = schedule as soon as possible. Leave the last supply date blank.', 'yes', 14],
  ['cad', 'Enteral ships', 'Monthly, Weekly or Biweekly. Blank = Monthly.', 'cad', 14],
  ['acct', 'Account manager', 'Optional. Blank → ' + '{RULES}' + ' gets a "Pick the reps" task.', 'reps', 22],
  ['rep', 'Intake rep', 'Optional. Leave blank when the account manager is {AUTO} (picked at scheduling).', 'reps', 22],
  ['lead', 'Schedule lead', 'Optional. Blank → {RULES} gets a "Pick the reps" task.', 'leads', 22]
];
const bulkCols = kind => (kind === 'ct' ? CT_COLS : NF_COLS).map(c => [c[0], c[1], c[2].replace('{AUTO}', nameOf(autoAcct()) || 'the account manager in Settings').replace(/\{RULES\}/g, roleName('rules')), c[3], c[4]]);
const BULK_TITLE = { ct: 'Chicago transitions', nf: 'New facility scheduling' };

// ---------- Excel library, loaded only when needed ----------
let xlLoading = null;
function loadXl() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!xlLoading) xlLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/exceljs-4.4.0.min.js'; s.onload = () => res(window.ExcelJS); s.onerror = () => { xlLoading = null; rej(new Error('The Excel library didn\'t load. Check your connection and try again.')); }; document.head.appendChild(s); });
  return xlLoading;
}
function bulkLists() {
  const corps = [...new Set([...Object.values(st.groups).filter(g => !g.standalone).map(g => g.name), ...nfs().filter(n => !n.deleted).map(n => n.group)].filter(Boolean))].sort(az);
  return { reps: repList().map(p => p.name), leads: amList().map(p => p.name), cov: [...COV, 'Not sure'], covSupp: [...COV_SUPP, 'Not sure'], yes: ['Yes'], yesno: ['Yes', 'No'], wh: [...st.settings.warehouses], cad: ['Monthly', 'Weekly', 'Biweekly'], corps };
}
let zipLoading = null;
function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipLoading) zipLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jszip-3.10.1.min.js'; s.onload = () => res(window.JSZip); s.onerror = () => { zipLoading = null; rej(new Error('The zip library didn\'t load.')); }; document.head.appendChild(s); });
  return zipLoading;
}
// an .xlsx without its comments / notes (and their drawings), so the Excel library can read it
async function xlNoComments(buf) {
  const Z = await loadZip(), zip = await Z.loadAsync(buf), gone = [];
  zip.forEach(path => { if (/^xl\/(comments[^/]*\.xml|threadedComments\/.*|persons\/.*|drawings\/vmlDrawing[^/]*\.vml)$/i.test(path)) gone.push(path); });
  gone.forEach(p => zip.remove(p));
  for (const path of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(path)) { const x = await zip.file(path).async('string'); zip.file(path, x.replace(/<Relationship\b[^>]*Type="[^"]*\/(comments|vmlDrawing|threadedComment)"[^>]*\/>/gi, '')); }
    else if (/^xl\/worksheets\/[^/]*\.xml$/i.test(path)) { const x = await zip.file(path).async('string'); zip.file(path, x.replace(/<legacyDrawing\b[^>]*\/>/gi, '')); }
  }
  const ct = zip.file('[Content_Types].xml'); if (ct) { const x = await ct.async('string'); zip.file('[Content_Types].xml', x.replace(/<Override\b[^>]*PartName="\/xl\/(comments|threadedComments|persons|drawings\/vmlDrawing)[^"]*"[^>]*\/>/gi, '')); }
  return zip.generateAsync({ type: 'arraybuffer' });
}
const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
async function bulkTemplate(kind) {
  const X = await loadXl(), wb = new X.Workbook(), cols = bulkCols(kind), L = bulkLists();
  wb.creator = 'Chicago Transitions app';
  const ins = wb.addWorksheet('Instructions');
  ins.columns = [{ width: 34 }, { width: 110 }];
  const lines = [[BULK_TITLE[kind] + ': bulk upload template'], [], ['How it works', '1 row per facility on the "Facilities" tab. Facilities can be from different corporates.'],
    ['', 'Dropdowns help you pick, but you can type or paste over them. Everything is checked when you upload, and you see a preview of every facility before anything is saved.'],
    ['', 'Upload it on the app: ' + (kind === 'ct' ? '"+ New transition request" → "Bulk upload"' : '"+ New facility scheduling request" → "Bulk upload"') + '. Downloaded ' + fmtS(st.today) + '; download a new one if people or lists changed.'],
    ['', kind === 'ct' ? 'Contacts and attachments aren\'t part of bulk upload. Add contacts on the facility page, and attach files there too.' : 'Attachments aren\'t part of bulk upload. Attach files on the facility in the New facilities tracker.'], [], ['Column', 'What goes in it'], ...cols.map(c => [c[1], c[2]])];
  lines.forEach(l => ins.addRow(l));
  ins.getRow(1).font = { bold: true, size: 14 }; ins.getRow(8).font = { bold: true };
  ['A3', 'A' + 8].forEach(a => ins.getCell(a).font = { bold: true });
  ins.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  const ws = wb.addWorksheet('Facilities', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = cols.map(c => ({ header: c[1], key: c[0], width: c[4] || 16 }));
  const hr = ws.getRow(1); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.alignment = { wrapText: true, vertical: 'middle' }; hr.height = 44;
  // no cell notes: the Excel library can't read notes back once Excel re-saves the file. The help is on the Instructions tab.
  cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: /^Already done/.test(c[1]) ? 'FF3D5A80' : 'FF003171' } }; });
  const li = wb.addWorksheet('Lists'); li.state = 'hidden';
  const names = Object.keys(L); names.forEach((n, j) => { li.getCell(1, j + 1).value = n; L[n].forEach((v, k) => li.getCell(k + 2, j + 1).value = v); });
  const ROWS = BULK_MAX + 1;
  cols.forEach((c, i) => {
    const list = c[3], letter = colLetter(i);
    let dv = null;
    if (list === 'date') dv = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2020, 0, 1))], showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Date', error: 'Type a date, like 10/26/2026.' };
    else if (list && L[list] && L[list].length) { const j = names.indexOf(list); dv = { type: 'list', allowBlank: true, formulae: ['Lists!$' + colLetter(j) + '$2:$' + colLetter(j) + '$' + (L[list].length + 1)], showErrorMessage: true, errorStyle: 'warning', errorTitle: c[1], error: 'That isn\'t on the list. You can keep it, but the upload checks it.' }; }
    if (list === 'corps') dv = null; // corporates can be new: no dropdown warning, just suggestions in the Instructions
    if (dv) ws.dataValidations.add(letter + '2:' + letter + ROWS, dv);
    if (list === 'date') ws.getColumn(i + 1).numFmt = 'm/d/yyyy';
  });
  if (L.corps.length && cols.some(c => c[3] === 'corps')) { ins.addRow([]); ins.addRow(['Corporates already in the app', L.corps.join(', ')]); ins.lastRow.getCell(1).font = { bold: true }; }
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = (kind === 'ct' ? 'Chicago transitions' : 'New facility scheduling') + ' bulk upload template.xlsx'; a.click();
}

// ---------- reading the file ----------
// a cell's value as text: dates as YYYY-MM-DD, links as their text, formulas as their result
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/i, '');
    if (v.error) return '';
    return '';
  }
  return String(v);
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const hdrKey = s => lc(String(s || '').replace(/\*/g, '')).replace(/\s+/g, ' ');
// → { rows: [{ _row: excel row number, key: text }], unknown: [headers], missing: [headers], err }
async function bulkRead(file, kind) {
  const cols = bulkCols(kind), name = lc(file.name);
  let grid = [];
  if (/\.csv$/.test(name) || file.type === 'text/csv') grid = parseCsv(await file.text());
  else if (/\.xlsx$/.test(name)) {
    const X = await loadXl(); let wb = new X.Workbook(), buf = await file.arrayBuffer();
    try { await wb.xlsx.load(buf); }
    catch (e) {
      // the Excel library trips on cell comments/notes: take them out (only in this copy) and read it again
      try { console.warn('Reading again without comments', e); buf = await xlNoComments(buf); wb = new X.Workbook(); await wb.xlsx.load(buf); }
      catch (e2) { console.error(e2); return { err: 'That file couldn\'t be read as an Excel file (.xlsx). Save it as .xlsx or .csv and try again.' }; }
    }
    const want = cols.map(c => hdrKey(c[1]));
    const ws = wb.getWorksheet('Facilities') || wb.worksheets.find(w => { const r = w.getRow(1).values || []; return r.some(v => want.includes(hdrKey(cellText(v)))); });
    if (!ws) return { err: 'No "Facilities" tab in that file. Use the template.' };
    ws.eachRow({ includeEmpty: true }, (r, i) => { const vals = []; for (let c = 1; c <= Math.max(ws.columnCount, cols.length + 5); c++) vals.push(cellText(r.getCell(c).value)); grid[i - 1] = vals; });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  } else if (/\.xls$/.test(name)) return { err: 'That\'s an old .xls file. In Excel, "Save As" → "Excel Workbook (.xlsx)", then upload that.' };
  else return { err: 'Upload the template as .xlsx or .csv.' };
  if (!grid.length) return { err: 'The file is empty.' };
  const head = grid[0].map(hdrKey), map = {}, unknown = [];
  head.forEach((h, i) => { if (!h) return; const c = cols.find(x => hdrKey(x[1]) === h || HDR_OLD[h] === x[0]); if (c) { if (map[c[0]] === undefined) map[c[0]] = i; } else unknown.push(grid[0][i]); });
  const missing = cols.filter(c => map[c[0]] === undefined).map(c => c[1]);
  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const g = grid[i] || [], o = { _row: i + 1 };
    let any = false;
    cols.forEach(c => { const v = map[c[0]] === undefined ? '' : String(g[map[c[0]]] ?? '').replace(/\s+/g, ' ').trim(); o[c[0]] = v; if (v) any = true; });
    if (any) rows.push(o);
  }
  return { rows, unknown, missing };
}

// ---------- checking ----------
function normDate(s) {
  s = String(s || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/))) [mo, d, y] = [+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
  else if (/^\d{5}(\.\d+)?$/.test(s)) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return dt.toISOString().slice(0, 10); } // Excel day number
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
// a person from the Team list (name or email); kind 'rep' = Rep / account manager, 'lead' = transition lead
function bulkPerson(v, kind) {
  if (!v) return { email: '' };
  const list = kind === 'lead' ? amList() : repList(), s = lc(v);
  const p = list.find(x => lc(x.email) === s) || list.find(x => lc(x.name) === s);
  if (p) return { email: lc(p.email) };
  const other = person(v);
  return { err: other ? '"' + v + '" isn\'t ticked as ' + (kind === 'lead' ? 'a transition lead' : '"Rep / account manager"') + ' in Settings.' : '"' + v + '" isn\'t on the Team list in Settings. Use the name exactly as it is there.' };
}
const yesNo = v => !v ? false : YES.test(v) ? true : NO.test(v) ? false : null;
// wound rep / regional emails → names from the company address book (cached per upload)
async function bulkLookups(rows) {
  const want = [...new Set(rows.flatMap(r => [r.wound, r.regional, r.ctl]).filter(e => e && validEmail(e)).map(lc))];
  const cache = ui.bulk.look = ui.bulk.look || {};
  for (const e of want) {
    if (e in cache) continue;
    try { const res = await STORE.searchPeople(e); const hit = res.find(p => lc(p.email) === e); cache[e] = hit ? { name: hit.name, email: e } : null; }
    catch (err) { cache[e] = { err: err.message || String(err) }; }
  }
}
// → [{ row, v (what gets saved), errs: [], warns: [] }]
function bulkCheck(kind, rows) {
  const out = rows.map(r => ({ row: r._row, raw: r, v: {}, errs: [], warns: [] }));
  if (!rows.length) return out;
  return kind === 'ct' ? ctCheck(out) : nfCheck(out);
}
function ctCheck(out) {
  const look = (ui.bulk && ui.bulk.look) || {};
  out.forEach(o => {
    const r = o.raw, E = s => o.errs.push(s), v = o.v;
    v.name = r.name; if (!v.name) E('"Facility (Chicago name)" is empty.');
    v.address = ''; v.state = '';
    if (r.addr) { const pr = addressFormatProblem(r.addr); if (pr) E('Address: ' + pr); else { v.address = normAddr(r.addr); v.state = stateFrom(v.address); if (!stateOK(v)) o.warns.push('There\'s no ship point for ' + v.state + ' in Settings. The transition lead gets an "Address" task until there is.'); } }
    const c3 = r.corp; v.none = /^(none|no corporate|standalone)$/i.test(c3); v.unknown = !c3 || c3 === '?';
    v.group = v.none ? v.name : v.unknown ? '' : c3;
    if (v.group && grp(v.group)) v.group = grp(v.group).name;
    else if (v.group && !v.none) { const firstSpelling = out.find(x => x.v.group && !x.v.none && lc(x.v.group) === lc(v.group)); if (firstSpelling) v.group = firstSpelling.v.group; } // same corporate typed in different case: 1 corporate
    v.why = r.why;
    v.cov = {};
    AREAS.forEach(a => { const x = r['cov_' + a]; if (!x || lc(x) === 'not sure') return; const m = covOpts(a).find(o2 => lc(o2) === lc(x)); if (!m) E(a + ': "' + x + '" isn\'t an option (' + covOpts(a).join(', ') + ', Not sure).'); else v.cov[a] = m; });
    v.ctl = null;
    if (r.ctl) { const L = 'Gentell WC Transition Lead email', hit = look[lc(r.ctl)]; if (!validEmail(r.ctl)) E(L + ': "' + r.ctl + '" isn\'t an email address.'); else if (hit === undefined) E(L + ': not looked up yet.'); else if (hit && hit.err) E(L + ': couldn\'t check the address book (' + hit.err + ').'); else if (!hit) E(L + ': ' + r.ctl + ' isn\'t in the company address book.'); else v.ctl = hit; }
    for (const [k, kind] of [['acct', 'rep'], ['rep', 'rep'], ['am', 'lead']]) { const p = bulkPerson(r[k], kind); if (p.err) E(({ acct: 'Account manager', rep: 'Intake rep', am: 'Transition lead' })[k] + ': ' + p.err); v[k] = p.email || ''; }
    if (v.rep && isAutoAcct(v.acct)) E('Intake rep: leave it blank. The account manager is ' + nameOf(v.acct) + ', so the intake rep is picked at scheduling.');
    // already done
    const picked = [];
    BULK_PRE.forEach(k => { const yn = yesNo(r['pre_' + k]); if (yn === null) E('"Already done: ' + PRE_HDR[k] + '": "' + r['pre_' + k] + '" should be Yes or blank.'); else if (yn) picked.push(k); });
    v.pre = {}; stepChain(picked).forEach(k => v.pre[k] = true); const keys = Object.keys(v.pre);
    v.implied = keys.filter(k => !picked.includes(k));
    // details only go with their step (the form only shows them then)
    const only = (fields, step, label) => { if (!keys.includes(step)) fields.forEach(f => { if (r[f]) E('"' + CT_COLS.find(c => c[0] === f)[1] + '" is filled, but "Already done: ' + label + '" isn\'t Yes. Clear it, or put Yes there.'); }); };
    only(['pn'], 'added', PRE_HDR.added); only(['gdd', 'gddWh'], 'gdd', PRE_HDR.gdd); only(['wound', 'regional'], 'wr', PRE_HDR.wr); only(['ord', 'dos', 'del', 'cad'], 'sched', PRE_HDR.sched);
    const i = { pn: r.pn, gdd: '', gddWh: '', wound: null, regional: null, ord: '', dos: '', del: '', cad: '' };
    if (r.gdd) { const yn = yesNo(r.gdd); if (yn === null) E('"GDD orders?" should be Yes or No.'); else i.gdd = yn ? 'Yes' : 'No'; }
    if (r.gddWh) { const w = st.settings.warehouses.find(x => lc(x) === lc(r.gddWh)); if (!w) E('GDD warehouse: "' + r.gddWh + '" isn\'t on the warehouse list in Settings.'); else i.gddWh = w; }
    if (i.gdd === 'No' && r.gddWh) E('"GDD orders?" is No, so leave the GDD warehouse blank.');
    for (const k of ['wound', 'regional']) {
      const e = r[k]; if (!e) continue; const L = k === 'wound' ? 'Wound rep email' : 'Regional email';
      if (!validEmail(e)) { E(L + ': "' + e + '" isn\'t an email address.'); continue; }
      const hit = look[lc(e)];
      if (hit === undefined) E(L + ': not looked up yet.'); else if (hit && hit.err) E(L + ': couldn\'t check the address book (' + hit.err + ').'); else if (!hit) E(L + ': ' + e + ' isn\'t in the company address book.'); else i[k] = hit;
    }
    for (const k of ['ord', 'dos', 'del']) { if (!r[k]) continue; const d = normDate(r[k]); if (!d) E('"' + CT_COLS.find(c => c[0] === k)[1] + '": "' + r[k] + '" isn\'t a date.'); else i[k] = d; }
    if (r.cad) { const c = ['Monthly', 'Weekly', 'Biweekly'].find(x => lc(x) === lc(r.cad)); if (!c) E('"Enteral ships" should be Monthly, Weekly or Biweekly.'); else i.cad = c; }
    v.info = i;
    if (!o.errs.length) { const pe = preInfoProblem(keys, i) || schedPast(keys, i); if (pe) E(pe.replace(/^"Scheduled": /, '"Already done: Scheduled": ')); }
    // same rules as the request form
    if (v.pre.wr && v.unknown) E('"Already done: FastCare info gathered" needs the corporate (FastCare is where the transition lead would find it).');
    if (v.pre.wr && !v.address && !v.pre.added) E('"Already done: FastCare info gathered" needs the address: Amy needs it to add the facility to Brightree. Add it, or put Yes in "Already done: Added to Brightree".');
    if (v.pre.corp && v.unknown) E('"Already done: Corporate set up in the portal" needs the corporate.');
    const dup = st.facs.find(f => !f.archived && !f.complete && lc(f.name) === lc(v.name));
    if (dup) o.warns.push('Already in the tracker (CT-' + pad(dup.id) + '). Upload only if this really is a new request.');
  });
  // within the file: same facility twice, and corporates that disagree with each other or with the app
  const byName = {}; out.forEach(o => { if (o.v.name) (byName[lc(o.v.name)] = byName[lc(o.v.name)] || []).push(o); });
  Object.values(byName).filter(a => a.length > 1).forEach(a => a.forEach(o => o.errs.push('This facility is in the file ' + a.length + ' times (rows ' + a.map(x => x.row).join(', ') + ').')));
  const byCorp = {}; out.forEach(o => { if (o.v.group && !o.v.none) (byCorp[lc(o.v.group)] = byCorp[lc(o.v.group)] || []).push(o); });
  Object.values(byCorp).forEach(a => {
    const g = grp(a[0].v.group);
    AREAS.forEach(ar => {
      const vals = [...new Set(a.map(o => o.v.cov[ar]).filter(Boolean))];
      if (vals.length > 1) a.filter(o => o.v.cov[ar]).forEach(o => o.errs.push(ar + ': rows of ' + a[0].v.group + ' say different things (' + vals.join(' / ') + '). Areas of care are per corporate: make them the same, or "Not sure".'));
      else if (vals.length && g && g.cov && g.cov[ar] && g.cov[ar] !== vals[0]) a.filter(o => o.v.cov[ar]).forEach(o => o.errs.push(ar + ': ' + g.name + ' already has "' + g.cov[ar] + '" in the app, and this says "' + vals[0] + '". Change it on the corporate page first, or put "Not sure".'));
    });
    const cs = [...new Set(a.map(o => !!o.v.pre.corp))]; if (cs.length > 1) a.forEach(o => o.errs.push('"Already done: Corporate set up in the portal" is for the whole corporate: every row of ' + a[0].v.group + ' needs the same answer.'));
  });
  return out;
}
function nfCheck(out) {
  out.forEach(o => {
    const r = o.raw, E = s => o.errs.push(s), v = o.v;
    v.name = r.name; v.corp = r.corp; v.addr = r.addr;
    // a corporate already in the app (or earlier in the file) typed in different case: use that spelling
    if (v.corp) { const known = [...Object.values(st.groups).map(g => g.name), ...nfs().filter(n => !n.deleted).map(n => n.group), ...out.filter(x => x.v.corp).map(x => x.v.corp)].find(c => c && lc(c) === lc(v.corp)); if (known) v.corp = known; }
    v.pb = ''; if (r.pb) { const yn = yesNo(r.pb); if (yn === null || r.pb === '') E('"Part B only" should be Yes or No.'); else v.pb = yn ? 'yes' : 'no'; }
    const np = yesNo(r.noPrev); if (np === null) E('"No previous provider" should be Yes or blank.'); v.noPrev = !!np;
    v.last = ''; if (r.last) { const d = normDate(r.last); if (!d) E('"Last supply date with previous provider": "' + r.last + '" isn\'t a date.'); else v.last = d; }
    if (v.noPrev && v.last) E('Fill "Last supply date with previous provider" or "No previous provider", not both.');
    v.cad = '4'; if (r.cad) { const c = ['Monthly', 'Weekly', 'Biweekly'].find(x => lc(x) === lc(r.cad)); if (!c) E('"Enteral ships" should be Monthly, Weekly or Biweekly.'); else v.cad = CAD_V[c]; }
    for (const [k, kind] of [['acct', 'rep'], ['rep', 'rep'], ['lead', 'lead']]) { const p = bulkPerson(r[k], kind); if (p.err) E(({ acct: 'Account manager', rep: 'Intake rep', lead: 'Schedule lead' })[k] + ': ' + p.err); v[k] = p.email || ''; }
    if (v.rep && isAutoAcct(v.acct)) E('Intake rep: leave it blank. The account manager is ' + nameOf(v.acct) + ', so the intake rep is picked at scheduling.');
    // the form's messages, worded for the spreadsheet
    const NF_MSG = { 'Type the facility name.': '"Facility name" is empty.', 'Type the corporate. No corporate? Type the facility name.': '"Corporate" is empty. No corporate? Put the facility name.', 'Type the address.': '"Address" is empty.', 'Pick "Part B only" or "Not Part B only".': '"Part B only" is empty: Yes or No.', 'Enter the last supply date with the previous provider, or tick "No previous provider".': 'Fill "Last supply date with previous provider", or put Yes in "No previous provider".' };
    if (!o.errs.length) { const pr = nfProblem(v); if (pr) E(NF_MSG[pr] || pr); }
    const dup = nfs().find(n => !n.deleted && lc(n.name) === lc(v.name)) || st.facs.find(f => !f.archived && !f.complete && (lc(f.name) === lc(v.name) || lc(f.portalName) === lc(v.name)));
    if (dup && v.name) o.warns.push('"' + v.name + '" is already in the app (' + (dup.req ? 'CT-' + pad(dup.id) + ', Chicago transitions' : nfNo(dup) + ', new facilities') + '). Upload only if this really is a new request.');
  });
  const byName = {}; out.forEach(o => { if (o.v.name) (byName[lc(o.v.name)] = byName[lc(o.v.name)] || []).push(o); });
  Object.values(byName).filter(a => a.length > 1).forEach(a => a.forEach(o => o.errs.push('This facility is in the file ' + a.length + ' times (rows ' + a.map(x => x.row).join(', ') + ').')));
  return out;
}

// ---------- building (the dry run and the real upload use exactly this) ----------
function ctBuild(checked, ids) {
  const req = { key: 'req:' + pad(ids[0]), by: me(), byName: meName(), at: st.today, why: '', files: [], facIds: ids, bulk: true };
  st.reqs.push(req);
  const created = checked.map((o, i) => {
    const v = o.v;
    if (v.group) { const g = ensureGroup(v.group, v.none); if (v.pre.corp && !g.price) g.existing = true; g.cov = Object.assign({}, v.cov, g.cov || {}); }
    const f = { id: ids[i], req: req.key, name: v.name, address: v.address, state: v.state, group: v.group ? grp(v.group).name : '', pendingCov: Object.assign({}, v.cov), rep: v.rep, clin: v.rep, am: v.am, acct: v.acct, contacts: [], requested: st.today, requester: me(), why: v.why, files: [], bulkRow: o.row };
    if (v.ctl) f.ctl = Object.assign({}, v.ctl);
    applyPre(f, Object.assign({}, v.pre), { name: v.name }, v.info);
    st.facs.push(f); return f;
  });
  // "New transition" once per transition lead; "Request received" if the uploader isn't one of them
  const lead = f => lc(f.am || (f.group ? G(f).am : '') || ''), byAm = {};
  created.forEach(f => { const a = lead(f); if (a) (byAm[a] = byAm[a] || []).push(f); });
  const tbl = list => '<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Facility</th><th>Corporate</th><th>Reason</th><th>Already done</th></tr>' + list.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.group || 'not known yet')}</td><td>${esc(f.why) || '-'}</td><td>${esc(preList(f).join(', ')) || '-'}</td></tr>`).join('') + '</table>';
  Object.entries(byAm).forEach(([a, list]) => mail({ key: 'm:E2:' + req.key + ':' + a, code: 'E2', to: [a], link: 'none', subject: 'New transition: ' + (list.length > 3 ? list.length + ' facilities' : list.map(f => f.name).join(', ')),
    body: `<p>${list.length} facilit${list.length > 1 ? 'ies' : 'y'}, uploaded by ${esc(meName())}.</p>${tbl(list)}${amFirstTasks(list)}` }));
  if (!byAm[me()]) mail({ key: 'm:E1:' + req.key, code: 'E1', to: [me()], link: 'none', fyi: true, subject: 'Upload received: ' + created.length + ' facilit' + (created.length > 1 ? 'ies' : 'y'), body: `<p>Got it. ${created.map(f => esc(f.name) + ' (CT-' + pad(f.id) + ')').join(', ')}.</p><p>You'll get an email if anything is needed from you.</p>` });
  return created;
}
function nfBuild(checked, ids) {
  return checked.map((o, i) => { const v = o.v, a = normAddr(v.addr); const n = { id: ids[i], name: v.name, address: a, state: stateFrom(a), group: v.corp, partB: v.pb === 'yes', last: v.last, noPrev: v.noPrev, cad: v.cad, acct: v.acct, rep: isAutoAcct(v.acct) ? '' : v.rep, lead: v.lead, requested: st.today, requester: me(), requesterName: meName(), bulkRow: o.row }; st.nfs.push(n); return n; });
}
// the dry run: on a copy of everything, build + run(), note what got made, then put the real data back
function bulkDry(kind, checked) {
  const keep = st, keepPending = pending.slice();
  const out = { byId: {}, corp: {}, ok: true };
  try {
    st = JSON.parse(JSON.stringify(keep)); st.demo = keep.demo;
    const tBefore = new Set(st.tasks.map(t => t.key)), mBefore = new Set(st.mails.map(m => m.key));
    const top = Math.max(0, ...st.facs.map(f => f.id), ...(st.nfs || []).map(n => n.id), st.settings.nextCt || 0) + 100000;
    const ids = checked.map((_, i) => top + i);
    const made = kind === 'ct' ? ctBuild(checked, ids) : nfBuild(checked, ids);
    run();
    // reminders are queued ahead for every task; they're not worth listing (they're cancelled once the task is done)
    const nt = st.tasks.filter(t => !tBefore.has(t.key)), nm = st.mails.filter(m => !mBefore.has(m.key) && m.status !== 'Cancelled' && m.code !== 'E17');
    const strip = s => String(s || '').replace(/^\[CT-\d+\]\s*/, '');
    made.forEach((x, i) => {
      const mine = nt.filter(t => kind === 'ct' ? t.fac === x.id : t.nf === x.id);
      const mails = nm.filter(m => (kind === 'ct' && m.fac === x.id) || (m.task && mine.some(t => t.key === m.task)));
      out.byId[checked[i].row] = { obj: JSON.parse(JSON.stringify(x)), tasks: mine.map(t => ({ title: taskTitle(t), who: nameOf(t.assignee), due: t.due, opens: t.opensOn && t.opensOn > st.today ? t.opensOn : '' })), mails: mails.map(m => ({ subj: strip(m.subject), to: m.to.map(nameOf).join(', '), day: m.day > st.today ? m.day : '' })) };
    });
    // corporate tasks (areas of care, price table, pick the reps, EMR access) and emails not tied to 1 facility
    nt.filter(t => !t.fac && !t.nf).forEach(t => { const k = t.group === '__nocorp' ? 'No corporate yet' : t.group; (out.corp[k] = out.corp[k] || { tasks: [], mails: [] }).tasks.push({ title: taskTitle(t), who: nameOf(t.assignee), due: t.due }); });
    nm.filter(m => !m.fac && !(m.task && nt.some(t => (t.fac || t.nf) && t.key === m.task)) && !(m.task && nt.some(t => !t.fac && !t.nf && t.key === m.task))).forEach(m => { (out.corp['Emails'] = out.corp['Emails'] || { tasks: [], mails: [] }).mails.push({ subj: strip(m.subject), to: m.to.map(nameOf).join(', ') }); });
    nm.filter(m => m.task && nt.some(t => !t.fac && !t.nf && t.key === m.task)).forEach(m => { const t = nt.find(x => x.key === m.task), k = t.group === '__nocorp' ? 'No corporate yet' : t.group; (out.corp[k] = out.corp[k] || { tasks: [], mails: [] }).mails.push({ subj: strip(m.subject), to: m.to.map(nameOf).join(', ') }); });
  } catch (e) { console.error(e); out.ok = false; out.err = e.message || String(e); }
  finally { st = keep; pending.length = 0; keepPending.forEach(p => pending.push(p)); }
  return out;
}

// ---------- the screen ----------
function bulkReset(kind) { ui.bulk = { kind, file: '', read: null, checked: null, dry: null, busy: false, msg: '', look: {}, ok: false }; }
function bulkHtml(kind) {
  if (!ui.bulk || ui.bulk.kind !== kind) bulkReset(kind);
  const B = ui.bulk, back = kind === 'ct' ? 'new' : 'nfnew';
  const head = `<h1>Bulk upload: ${BULK_TITLE[kind]}</h1><p class="sub">Many facilities at once, from any number of corporates. Fill the template, upload it, check the preview of every facility, then approve. Nothing is saved until you approve.</p>
  <div class="row" style="margin-bottom:10px"><button class="btn sm" data-view="${back}">← Back to the single request</button></div>
  <div class="card"><div class="row" style="align-items:center;gap:12px"><b>1. Get the template</b><button class="btn sm pri" data-bulktpl="${kind}">Download the template (Excel)</button><span class="meta">Dropdowns for people and lists. You can type or paste over them; it's all checked on upload. ${kind === 'ct' ? 'Contacts and attachments go on the facility page afterwards.' : 'Attachments go on the facility afterwards (New facilities tracker).'}</span></div></div>
  <div class="card" style="margin-top:10px"><b>2. Upload it</b><div class="drop" id="bulk_drop" data-bulkdrop="${kind}" tabindex="0" style="margin-top:8px"><b>Drag the file here</b> or <label class="linkish" for="bulk_file">browse</label> (.xlsx or .csv)<input type="file" id="bulk_file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>${B.file ? `<div class="meta" style="margin-top:6px">File: <b>${esc(B.file)}</b>${B.read && B.read.rows ? ' · ' + B.read.rows.length + ' facilit' + (B.read.rows.length === 1 ? 'y' : 'ies') : ''}</div>` : ''}${B.busy ? '<div class="meta" style="margin-top:6px"><span class="spin" aria-hidden="true"></span> ' + esc(B.msg || 'Reading…') + '</div>' : ''}${B.err ? '<div class="err" style="margin-top:6px">' + esc(B.err) + '</div>' : ''}</div>`;
  return head + (B.checked ? bulkPreview(kind) : '');
}
const pv = (l, v) => `<div>${l}</div><div>${v}</div>`;
function bulkPreview(kind) {
  const B = ui.bulk, C = B.checked, nErr = C.filter(o => o.errs.length).length, nWarn = C.filter(o => o.warns.length).length;
  const corps = [...new Set(C.map(o => lc((kind === 'ct' ? o.v.group : o.v.corp) || '(corporate not known yet)')))];
  const fileNote = [...(B.read.unknown.length ? ['Columns the app doesn\'t use (ignored): ' + B.read.unknown.map(esc).join(', ') + '.'] : []), ...(B.read.missing.length ? ['Columns missing from the file (taken as blank): ' + B.read.missing.map(esc).join(', ') + '. Download a new template if it\'s old.'] : [])];
  const sum = `<div class="card" style="margin-top:10px"><b>3. Check every facility</b><div style="margin-top:6px">${C.length} facilit${C.length === 1 ? 'y' : 'ies'} · ${corps.length} corporate${corps.length === 1 ? '' : 's'}${nErr ? ` · <span class="errtxt"><b>${nErr} with problems</b></span>` : ' · no problems'}${nWarn ? ` · ${nWarn} with warnings` : ''}</div>${fileNote.map(x => '<div class="meta">' + x + '</div>').join('')}${nErr ? '<div class="note">Fix the rows marked in red in the file, then upload it again. Nothing was saved.</div>' : ''}${B.dry && !B.dry.ok ? '<div class="err">The preview of the tasks couldn\'t be worked out: ' + esc(B.dry.err) + '. Nothing was saved. Send Raizy a screenshot.</div>' : ''}</div>`;
  const cards = C.map(o => kind === 'ct' ? ctCard(o) : nfCard(o)).join('');
  const corpBox = B.dry && Object.keys(B.dry.corp).length ? `<div class="card" style="margin-top:10px"><b>Corporate tasks and other emails</b><div class="meta">Made right away for the corporates in this upload (not for 1 facility).</div>${Object.entries(B.dry.corp).map(([k, x]) => `<div style="margin-top:6px"><b>${esc(k)}</b>${x.tasks.map(t => `<div class="meta">Task: ${esc(t.title)} → ${esc(t.who)}, due ${fmtS(t.due)}</div>`).join('')}${x.mails.map(m => `<div class="meta">Email: ${esc(m.subj)} → ${esc(m.to)}</div>`).join('')}</div>`).join('')}</div>` : '';
  const can = !nErr && B.dry && B.dry.ok && C.length;
  const approve = `<div class="card" style="margin-top:10px"><b>4. Approve</b>${can ? `${nWarn ? chk('bulk_warnok', 'I checked the warnings above, and these are new requests') : ''}${chk('bulk_ok', 'I checked every facility above. Save all ' + C.length + ' and start their tasks.')}<div id="bulk_err"></div><div class="row" style="margin-top:8px"><button class="btn pri" id="bulk_go">Upload ${C.length} facilit${C.length === 1 ? 'y' : 'ies'}</button></div>` : `<div class="meta" style="margin-top:4px">${C.length ? 'Fix the problems first. Nothing is saved until every facility is OK.' : 'The file has no facilities.'}</div>`}</div>`;
  return sum + `<div class="list" style="margin-top:10px">${cards}</div>` + corpBox + approve;
}
function bulkMsgs(o) { return o.errs.map(e => '<div class="err" style="margin-top:4px">' + esc(e) + '</div>').join('') + o.warns.map(w => '<div class="note" style="margin-top:4px">⚠ ' + esc(w) + '</div>').join(''); }
function bulkMade(o) {
  const d = ui.bulk.dry && ui.bulk.dry.byId[o.row]; if (!d) return '';
  return `<div class="sect" style="margin-top:6px">Right away${tip('The tasks and emails this facility sets off as soon as it\'s uploaded. Reminders follow automatically if a task isn\'t done on time. Later tasks come as earlier steps finish.')}</div>${d.tasks.length ? d.tasks.map(t => `<div class="meta">Task: <b>${esc(t.title)}</b> → ${esc(t.who)}, due ${fmtS(t.due)}${t.opens ? ' (starts ' + fmtS(t.opens) + ')' : ''}</div>`).join('') : '<div class="meta">No tasks yet (they come as earlier steps finish).</div>'}${d.mails.map(m => `<div class="meta">Email: ${esc(m.subj)} → ${esc(m.to)}${m.day ? ' (on ' + fmtS(m.day) + ')' : ''}</div>`).join('')}`;
}
function ctCard(o) {
  const v = o.v, d = ui.bulk.dry && ui.bulk.dry.byId[o.row], f = d ? d.obj : null, g = v.group ? grp(v.group) : null;
  const pre = Object.keys(v.pre).map(k => PRE_HDR[k] + (v.implied.includes(k) ? ' (included)' : ''));
  const i = v.info || {}, cov = AREAS.map(a => a + ': ' + (v.cov[a] || (g && g.cov && g.cov[a] ? g.cov[a] + ' (corporate\'s)' : 'not sure'))).join(' · ');
  const repTxt = v.rep ? nameOf(v.rep) : isAutoAcct(v.acct) ? 'picked at scheduling' : (g && g.rep ? nameOf(g.rep) + ' (corporate rule)' : 'not picked: ' + roleName('rules') + ' picks');
  return `<div class="card ${o.errs.length ? 'bulkbad' : ''}" style="padding:10px"><div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(v.name || '(no name)')}</b><span class="meta">Row ${o.row}</span></div>${bulkMsgs(o)}
  <div class="kv" style="margin-top:6px">${pv('Address', v.address ? esc(v.address) : '<span class="meta">none (found on the FastCare task)</span>')}${pv('Corporate', v.none ? esc(v.group) + ' <span class="tag">no corporate</span>' : v.unknown ? '<span class="meta">not known yet (FastCare task)</span>' : esc(v.group) + (g ? ' <span class="meta">(already in the app)</span>' : ' <span class="tag">new to the app</span>'))}${pv('Reason', esc(v.why) || '-')}${pv('Areas of care', esc(cov))}${pv('Account manager', esc(nameOf(v.acct)) || '-')}${pv('Intake rep', esc(repTxt))}${pv('Transition lead', esc(nameOf(v.am)) || (g && g.am ? esc(nameOf(g.am)) + ' (corporate rule)' : '<span class="meta">' + esc(nameOf(fallbackOwner())) + ' (nobody picked)</span>'))}${pv('Gentell WC Transition Lead', v.ctl ? esc(v.ctl.name) : '<span class="meta">' + esc(roleName('rules')) + ' picks one</span>')}${pv('Already done', pre.length ? esc(pre.join(', ')) : '-')}${i.pn ? pv('Brightree name', esc(i.pn)) : ''}${i.gdd ? pv('GDD orders', esc(i.gdd) + (i.gddWh ? ' (' + esc(i.gddWh) + ')' : '')) : ''}${i.wound ? pv('Wound rep / regional', esc(i.wound.name) + ' / ' + esc(i.regional ? i.regional.name : '-')) : ''}${i.ord ? pv('Scheduled', 'Ordering ' + fmtS(i.ord) + ' · DOS ' + fmtS(i.dos) + ' · delivery ' + fmtS(i.del) + ' · enteral ' + esc(i.cad || 'Monthly')) : ''}${f && f.dates && !i.ord ? pv('Dates now', 'Ordering ' + fmtS(f.dates.ord) + ' · DOS ' + fmtS(f.dates.dos)) : ''}</div>${o.errs.length ? '' : bulkMade(o)}</div>`;
}
function nfCard(o) {
  const v = o.v, d = ui.bulk.dry && ui.bulk.dry.byId[o.row], n = d ? d.obj : null;
  const need = n ? nfNeeds(n) : [];
  return `<div class="card ${o.errs.length ? 'bulkbad' : ''}" style="padding:10px"><div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(v.name || '(no name)')}</b><span class="meta">Row ${o.row}</span></div>${bulkMsgs(o)}
  <div class="kv" style="margin-top:6px">${pv('Corporate', esc(v.corp) || '-')}${pv('Address', esc(v.addr ? normAddr(v.addr) : '') || '-')}${pv('Part B only', v.pb === 'yes' ? 'Yes' : v.pb === 'no' ? 'No' : '-')}${pv('Previous provider', v.noPrev ? 'None (as soon as possible)' : v.last ? 'Last supply ' + fmt(v.last) : '-')}${pv('Enteral ships', esc(CAD_L[v.cad] || 'Monthly'))}${pv('Account manager', esc(nameOf(v.acct)) || '<span class="meta">blank</span>')}${pv('Intake rep', v.rep ? esc(nameOf(v.rep)) : isAutoAcct(v.acct) ? 'picked at scheduling' : '<span class="meta">blank</span>')}${pv('Schedule lead', esc(nameOf(v.lead)) || '<span class="meta">blank</span>')}${n && n.dates ? pv('Recommended', 'Ordering ' + fmt(n.dates.ord) + ' · DOS ' + fmt(n.dates.dos) + ' · delivery ' + fmt(n.dates.del)) : ''}${need.length ? pv('Still needed', esc(need.map(k => NF_POS.find(x => x[0] === k)[1]).join(', ')) + ' (' + esc(roleName('rules')) + ' picks)') : ''}</div>${o.errs.length ? '' : bulkMade(o)}</div>`;
}
async function bulkFile(kind, file) {
  if (!file) return;
  bulkReset(kind); const B = ui.bulk; B.file = file.name; B.busy = true; B.msg = 'Reading the file…'; render();
  try {
    const r = await bulkRead(file, kind);
    if (r.err) { B.err = r.err; return; }
    if (r.missing.includes(bulkCols(kind)[0][1])) { B.err = 'This doesn\'t look like the ' + BULK_TITLE[kind].toLowerCase() + ' template: there\'s no "' + bulkCols(kind)[0][1] + '" column. Download the template above.'; return; }
    if (r.rows.length > BULK_MAX) { B.err = r.rows.length + ' facilities is more than ' + BULK_MAX + ' at once. Split it into smaller files.'; return; }
    B.read = r;
    if (kind === 'ct') { B.msg = 'Looking up the wound reps and regionals…'; render(); await bulkLookups(r.rows); }
    B.msg = 'Checking every facility…'; render();
    await STORE.load(); // check against the latest data
    run();
    B.checked = bulkCheck(kind, r.rows);
    B.dry = B.checked.length && !B.checked.some(o => o.errs.length) ? bulkDry(kind, B.checked) : B.checked.length ? bulkDry(kind, B.checked.filter(o => !o.errs.length)) : null;
  } catch (e) { console.error(e); B.err = 'Couldn\'t read the file: ' + (e.message || e); }
  finally { B.busy = false; render(); }
}
async function bulkGo(kind) {
  const B = ui.bulk, box = document.getElementById('bulk_err');
  if (!V('bulk_ok') || (document.getElementById('bulk_warnok') && !V('bulk_warnok'))) { box.innerHTML = '<div class="err">Tick ' + (document.getElementById('bulk_warnok') ? 'both boxes' : 'the box') + ' to approve.</div>'; return; }
  let problem = '', made = [];
  const ok = await act(async () => {
    run();
    const again = bulkCheck(kind, B.read.rows); // the latest data (someone may have changed a corporate since the preview)
    if (again.some(o => o.errs.length)) { B.checked = again; B.dry = bulkDry(kind, again.filter(o => !o.errs.length)); problem = 'Something changed since the preview, and some rows have problems now. Check them below. Nothing was saved.'; return false; }
    const ids = await STORE.allocateIds(again.length);
    made = kind === 'ct' ? ctBuild(again, ids) : nfBuild(again, ids);
  }, 'Uploaded ' + B.read.rows.length + ' facilities');
  if (problem) { render(); toast(problem); const b = document.getElementById('bulk_err'); if (b) b.innerHTML = '<div class="err">' + esc(problem) + '</div>'; return; }
  if (ok && !ui.errors.length) { const n = made.length; bulkReset(''); ui.view = kind === 'ct' ? 'tracker' : 'nftracker'; render(); toast('Uploaded ' + n + ' facilit' + (n === 1 ? 'y' : 'ies') + '. Their tasks went out.'); }
}

// ---------- attachments on a facility (Chicago facility page, new facility page) ----------
function attachCard(kind, x) {
  const files = x.files || [];
  return `<div class="card" style="padding:10px"><b>Attachments</b>${tip('PDFs, docs, or emails saved from Outlook first. Saved in SharePoint in this facility\'s folder, and linked on its tasks.')}${files.length ? `<div style="margin-top:6px">${files.map(f => `<div><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>${f.by ? ' <span class="meta">added by ' + esc(f.by) + (f.on ? ' ' + fmtS(f.on) : '') + '</span>' : ''}</div>`).join('')}</div>` : '<div class="meta" style="margin-top:4px">None yet.</div>'}
  <div class="drop" data-attdrop="${kind}:${x.id}" tabindex="0" style="margin-top:8px;padding:10px"><b>Drag files here</b> or <label class="linkish" for="att_${kind}_${x.id}">browse</label><input type="file" id="att_${kind}_${x.id}" data-attfile="${kind}:${x.id}" multiple hidden></div></div>`;
}
async function attachFiles(spec, list) {
  const [kind, sid] = spec.split(':'), id = +sid, files = [...(list || [])]; if (!files.length) return;
  const folder = kind === 'nf' ? 'NF-' + pad(id) : 'CT-' + pad(id);
  await act(async () => {
    const x = kind === 'nf' ? nfById(id) : facById(id); if (!x) return false;
    const saved = [];
    for (const f of files) { const r = await STORE.uploadFile(folder, f); saved.push({ name: r.name, url: r.url, path: r.path, by: meName(), on: st.today }); }
    x.files = [...(x.files || []), ...saved];
  }, files.length === 1 ? 'Attached ' + files[0].name : 'Attached ' + files.length + ' files');
}

// ---------- clicks, files ----------
document.addEventListener('click', async e => {
  const t = e.target.closest && e.target.closest('[data-bulktpl]'); if (t) { const b = t; btnLoading(b, true, 'Making the template…'); try { await bulkTemplate(t.dataset.bulktpl); } catch (err) { toast(err.message || String(err)); } finally { btnLoading(b, false); } return; }
  if (e.target.id === 'bulk_go' && ui.bulk) { await bulkGo(ui.bulk.kind); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'bulk_file' && e.target.files[0] && ui.bulk) { const f = e.target.files[0]; e.target.value = ''; bulkFile(ui.bulk.kind, f); }
  const a = e.target.dataset && e.target.dataset.attfile; if (a && e.target.files.length) attachFiles(a, e.target.files);
});
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('[data-bulkdrop],[data-attdrop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('[data-bulkdrop],[data-attdrop]'); if (z) z.classList.remove('over'); });
document.addEventListener('drop', e => {
  const z = e.target.closest && e.target.closest('[data-bulkdrop],[data-attdrop]'); if (!z) return; e.preventDefault(); z.classList.remove('over');
  const fl = e.dataTransfer && e.dataTransfer.files;
  if (!fl || !fl.length) { toast('Outlook didn\'t hand over a file. Save it to your desktop first, then drag that file here.'); return; }
  if (z.dataset.bulkdrop) bulkFile(z.dataset.bulkdrop, fl[0]); else attachFiles(z.dataset.attdrop, fl);
});
