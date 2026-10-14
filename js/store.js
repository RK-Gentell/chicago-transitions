'use strict';
/* =====================================================================
   Saving and loading.
   - SharePoint mode (normal): data lives in 4 SharePoint lists on the
     site in config.js. Sign-in is the person's Microsoft account.
       CT Data     1 row per facility, corporate, task, request + 1 settings row (JSON in "Data")
       CT Outbox   1 row per email. The "CT - Send emails" flow sends them.
       CT Inbox    1 row per email that arrived in the shared mailbox (the "CT - Mailbox" flow adds them)
       CT Numbers  1 row per facility; its ID is the facility's CT number
   - Demo mode (?demo, or no clientId in config.js): everything in memory.
   Every save re-reads each changed row first and only writes the parts this
   person changed, so 2 people working on the same facility don't overwrite
   each other. Rows that must exist once (tasks, emails) have a unique Key,
   so if 2 people's screens create the same task at the same moment, it's
   only saved once.
   ===================================================================== */

const LISTS = {
  data: { name: 'CT Data', cols: [['Key', 'text', 1, 1], ['Kind', 'text', 1], ['Data', 'note'], ['Ct', 'text', 1], ['Am', 'text'], ['Archived', 'text', 1]] },
  outbox: { name: 'CT Outbox', cols: [['Key', 'text', 1, 1], ['Code', 'text'], ['ToList', 'note'], ['CcList', 'note'], ['Subject', 'text'], ['HtmlBody', 'note'], ['SendOn', 'date', 1], ['SendStatus', 'text', 1], ['Facility', 'text', 1], ['TaskKey', 'text'], ['Cond', 'note'], ['ErrorText', 'note'], ['Importance', 'text'], ['AttachPath', 'note'], ['AttachName', 'text'], ['AttachPath2', 'note'], ['AttachName2', 'text']] },
  inbox: { name: 'CT Inbox', cols: [['FromAddress', 'text'], ['ToAddresses', 'note'], ['CcAddresses', 'note'], ['Received', 'date', 1], ['Preview', 'note'], ['FilePath', 'note'], ['Processed', 'text'], ['Facility', 'text']] },
  numbers: { name: 'CT Numbers', cols: [] }
};
const OUTBOX_DAYS = 60, INBOX_DAYS = 120;

// ---------- turning state into rows and back ----------
function dataRecords() {
  const out = [];
  out.push({ key: 'settings', kind: 'settings', obj: st.settings });
  Object.values(st.groups).forEach(g => out.push({ key: g.key, kind: 'grp', obj: g }));
  st.facs.forEach(f => out.push({ key: 'fac:' + pad(f.id), kind: 'fac', obj: f, cols: { Ct: 'CT-' + pad(f.id), Am: amOf(f), Archived: f.archived ? 'Yes' : 'No' } }));
  st.tasks.forEach(t => out.push({ key: t.key, kind: 'task', obj: t, cols: { Archived: t.archived ? 'Yes' : 'No' } }));
  st.reqs.forEach(r => out.push({ key: r.key, kind: 'req', obj: r }));
  return out;
}
let hasImportance = false; // the Importance column was added later; old lists get it on first sign-in
let hasAttach = false;     // same for AttachPath / AttachName (the contacts screenshot in the in-service & contacts request)
const mailCols = m => Object.assign({ Title: m.key.slice(0, 250), Key: m.key, Code: m.code, ToList: m.to.join(';'), CcList: m.cc.join(';'), Subject: m.subject.slice(0, 250), HtmlBody: m.body, SendOn: m.sendOn, SendStatus: m.status, Facility: m.fac ? String(m.fac) : '', TaskKey: m.task || '', Cond: m.cond ? JSON.stringify(m.cond) : '', ErrorText: m.error || '' }, hasImportance ? { Importance: m.importance || 'Normal' } : {}, hasAttach ? { AttachPath: m.attachPath || '', AttachName: m.attachName || '', AttachPath2: m.attachPath2 || '', AttachName2: m.attachName2 || '' } : {});
const mailFrom = (id, f) => ({ _id: id, importance: f.Importance || 'Normal', attachPath: f.AttachPath || '', attachName: f.AttachName || '', attachPath2: f.AttachPath2 || '', attachName2: f.AttachName2 || '', key: f.Key, code: f.Code, to: (f.ToList || '').split(';').filter(Boolean), cc: (f.CcList || '').split(';').filter(Boolean), subject: f.Subject || '', body: f.HtmlBody || '', sendOn: f.SendOn, day: f.SendOn ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(f.SendOn)) : '', status: f.SendStatus, fac: f.Facility ? +f.Facility : null, task: f.TaskKey || null, cond: f.Cond ? JSON.parse(f.Cond) : null, error: f.ErrorText || '' });
const inboxFrom = (id, f) => ({ _id: id, subject: f.Title || '', from: f.FromAddress || '', to: (f.ToAddresses || '').split(/[;,]/).map(s => s.trim()).filter(Boolean), cc: (f.CcAddresses || '').split(/[;,]/).map(s => s.trim()).filter(Boolean), received: f.Received || '', preview: f.Preview || '', path: f.FilePath || '', processed: f.Processed === 'Yes', fac: f.Facility ? +f.Facility : null });
function emptyState(today, me) { return { today, me, settings: null, groups: {}, facs: [], tasks: [], reqs: [], mails: [], inbox: [], names: {} }; }
function applyRecords(rows) {
  rows.forEach(r => {
    const o = r.obj;
    if (r.kind === 'settings') st.settings = Object.assign(defaultSettings(), o);
    else if (r.kind === 'grp') st.groups[lc(o.name)] = o;
    else if (r.kind === 'fac') st.facs.push(o);
    else if (r.kind === 'task') st.tasks.push(o);
    else if (r.kind === 'req') st.reqs.push(o);
  });
  st.facs = st.facs.filter(f => !f.deleted); st.tasks = st.tasks.filter(t => !(t.fac && !st.facs.some(f => f.id === t.fac) && t.archived));
  st.facs.sort((a, b) => a.id - b.id);
  st.reqs.forEach(r => { if (r.by) st.names[lc(r.by)] = r.byName; });
  st.tasks.forEach(t => { if (t.doneBy) st.names[lc(t.doneBy)] = t.doneByName; });
  if (st.me) st.names[lc(st.me.email)] = st.me.name;
}
const snap = o => JSON.stringify(o);
function mergeChanged(base, mine, latest) {
  // top-level fields this person changed win; everything else keeps the latest saved value
  const out = Object.assign({}, latest);
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine)]);
  keys.forEach(k => { if (snap((base || {})[k]) !== snap(mine[k])) { if (mine[k] === undefined) delete out[k]; else out[k] = mine[k]; } });
  return out;
}

// =====================================================================
// Demo store: in memory, with a fake "flow" that sends due emails
// =====================================================================
function DemoStore() {
  let base = {};
  const S = {
    mode: 'demo',
    async init() {
      const today = '2026-10-08';
      st = emptyState(today, null);
      st.settings = demoSettings();
      st.me = { email: lc(person('Raizy Kreiser').email), name: 'Raizy Kreiser' };
      const sak = ensureGroup('SAK Healthcare');
      Object.assign(sak, { am: lc(person('Raizy Kreiser').email), rep: lc(person('Sori Stein').email), clin: lc(person('Sori Stein').email), cov: { Enteral: 'Covered and Noncovered', Ostomy: 'Covered Only', Urological: 'Covered Only', Respiratory: 'Covered Only', 'Wound Care': "Don't Supply", Supplements: "Don't Supply" }, price: 'SAK (GNS G/XCEL25)', contacts: [{ first: 'Moshe', last: 'Klein', dept: 'Corporate contact', email: 'mklein@sak-demo.com' }], emr: 'sak.lakewood', noteDone: true });
      this.rebase();
    },
    rebase() { base = {}; dataRecords().forEach(r => base[r.key] = snap(r.obj)); },
    async load() { this.fakeFlow(); },
    fakeFlow() { const now = st.today; st.mails.forEach(m => { if (m.status === 'Queued' && m.day <= now) { m.status = 'Sent'; m.sentDay = m.day; } }); },
    async save() { this.fakeFlow(); this.rebase(); return { ok: true }; },
    async allocateIds(n) { const s = st.settings.nextCt || 1; st.settings.nextCt = s + n; return Array.from({ length: n }, (_, i) => s + i); },
    async searchPeople(q) { const l = lc(q); return demoDirectory().filter(p => lc(p.name).includes(l) || lc(p.email).includes(l)).slice(0, 10); },
    async uploadFile(folder, file) { const data = /^image\//.test(file.type || '') ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }) : ''; return { name: file.name, url: data || '#demo-file', path: '/Shared Documents/CT Request files/' + folder + '/' + file.name, data }; },
    fileUrl() { return '#demo-file'; },
    async signOut() { }
  };
  return S;
}
function demoSettings() {
  const s = defaultSettings();
  s.people.forEach(p => { p.email = p.name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@demo.gentell.com'; }); // demo never uses real addresses
  s.people.push({ name: 'Requester (demo)', email: 'requester@demo.gentell.com' });
  s.e1To = ['darlene.kusek@demo.gentell.com', 'christian.brandt@demo.gentell.com', 'danielle.butler@demo.gentell.com', 'brittney.barrows@demo.gentell.com'];
  s.e1Cc = ['kyle.king@demo.gentell.com', 'damian.proulx@demo.gentell.com', 'brian.schorn@demo.gentell.com', 'jocelyn.vidal@demo.gentell.com', 'linda.anwaya@demo.gentell.com', 'aliyah.price@demo.gentell.com'];
  s.inserviceUrl = 'https://example.com/inservice';
  return s;
}
function demoDirectory() { return [{ name: 'Peter West', email: 'peter.west@demo.gentell.com' }, { name: 'Brian McCauley', email: 'brian.mccauley@demo.gentell.com' }, { name: 'Dana Fox', email: 'dana.fox@demo.gentell.com' }, ...st.settings.people.map(p => ({ name: p.name, email: p.email }))]; }

// =====================================================================
// SharePoint store (Microsoft Graph)
// =====================================================================
function SPStore() {
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPES = ['User.Read', 'User.ReadBasic.All', 'Sites.Manage.All'];
  let msalApp = null, account = null, siteId = null, sitePath = '', siteOrigin = '', listIds = {};
  let ids = { data: {}, outbox: {}, inbox: {} }, base = {}, colBase = {}, mailBase = {}, inboxBase = {};

  async function token() {
    if (window.CT_TEST) return 'test-token:' + window.CT_TEST.email; // automated tests only
    const req = { scopes: SCOPES, account };
    try { return (await msalApp.acquireTokenSilent(req)).accessToken; }
    catch (e) {
      if (window.self !== window.top) return (await msalApp.acquireTokenPopup(req)).accessToken;
      await msalApp.acquireTokenRedirect(req); throw new Error('Signing in again…');
    }
  }
  async function gfetch(url, opt = {}, tries = 0) {
    const headers = Object.assign({ Authorization: 'Bearer ' + await token() }, opt.headers || {});
    if (opt.body && typeof opt.body === 'string') headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    const r = await fetch(url.startsWith('http') ? url : GRAPH + url, Object.assign({}, opt, { headers }));
    if ((r.status === 429 || r.status === 503 || r.status === 504) && tries < 5) { const wait = (+r.headers.get('Retry-After') || 2 ** tries) * 1000; await new Promise(res => setTimeout(res, wait)); return gfetch(url, opt, tries + 1); }
    if (!r.ok) { let msg = r.status + ' ' + r.statusText; try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (_) { } const e = new Error(msg); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
  async function getAll(url) { let out = [], next = url; while (next) { const j = await gfetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } }); out = out.concat(j.value || []); next = j['@odata.nextLink']; } return out; }
  // up to 20 requests per Graph $batch call
  async function batch(reqs) {
    const results = [];
    for (let i = 0; i < reqs.length; i += 20) {
      const chunk = reqs.slice(i, i + 20).map((r, j) => Object.assign({ id: String(j) }, r));
      const j = await gfetch('/$batch', { method: 'POST', body: JSON.stringify({ requests: chunk }) });
      const byId = {}; j.responses.forEach(x => byId[x.id] = x);
      for (let k = 0; k < chunk.length; k++) {
        let res = byId[String(k)];
        if (res.status === 429 || res.status === 503) { // retry that one on its own
          await new Promise(r => setTimeout(r, 2000));
          try { res = { status: 200, body: await gfetch(chunk[k].url, { method: chunk[k].method, body: chunk[k].body ? JSON.stringify(chunk[k].body) : undefined, headers: chunk[k].headers }) }; } catch (e) { res = { status: e.status || 500, body: { error: { message: e.message } } }; }
        }
        results.push(res);
      }
    }
    return results;
  }
  const listUrl = k => '/sites/' + siteId + '/lists/' + listIds[k];
  const errOf = r => (r.body && r.body.error && r.body.error.message) || ('HTTP ' + r.status);
  const isDup = r => r.status === 409 || /duplicate|unique|already exists/i.test(errOf(r));

  const S = {
    mode: 'sp',
    needsSetup: false,
    async init() {
      if (!window.CT_TEST) {
        if (!window.msal) throw new Error('The sign-in library didn\'t load. Refresh the page.');
        msalApp = new msal.PublicClientApplication({ auth: { clientId: CFG.clientId, authority: 'https://login.microsoftonline.com/' + CFG.tenantId, redirectUri: CFG.appUrl }, cache: { cacheLocation: 'localStorage' } });
        await msalApp.initialize();
        const res = await msalApp.handleRedirectPromise();
        if (res && res.state) { try { history.replaceState(null, '', location.pathname + res.state); } catch (_) { } }
        account = (res && res.account) || msalApp.getAllAccounts()[0];
        if (!account) {
          const req = { scopes: SCOPES, state: location.search };
          if (window.self !== window.top) throw new Error('Open the app in your browser to sign in: ' + CFG.appUrl);
          else { await msalApp.loginRedirect(req); return false; }
        }
        msalApp.setActiveAccount(account);
      }
      const u = new URL(CFG.siteUrl); siteOrigin = u.origin; sitePath = u.pathname.replace(/\/$/, '');
      // no access to the SharePoint site (not a member of the Chicago Transitions team yet): say so plainly
      const who = (account && account.username) || (window.CT_TEST && CT_TEST.email) || '';
      let lists;
      try {
        siteId = (await gfetch('/sites/' + u.hostname + ':' + sitePath + '?$select=id')).id;
        lists = await gfetch('/sites/' + siteId + '/lists?$select=id,displayName&$top=200');
      } catch (e) { if (e.status === 403 || e.status === 404 || e.status === 401) { const x = new Error(e.message); x.noAccess = true; x.who = who; throw x; } throw e; }
      for (const k in LISTS) { const l = lists.value.find(x => x.displayName === LISTS[k].name); if (l) listIds[k] = l.id; }
      this.needsSetup = Object.keys(LISTS).some(k => !listIds[k]);
      if (listIds.outbox) {
        // columns added after the first release: lists made before them get them here, on sign-in
        const cols = (await gfetch(listUrl('outbox') + '/columns?$select=name&$top=200')).value.map(c => c.name), missing = [];
        for (const [name, type] of [['Importance', 'text'], ['AttachPath', 'note'], ['AttachName', 'text'], ['AttachPath2', 'note'], ['AttachName2', 'text']]) {
          if (cols.includes(name)) continue;
          try { await gfetch(listUrl('outbox') + '/columns', { method: 'POST', body: JSON.stringify(type === 'note' ? { name, text: { allowMultipleLines: true, textType: 'plain' } } : { name, text: {} }) }); cols.push(name); }
          catch (e) { console.error('Could not add the ' + name + ' column', e); missing.push(name); }
        }
        hasImportance = cols.includes('Importance'); hasAttach = ['AttachPath', 'AttachName', 'AttachPath2', 'AttachName2'].every(c => cols.includes(c));
        if (missing.length) this.warning = 'Couldn\'t add the ' + missing.map(n => '"' + n + '"').join(', ') + ' column(s) to CT Outbox. Emails still go out, but ' + (missing.includes('Importance') ? 'all as normal importance' : '') + (missing.length > 1 && missing.includes('Importance') ? ' and ' : '') + (missing.some(n => n.startsWith('Attach')) ? 'without the contacts screenshots' : '') + '. Ask a site owner to open the app once.';
        // the "CT - Send emails" flow reads this file when an email has no screenshot (so its "Get file content" step never fails)
        if (hasAttach) { try { await gfetch('/sites/' + siteId + '/drive/root:/CT Request files/none.txt'); } catch (e) { if (e.status === 404) { try { await gfetch('/sites/' + siteId + '/drive/root:/CT Request files/none.txt:/content', { method: 'PUT', body: 'placeholder for the CT - Send emails flow', headers: { 'Content-Type': 'text/plain' } }); } catch (_) { } } } }
      }
      const me = await gfetch('/me?$select=displayName,mail,userPrincipalName');
      st = emptyState(todayET(), { email: lc(me.mail || me.userPrincipalName), name: me.displayName });
      return true;
    },
    // creates the 4 lists (and any missing columns). Safe to run again.
    async setup() {
      for (const k in LISTS) {
        const L = LISTS[k];
        if (!listIds[k]) listIds[k] = (await gfetch('/sites/' + siteId + '/lists', { method: 'POST', body: JSON.stringify({ displayName: L.name, list: { template: 'genericList' } }) })).id;
        const have = (await gfetch(listUrl(k) + '/columns?$select=name&$top=200')).value.map(c => c.name);
        for (const [name, type, indexed, unique] of L.cols) {
          if (have.includes(name)) continue;
          const col = { name, indexed: !!indexed };
          if (unique) col.enforceUniqueValues = true;
          if (type === 'text') col.text = {};
          if (type === 'note') col.text = { allowMultipleLines: true, linesForEditing: 6, textType: 'plain' };
          if (type === 'date') col.dateTime = { format: 'dateTime' };
          await gfetch(listUrl(k) + '/columns', { method: 'POST', body: JSON.stringify(col) });
        }
      }
      hasImportance = true;
      // the folder the "CT - Mailbox" flow saves incoming emails to
      try { await gfetch('/sites/' + siteId + '/drive/root/children', { method: 'POST', body: JSON.stringify({ name: 'CT Mailbox', folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }); } catch (e) { if (e.status !== 409) throw e; }
      this.needsSetup = false;
      // first run: save default settings
      const existing = await getAll(listUrl('data') + "/items?$expand=fields($select=Key)&$filter=fields/Key eq 'settings'");
      if (!existing.length) await gfetch(listUrl('data') + '/items', { method: 'POST', body: JSON.stringify({ fields: { Title: 'settings', Key: 'settings', Kind: 'settings', Data: JSON.stringify(defaultSettings()), Archived: 'No' } }) });
    },
    async load(opts = {}) {
      const me = st.me, today = todayET();
      const since = d => new Date(Date.now() - d * 864e5).toISOString();
      const [data, outbox, inbox] = await Promise.all([
        getAll(listUrl('data') + "/items?$top=999&$expand=fields($select=Key,Kind,Data,Ct,Am,Archived)" + (opts.archived ? '' : "&$filter=fields/Archived eq 'No'")),
        // 3 separate queries on indexed columns (an "or" across them can hit SharePoint's 5,000-item limit)
        Promise.all(["fields/SendStatus eq 'Queued'", "fields/SendStatus eq 'Failed'", "fields/SendOn ge '" + since(OUTBOX_DAYS) + "'"].map(f => getAll(listUrl('outbox') + '/items?$top=999&$expand=fields&$filter=' + encodeURIComponent(f)))).then(rs => { const m = new Map(); rs.flat().forEach(it => m.set(it.id, it)); return [...m.values()]; }),
        getAll(listUrl('inbox') + "/items?$top=999&$expand=fields&$filter=" + encodeURIComponent("fields/Received ge '" + since(INBOX_DAYS) + "'"))
      ]);
      st = emptyState(today, me);
      ids = { data: {}, outbox: {}, inbox: {} }; base = {}; colBase = {}; mailBase = {}; inboxBase = {};
      const rows = [];
      data.forEach(it => { const f = it.fields; if (!f.Key || !f.Data) return; ids.data[f.Key] = it.id; let o; try { o = JSON.parse(f.Data); } catch (_) { console.error('Bad row', f.Key); return; } base[f.Key] = f.Data; colBase[f.Key] = snap({ Ct: f.Ct || undefined, Am: f.Am || undefined, Archived: f.Archived || 'No' }); rows.push({ key: f.Key, kind: f.Kind, obj: o }); });
      applyRecords(rows);
      if (!st.settings) st.settings = defaultSettings();
      st.mails = outbox.map(it => mailFrom(it.id, it.fields)).filter(m => m.key).sort((a, b) => (b.sendOn || '').localeCompare(a.sendOn || ''));
      st.mails.forEach(m => { ids.outbox[m.key] = m._id; mailBase[m.key] = snap([m.status, m.to, m.cc]); });
      st.inbox = inbox.map(it => inboxFrom(it.id, it.fields)).sort((a, b) => (b.received || '').localeCompare(a.received || ''));
      st.inbox.forEach(m => inboxBase[m._id] = snap([m.processed, m.fac]));
    },
    async save() {
      const errors = [];
      // 1. CT Data rows: new ones are created, changed ones are merged with the latest saved version
      const recs = dataRecords();
      const creates = recs.filter(r => !ids.data[r.key]);
      const colSnap = r => snap({ Ct: (r.cols || {}).Ct, Am: (r.cols || {}).Am, Archived: (r.cols || {}).Archived || 'No' });
      const changed = recs.filter(r => ids.data[r.key] && (base[r.key] !== snap(r.obj) || (r.cols && colBase[r.key] !== colSnap(r))));
      if (changed.length) {
        const latest = await batch(changed.map(r => ({ method: 'GET', url: listUrl('data') + '/items/' + ids.data[r.key] + '?$expand=fields($select=Data)' })));
        const patches = changed.map((r, i) => {
          let merged = r.obj;
          if (latest[i].status === 200) { try { const l = JSON.parse(latest[i].body.fields.Data); if (snap(l) !== base[r.key]) merged = mergeChanged(JSON.parse(base[r.key]), r.obj, l); } catch (_) { } }
          return { method: 'PATCH', url: listUrl('data') + '/items/' + ids.data[r.key] + '/fields', headers: { 'Content-Type': 'application/json' }, body: Object.assign({ Data: JSON.stringify(merged) }, r.cols || {}) };
        });
        (await batch(patches)).forEach((res, i) => { if (res.status >= 300) errors.push('Saving ' + changed[i].key + ': ' + errOf(res)); });
      }
      if (creates.length) {
        const res = await batch(creates.map(r => ({ method: 'POST', url: listUrl('data') + '/items', headers: { 'Content-Type': 'application/json' }, body: { fields: Object.assign({ Title: r.key.slice(0, 250), Key: r.key, Kind: r.kind, Data: JSON.stringify(r.obj), Archived: 'No' }, r.cols || {}) } })));
        res.forEach((x, i) => { if (x.status >= 300 && !isDup(x)) errors.push('Creating ' + creates[i].key + ': ' + errOf(x)); });
      }
      // 2. emails: new ones are created; status changes only apply if the flow hasn't sent it yet
      const newMails = st.mails.filter(m => !ids.outbox[m.key]);
      if (newMails.length) {
        const res = await batch(newMails.map(m => ({ method: 'POST', url: listUrl('outbox') + '/items', headers: { 'Content-Type': 'application/json' }, body: { fields: mailCols(m) } })));
        res.forEach((x, i) => { if (x.status >= 300 && !isDup(x)) errors.push('Email "' + newMails[i].subject + '": ' + errOf(x)); });
      }
      const statusChanged = st.mails.filter(m => ids.outbox[m.key] && mailBase[m.key] !== snap([m.status, m.to, m.cc]));
      if (statusChanged.length) {
        const latest = await batch(statusChanged.map(m => ({ method: 'GET', url: listUrl('outbox') + '/items/' + ids.outbox[m.key] + '?$expand=fields($select=SendStatus)' })));
        const patches = [];
        statusChanged.forEach((m, i) => { const cur = latest[i].status === 200 ? latest[i].body.fields.SendStatus : null; if (cur === JSON.parse(mailBase[m.key])[0]) patches.push({ method: 'PATCH', url: listUrl('outbox') + '/items/' + ids.outbox[m.key] + '/fields', headers: { 'Content-Type': 'application/json' }, body: { SendStatus: m.status, SendOn: m.sendOn, ToList: m.to.join(';'), CcList: m.cc.join(';'), ErrorText: m.status === 'Queued' ? '' : (m.error || '') } }); });
        if (patches.length) (await batch(patches)).forEach(x => { if (x.status >= 300) errors.push('Email status: ' + errOf(x)); });
      }
      // 3. inbox rows the app matched to a facility
      const inb = st.inbox.filter(m => inboxBase[m._id] !== snap([m.processed, m.fac]));
      if (inb.length) (await batch(inb.map(m => ({ method: 'PATCH', url: listUrl('inbox') + '/items/' + m._id + '/fields', headers: { 'Content-Type': 'application/json' }, body: { Processed: m.processed ? 'Yes' : 'No', Facility: m.fac ? String(m.fac) : '' } })))).forEach(x => { if (x.status >= 300) errors.push('Mailbox row: ' + errOf(x)); });
      return { ok: !errors.length, errors, wrote: changed.length + creates.length + newMails.length + statusChanged.length + inb.length };
    },
    async allocateIds(n) {
      const made = [];
      for (let i = 0; i < n; i++) made.push((await gfetch(listUrl('numbers') + '/items', { method: 'POST', body: JSON.stringify({ fields: { Title: st.me.email + ' ' + new Date().toISOString() } }) })).id);
      return made.map(Number);
    },
    async searchPeople(q) {
      if (q.length < 2) return [];
      const term = q.replace(/"/g, '');
      const j = await gfetch('/users?$search=' + encodeURIComponent('"displayName:' + term + '" OR "mail:' + term + '"') + '&$select=displayName,mail&$top=10', { headers: { ConsistencyLevel: 'eventual' } });
      return (j.value || []).filter(u => u.mail).map(u => ({ name: u.displayName, email: lc(u.mail) }));
    },
    async uploadFile(folder, file) {
      const rel = 'CT Request files/' + folder + '/' + file.name.replace(/[#%*:<>?\/\\|"]/g, '_'), path = encodeURI(rel);
      const root = '/sites/' + siteId + '/drive/root:/' + path + ':';
      if (file.size < 4 * 1024 * 1024) { const j = await gfetch(root + '/content', { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }); return { name: file.name, url: j.webUrl, path: '/Shared Documents/' + rel }; }
      const sess = await gfetch(root + '/createUploadSession', { method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) });
      const CH = 320 * 1024 * 10; let j = null;
      for (let s = 0; s < file.size; s += CH) {
        const e = Math.min(s + CH, file.size);
        const r = await fetch(sess.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${s}-${e - 1}/${file.size}` }, body: file.slice(s, e) });
        if (!r.ok) throw new Error('Upload of ' + file.name + ' failed (' + r.status + ')');
        if (r.status === 200 || r.status === 201) j = await r.json();
      }
      return { name: file.name, url: j && j.webUrl, path: '/Shared Documents/' + rel };
    },
    fileUrl(path) { return path ? siteOrigin + encodeURI((path.startsWith(sitePath) ? '' : sitePath) + path) : ''; },
    async signOut() { await msalApp.logoutRedirect({ account }); }
  };
  return S;
}
