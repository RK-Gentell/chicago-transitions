'use strict';
/* =====================================================================
   Task types. Each one has:
   title(t)          what the task is called everywhere
   form(t)           the HTML inside the task drawer (instructions + fields)
   validate(t)       '' when the form is OK, otherwise the message to show
   done(t, ctx)      saves what the person entered (ctx = {by, byName})
   example(t)        demo mode only: fills the form
   opens(t)          tasks that wait for a date: the email sent on that date
   quick(t, answer)  tasks answerable straight from an email button
   ===================================================================== */

// ---------- form helpers ----------
const optV = o => Array.isArray(o) ? o[0] : o, optL = o => Array.isArray(o) ? o[1] : o;
const sel = (id, opts, v, list) => (!list && opts.length === 2)
  ? `<div class="seg" role="group" data-seg="${id}">${opts.map(o => `<button type="button" class="segb ${optV(o) === v ? 'on' : ''}" data-segval="${esc(optV(o))}" aria-pressed="${optV(o) === v}">${esc(optL(o))}</button>`).join('')}</div><input type="hidden" id="${id}" value="${esc(v || '')}">`
  : `<select id="${id}">${[['', 'Select…'], ...opts].map(o => `<option ${optV(o) === v && v ? 'selected' : ''} value="${esc(optV(o))}">${esc(optL(o))}</option>`).join('')}</select>`;
const txt = (id, v, ph) => `<input type="text" id="${id}" value="${esc(v || '')}" placeholder="${esc(ph || '')}">`;
const dt = (id, v) => `<input type="date" id="${id}" value="${esc(v || '')}">`;
// small (i) button; the text shows on hover, focus or click
const INFO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor"/></svg>';
const tip = s => `<span class="infow"><button type="button" class="info" aria-label="More info" aria-expanded="false">${INFO_SVG}</button><span class="tip" role="note">${s}</span></span>`;
const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const chk = (id, label, v) => `<label class="chk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}><span>${label}</span></label>`;
const V = id => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; };
const peopleOpts = list => list.map(p => [lc(p.email), p.name]);
// person picker: type a name, pick from the company address book
const personPick = (id, val) => `<input type="text" id="${id}" class="pp" list="${id}_dl" autocomplete="off" placeholder="Start typing a name" value="${esc(val && val.name ? val.name + ' <' + val.email + '>' : '')}"><datalist id="${id}_dl"></datalist>`;
function readPerson(id) { const v = V(id); const m = v.match(/^(.*?)\s*<([^>]+)>$/); if (m && validEmail(m[2])) return { name: m[1].trim(), email: lc(m[2]) }; return null; }

// ---------- contact row editor ----------
function ceRow(kind, withFac, c) {
  c = c || {}; const opts = st.settings.depts.filter(d => !kind || d.type === kind).map(d => d.name);
  return `<div class="ce-row">${withFac ? `<input type="text" class="ce-fac" placeholder="Facility (blank = all)" value="${esc(c.fac || '')}">` : ''}<input type="text" class="ce-first" placeholder="First" value="${esc(c.first || '')}"><input type="text" class="ce-last" placeholder="Last" value="${esc(c.last || '')}"><select class="ce-dept"><option value="">Department…</option>${opts.map(o => `<option ${o === c.dept ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><input type="text" class="ce-note" placeholder="Position (for Other)" value="${esc(c.note || '')}" ${c.dept === 'Other' ? '' : 'hidden'}><input type="text" class="ce-email" placeholder="Email" value="${esc(c.email || '')}"><button type="button" class="btn sm" data-delrow aria-label="Remove this contact">Remove</button></div>`;
}
function contactEditor(id, kind, withFac, rows) { rows = rows && rows.length ? rows : [{}]; return `<div class="ce" id="${id}" data-kind="${kind || ''}" data-withfac="${withFac ? 1 : ''}">${rows.map(r => ceRow(kind, withFac, r)).join('')}</div><button type="button" class="btn sm" data-addrow="${id}">+ Add another contact</button>`; }
function readContacts(id) {
  const box = document.getElementById(id); if (!box) return [];
  return [...box.querySelectorAll('.ce-row')].map(r => ({ fac: r.querySelector('.ce-fac') ? r.querySelector('.ce-fac').value.trim() : '', first: r.querySelector('.ce-first').value.trim(), last: r.querySelector('.ce-last').value.trim(), dept: r.querySelector('.ce-dept').value, note: r.querySelector('.ce-note').value.trim(), email: r.querySelector('.ce-email').value.trim() })).filter(c => c.first || c.last || c.email || c.dept);
}
function ceErr(id) {
  const cs = readContacts(id);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c.dept) return 'Contact ' + (i + 1) + ': pick a department.';
    if (c.dept === 'Other' && !c.note) return 'Contact ' + (i + 1) + ': "Other" needs the position.';
    if (c.email && !validEmail(c.email)) return 'Contact ' + (i + 1) + ': "' + c.email + '" isn\'t an email address.';
  }
  return '';
}
function setContacts(id, rows) { const box = document.getElementById(id); if (!box) return; box.innerHTML = rows.map(r => ceRow(box.dataset.kind, !!box.dataset.withfac, r)).join(''); }
// the FastCare task's screenshot box: paste (Ctrl+V) or pick an image. Kept in ui.shot until "Mark done" uploads it.
const shotFor = t => (typeof ui !== 'undefined' && ui.shot && ui.shot.task === t.key) ? ui.shot : null;
const shotZone = t => { const s = shotFor(t); return `<div class="drop shot" id="fc_shot" tabindex="0">${s ? `<img src="${s.url}" alt="Contacts screenshot"><div><button type="button" class="btn sm" id="fc_shotx">Remove</button></div>` : '<b>Click here and press Ctrl+V</b> to paste a screenshot, or <label class="linkish" for="fc_shotfile">choose an image</label>'}<input type="file" id="fc_shotfile" accept="image/*" hidden></div>`; };
const contactTable = list => `<div class="tablewrap"><table><tr><th>First</th><th>Last</th><th>Department</th><th>Email</th><th>From</th></tr>${list.map(c => `<tr><td>${esc(c.first) || '<span class="meta">no first name</span>'}</td><td>${esc(c.last)}</td><td>${esc(c.dept)}${c.note ? ' → "Note": ' + esc(c.note) : ''}</td><td>${esc(c.email)}</td><td>${esc(c.src)}</td></tr>`).join('')}</table></div>`;

// ---------- the task types ----------
const TT = {
  RULE: {
    title: t => t.group === '__nocorp' ? 'Pick the reps (corporate not known yet)' : 'Pick the reps for ' + t.group,
    form: t => {
      const fs = ruleFacs(t), R = peopleOpts(repList()), A = peopleOpts(amList());
      return `<div class="instr">${fs.length} facilit${fs.length === 1 ? 'y' : 'ies'} with no rep. Same people for all? Fill the top row and click "Apply to all". Different reps per facility? Change the rows below.</div>
      <div class="card" style="padding:10px"><b>All facilities</b><div class="row">${fld('Intake rep', sel('rep', R, '', true))}${fld('Clinical rep', sel('clin', R, '', true), 'Blank = same as intake')}${fld('Account manager', sel('acct', R, '', true))}${fld('Transition lead', sel('am', A, '', true))}</div><button type="button" class="btn sm" data-applyall="1">Apply to all ↓</button></div>
      <div class="tablewrap"><table><tr><th>Facility</th><th>Intake rep</th><th>Clinical rep</th><th>Account manager</th><th>Transition lead</th></tr>${fs.map(f => `<tr><td>${esc(f.name)}</td><td>${sel('rep_' + f.id, R, f.rep, true)}</td><td>${sel('clin_' + f.id, R, f.clin, true)}</td><td>${sel('acct_' + f.id, R, f.acct, true)}</td><td>${sel('am_' + f.id, A, f.am, true)}</td></tr>`).join('')}</table></div>
      ${fld('Why these reps? (optional)', txt('why', '', 'Goes in the email to the transition lead'))}
      ${t.group === '__nocorp' ? '' : chk('rule', 'Save the top row as the corporate rule (future facilities under this corporate get it automatically)', true)}`;
    },
    example: t => { const r = repList()[0], a = amList()[0], o = { rep: lc(r.email), am: lc(a.email) }; ruleFacs(t).forEach(f => { o['rep_' + f.id] = lc(r.email); o['am_' + f.id] = lc(a.email); }); return o; },
    validate: t => { for (const f of ruleFacs(t)) { if (!V('rep_' + f.id) || !V('am_' + f.id)) return 'Pick an intake rep and transition lead for ' + f.name + ' (or use "Apply to all").'; } if (V('rule') && !(V('rep') && V('am'))) return 'To save a corporate rule, fill the top row.'; return ''; },
    done: (t, ctx) => {
      const g = grp(t.group);
      if (g && V('rule')) { g.rep = V('rep'); g.clin = V('clin') || V('rep'); g.am = V('am'); g.acct = V('acct'); }
      const byAm = {};
      ruleFacs(t).forEach(f => { f.rep = V('rep_' + f.id); f.clin = V('clin_' + f.id) || f.rep; f.am = V('am_' + f.id); f.acct = V('acct_' + f.id) || f.acct; (byAm[f.am] = byAm[f.am] || []).push(f); });
      // skip facilities this transition lead already got a "New transition" for when the request came in
      Object.entries(byAm).map(([am, list]) => [am, list.filter(f => !st.mails.some(m => m.key === 'm:E2:' + f.req + ':' + lc(am)))]).filter(([, list]) => list.length).forEach(([am, list]) => mail({ key: 'm:E2:' + t.key + ':' + am, code: 'E2', to: [am], link: 'none', subject: 'New transition: ' + list.map(f => f.name).join(', '), body: `<p>${esc(ctx.byName)} assigned you ${list.length} facilit${list.length > 1 ? 'ies' : 'y'}${t.group === '__nocorp' ? '' : ' from <b>' + esc(t.group) + '</b>'}: ${list.map(f => esc(f.name) + ' (intake rep ' + esc(nameOf(f.rep)) + ')').join(', ')}.</p>${V('why') ? '<p><b>Why these reps:</b> ' + esc(V('why')) + '</p>' : ''}<p><b>Background:</b> ${esc(list[0].why) || '-'}</p><p>All requests already went out.</p>${amFirstTasks(list)}` }));
    }
  },
  AREAS: {
    title: t => 'Areas of care for ' + t.group,
    form: t => { const g = grp(t.group) || { cov: {} }, have = AREAS.filter(a => g.cov && g.cov[a]); return (have.length ? `<div class="instr">Already filled in: ${have.join(', ')}. Just pick the rest (you can still change these).</div>` : '') + `<div class="row">${AREAS.map(a => fld(a + (g.cov && g.cov[a] ? ' <span class="tag">filled in</span>' : ''), sel('cov_' + a, covOpts(a), g.cov && g.cov[a], true))).join('')}</div>`; },
    example: t => { const g = grp(t.group) || { cov: {} }; const d = { cov_Enteral: 'Covered and Noncovered', cov_Ostomy: 'Covered Only', cov_Urological: 'Covered Only', cov_Respiratory: 'Covered Only', 'cov_Wound Care': "Don't Supply", cov_Supplements: "Don't Supply" }; AREAS.forEach(a => { if (g.cov && g.cov[a]) d['cov_' + a] = g.cov[a]; }); return d; },
    validate: () => AREAS.every(a => V('cov_' + a)) ? '' : 'Pick all 6.',
    done: t => { const g = grp(t.group); g.cov = {}; AREAS.forEach(a => g.cov[a] = V('cov_' + a)); }
  },
  PRICE: {
    title: t => 'Price table for ' + t.group,
    form: t => { const g = grp(t.group); return `<div><b>Areas of care and what we're supplying</b>${areasTableHtml(g)}</div><div class="meta">Facilities: ${facsOfGroup(g.name).map(x => esc(x.name)).join(', ')}</div>${fld('"Price Table"', txt('price', '', 'e.g. Infinity (GNS G/XCEL25)'))}`; },
    example: () => ({ price: 'Infinity (GNS G/XCEL25)' }),
    validate: () => V('price') ? '' : 'Enter the price table.',
    done: t => { grp(t.group).price = V('price'); }
  },
  EMR: {
    title: t => 'EMR access for ' + t.group,
    form: t => { const gf = facsOfGroup(t.group).filter(x => !x.hold); return `<div class="instr">Enter "Emr", "Emr Username" and "Emr Password" in the portal on each facility below. Save the QR code on the server in the "Authenticator" folder, named the username.</div><div class="note">Only the username goes in here: the system needs it to ask corporate to add new facilities in this group to the same login.</div><ul>${gf.map(x => '<li>' + esc(facName(x)) + (x.inPortal ? '' : ' <b>(not in the portal yet)</b>') + '</li>').join('')}</ul>${fld('"Emr Username"', txt('user', '', 'e.g. ihcm.lakewood'))}${chk('ok', 'Entered in the portal on every facility above, and saved the QR code')}`; },
    example: () => ({ user: 'ihcm.lakewood', ok: true }),
    validate: () => V('user') && V('ok') ? '' : 'Enter the username and confirm it\'s in the portal.',
    done: t => { const g = grp(t.group); g.emr = V('user'); g.emrNew = true; }
  },
  EMR_ADD: {
    title: t => 'Confirm corporate added ' + facById(t.fac).name + ' to the EMR login',
    form: t => { const m = mainCorp(G(facById(t.fac))); return `<div class="instr">${m ? 'The system asked ' + esc(m.first + ' ' + m.last) + ' (' + esc(m.email) + '). Mark done when they confirm.' : 'No corporate contact with an email on file. Ask the corporate or facility to add this facility to the group\'s EMR login (' + esc(G(facById(t.fac)).emr) + ').'}</div>${chk('ok', 'Corporate confirmed')}`; },
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when they confirm.', done: () => { }
  },
  PORTAL_ADD: {
    title: t => 'Add ' + facById(t.fac).name + ' to Brightree',
    form: t => { const f = facById(t.fac), g = G(f); return `<div class="kv"><div>Name</div><div>${esc(f.name)}</div><div>Address</div><div>${esc(f.address)}</div><div>Corporate</div><div>${g.standalone ? '<b>None. Set it up as its own corporate named "' + esc(f.group) + '"</b>' : esc(f.group)}</div><div>Price table</div><div>${esc(g.price || (g.existing ? 'Already set up for this corporate' : ''))}</div></div><div class="meta">Add it if it isn't there yet. Already there? Just mark done.</div>${fld('Facility name as Brightree shows it', txt('pn', '', 'Waters Of Lagrange- 211526'), 'Every email uses it.')}`; },
    example: t => ({ pn: facById(t.fac).name + '- 2115' + (26 + t.fac) }),
    validate: () => V('pn') ? '' : 'Enter the name as Brightree shows it.',
    done: t => { const f = facById(t.fac); f.inPortal = true; f.portalName = V('pn'); }
  },
  PUMPS: {
    title: t => 'Pumps: ' + facName(facById(t.fac)),
    form: () => `<div class="instr">Check if GNS Chicago sent this facility pumps, and add any to "Pump Tracking" in the portal.</div>${chk('c', 'Checked, and added any pumps')}`,
    example: () => ({ c: true }), validate: () => V('c') ? '' : 'Tick when you\'ve checked.',
    done: t => { facById(t.fac).pumps = 'checked'; },
    quick: (t, a) => a === 'Checked' ? (facById(t.fac).pumps = 'checked', true) : false
  },
  GDD: {
    title: t => 'GDD orders for ' + facById(t.fac).name + '?',
    form: () => `${fld('Did it get orders from GDD?', sel('g', ['Yes', 'No']))}<div id="whbox" hidden>${fld('Which warehouse?', sel('wh', st.settings.warehouses, '', true), 'Missing from the list? Ask Raizy to add it in Settings.')}</div>`,
    example: () => ({ g: 'No' }),
    validate: () => !V('g') ? 'Pick one.' : (V('g') === 'Yes' && !V('wh')) ? 'Which warehouse?' : '',
    done: t => gddAnswer(facById(t.fac), V('g'), V('wh')),
    quick: (t, a) => a === 'No' ? (gddAnswer(facById(t.fac), 'No', ''), true) : false
  },
  GDD_PORTAL: {
    title: t => 'GDD warehouse in portal: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); return `<div class="instr">portal.isgmed.com → the facility → edit pencil. "Main Vendor": <span class="q">${esc(f.gddWh)}</span>.</div><div class="note">Chris answered after the portal setup was done, so this is the only thing left to add.</div>${chk('ok', 'Saved')}`; },
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when saved.', done: () => { }
  },
  FASTCARE: {
    title: t => 'FastCare: ' + facById(t.fac).name,
    form: t => {
      const f = facById(t.fac), n = t.need || {};
      const corpOpts = [...Object.values(st.groups).filter(g => !g.standalone).map(g => g.name).sort(), 'New corporate…', 'No corporate (Independent HQ)'];
      return `<div class="instr">fastcare.gentell.com → "Facility" → "Search:" (1 word if the full name doesn't come up).${n.corp ? ' Corporate = "Ownership-Headquarters" / "Purchasing Group-Chain". "Independent HQ" means no corporate.' : ''} "Actions" → "Edit Facility" for the wound rep + regional, "Actions" → "Contacts" for contacts.</div>
      ${n.corp ? `<div class="row">${fld('Corporate', sel('fc_grp', corpOpts, '', true))}<div class="field" id="fc_newbox" hidden><label>New corporate name</label>${txt('fc_new', '')}</div></div>` : ''}
      ${n.addr ? fld('Address', txt('fc_addr', '', '123 Main St, City, ST 12345'), 'State comes from the 2 letters before the zip.') : ''}
      <div class="row">${fld('Wound and Product Specialist', personPick('w', f.wound), 'Pick from the list; it fills their Gentell email.')}${fld('Regional Manager', personPick('r', f.regional))}</div>
      <div class="field"><label>Contacts${tip('Put the FastCare contacts straight into the portal, then paste a screenshot of them here. It goes into the in-service & contacts request so the wound rep and regional can check them.')}</label>${shotZone(t)}</div>
      ${chk('fc_nocts', 'No FastCare contacts available')}
      ${e3List(f).length ? `<div class="note">These also go in the email (added on the request, facility page or corporate): ${e3List(f).map(c => esc((c.first + ' ' + c.last).trim() || c.email)).join(', ')}</div>` : ''}`;
    },
    example: t => { const n = t.need || {}; const o = { w: 'Peter West <peter.west@demo.gentell.com>', r: 'Brian McCauley <brian.mccauley@demo.gentell.com>' }; if (n.corp) { o.fc_grp = 'New corporate…'; o.fc_new = 'Infinity Healthcare Management'; } if (n.addr) o.fc_addr = '123 Demo St, LaGrange, IN 46761'; o.fc_nocts = true; return o; },
    validate: t => {
      const n = t.need || {};
      if (n.corp && !V('fc_grp')) return 'Pick the corporate (or "No corporate").';
      if (n.corp && V('fc_grp') === 'New corporate…' && !V('fc_new')) return 'Type the new corporate name.';
      if (n.addr && addressProblem(V('fc_addr'))) return addressProblem(V('fc_addr'));
      if (!readPerson('w')) return 'Pick the wound rep from the list (start typing their name).';
      if (!readPerson('r')) return 'Pick the regional from the list (start typing their name).';
      if (!shotFor(t) && !V('fc_nocts')) return 'Paste a screenshot of the contacts, or tick "No FastCare contacts available".';
      return '';
    },
    done: t => {
      const f = facById(t.fac), n = t.need || {};
      if (n.addr) { f.address = V('fc_addr'); f.state = stateFrom(f.address); }
      if (n.corp) {
        const v = V('fc_grp');
        if (v === 'No corporate (Independent HQ)') makeStandalone(f);
        else { const g = ensureGroup(v === 'New corporate…' ? V('fc_new') : v); f.group = g.name; if (f.pendingCov) g.cov = Object.assign({}, f.pendingCov, g.cov || {}); }
      }
      f.contactsShot = (shotFor(t) && ui.shotSaved) || null; f.noFcContacts = !f.contactsShot && !!V('fc_nocts');
      f.wound = readPerson('w'); f.regional = readPerson('r');
    }
  },
  BRIGHTREE: {
    title: t => 'Brightree report: ' + facById(t.fac).name,
    form: t => { const f = facById(t.fac); return `<div class="instr"><ol><li>GNS Chicago's Brightree: search the facility, copy "Name" exactly.</li><li>Star → "My Ad-Hoc Reports" → "GNS Lakewood Report". Error → log back in.</li><li>"Sales Order_Facility" "Equals" the name. "Delivery_Scheduled date" "Between" 01/01/2026 and <b>${fmtS(st.today)}</b>. "Request Report".</li><li>"My Scheduled Reports" → wait for "Completed" → open the CSV.</li><li>Sort by "Patient Full Name", then "Delivery Actual date" (column E, <b>never D</b>). Bottom row per area of care (column R).</li><li>"Save As" → "Excel Workbook" → Z: > GNS Chicago Transition > Sales Order Reports > ${esc(f.group || '(corporate)')} (create the folder if it's missing). Name it <span class="q">${esc(facName(f))} ${fmtS(st.today).replace(/\//g, '-')}</span>.</li></ol></div><div class="note">Only what the system needs goes in here: the dates (for scheduling), and how often enteral ships (the Chicago handoff email + schedule). Everything else on the report goes straight into the portal. Dates calculate from it.</div>
      <div class="row">${fld('Last enteral (Delivery Actual date)', dt('le'))}${fld('Last uro / ostomy / trach', dt('lo'))}</div>
      <div class="row">${fld('Enteral ships', sel('cad', ['Monthly', 'Weekly', 'Biweekly'], 'Monthly'))}</div>`; },
    example: () => ({ le: add(st.today, -19), lo: add(st.today, -23), cad: 'Monthly' }),
    validate: () => { if (!V('le') && !V('lo')) return 'Enter at least 1 last delivery date.'; if ((V('le') && V('le') > st.today) || (V('lo') && V('lo') > st.today)) return 'A last delivery date can\'t be in the future.'; if (!V('cad')) return 'Pick how often enteral ships.'; return ''; },
    done: t => { facById(t.fac).bt = { lastEnt: V('le'), lastOuts: V('lo'), cadence: ({ Monthly: '4', Biweekly: '2', Weekly: '1' })[V('cad')] || '4' }; }
  },
  PORTAL_SETUP: {
    title: t => 'Portal setup: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); return f.dates ? portalForm(f) : '<div class="err">No dates yet: the facility needs a full address with a state that has a ship point. Fix it on the facility page.</div>'; }, example: () => ({ ok: true }),
    validate: t => !facById(t.fac).dates ? 'No dates yet: fix the address on the facility page first.' : V('ok') ? '' : 'Tick when saved.',
    done: t => { G(facById(t.fac)).noteDone = true; }
  },
  EMR_PORTAL: {
    title: t => 'EMR info in portal: ' + facName(facById(t.fac)),
    form: t => { const g = G(facById(t.fac)); return `<div class="instr">Fill "Emr", "Emr Username" (<span class="q">${esc(g.emr || 'the corporate\'s username')}</span>) and "Emr Password". Save the QR code in the "Authenticator" folder named <span class="q">${esc(g.emr || 'the username')}</span>.</div>${chk('ok', 'Done')}`; },
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when done.', done: () => { }
  },
  CONTACTS_PORTAL: {
    title: t => 'Contacts into portal: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac), g = G(f), list = f.contacts.filter(c => !c.inPortal); return `<div class="instr">"Add Contact" for each. Position not in "Department" → "Other" + position in "Note". Leave "Include On". Only the ones not in the portal yet are listed.</div>${list.length ? contactTable(list) : '<div class="meta">All contacts are already in the portal.</div>'}${(g.contacts || []).length ? '<div class="meta">Corporate contacts too: ' + g.contacts.map(c => esc(c.first + ' ' + c.last + ' (' + c.dept + ')')).join(', ') + '</div>' : ''}${chk('ok', 'Entered in the portal')}`; },
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when done.',
    done: t => { facById(t.fac).contacts.forEach(c => c.inPortal = true); }
  },
  SCHEDULE: {
    title: t => 'Schedule: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); return f.dates ? scheduleForm(f) : '<div class="err">No dates yet: the facility needs a full address with a state that has a ship point. Fix it on the facility page.</div>'; }, example: () => ({}),
    validate: t => { const f = facById(t.fac); if (!f.dates || !stateOK(f)) return 'No dates yet: fix the address on the facility page first.'; const s = settingsProblems(); if (s.length) return 'The Chicago handoff email can\'t go out until Settings are finished: ' + s.join(' '); if (!f.rep) return 'The facility has no intake rep.'; if (f.dates.ord < st.today) return 'The ordering date has passed. Change the dates above and click "Save dates" first.'; return ''; },
    done: t => sendEmail1(facById(t.fac))
  },
  ADDRESS: {
    title: t => 'Address: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); return `<div class="instr">${f.address ? 'The address on file is <span class="q">' + esc(f.address) + '</span>, but ' + (stateFrom(f.address) ? 'there\'s no ship point for ' + esc(stateFrom(f.address)) + ' in Settings.' : 'it doesn\'t end with a state and zip.') : 'We don\'t have an address for this facility.'} The state decides the ship point, which decides the delivery date, so dates can\'t be worked out without it.</div>${fld('Full address', txt('ad_addr', f.address || '', '123 Main St, City, ST 12345'))}`; },
    example: () => ({ ad_addr: '123 Demo St, LaGrange, IN 46761' }),
    validate: () => addressProblem(V('ad_addr')),
    done: t => { const f = facById(t.fac); f.address = V('ad_addr'); f.state = stateFrom(f.address); }
  },
  E3_REPLY: {
    title: t => 'In-service & contacts reply: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac), r = t.reply || {}, m = (st.inbox || []).find(x => x._id && x._id === r.inbox);
      return `<div class="instr">${esc(r.from ? e3Who(f, r.from) : 'Someone')} replied to the in-service & contacts request${r.at ? ' on ' + fmt(r.at) : ''}. Put the info they sent (new contacts, corrections) into the portal.${m && m.path ? ` <a href="${esc(STORE.fileUrl(m.path))}" target="_blank" rel="noopener">Open their email</a>` : ''}</div>${m && m.preview ? `<div class="note">"${esc(m.preview.slice(0, 300))}"</div>` : ''}${fld('Where things stand', sel('e3s', [['done', 'Their info is in the portal'], ['more', 'They didn\'t send everything yet: keep following up']], '', true))}`; },
    example: () => ({ e3s: 'done' }), validate: () => V('e3s') ? '' : 'Pick where things stand.',
    done: t => { const f = facById(t.fac); if (V('e3s') === 'more') { f.e3Reply = null; f.e3Round = (f.e3Round || 0) + 1; f.e3RoundFrom = st.today; } else markE3Done(f, typeof meName === 'function' ? meName() : ''); }
  },
  EMAIL3_FOLLOW: {
    title: t => 'In-service & contacts follow-up: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); const who = [...new Set([f.wound && f.wound.name, f.regional && f.regional.name].filter(Boolean))].map(esc).join(' and ') || 'the wound rep and regional'; return `<div class="instr">The in-service & contacts request went to ${who}${f.email3 ? ' on ' + fmt(f.email3) : ''}. It asked them to check our contacts, send the missing ones and get the in-service booked.<ol><li>Find their reply (subject <span class="q">${esc(facName(f))}- Transfer from GNS Chicago to Lakewood</span>).</li><li>Put any corrections and new contacts into the portal.</li><li>Pick the in-service status below and mark done.</li></ol></div><div class="note">Replies to ${esc(CFG.mailbox)} also show on the facility page under "Mailbox". No reply yet? Follow up with them, or mark done with "Not yet".</div>${fld('In-service', sel('is', ['Booked', 'Not yet', 'Facility didn\'t join'], '', true), 'The rep and Malka see this on the tracker.')}${chk('ok', 'Portal has their corrections and new contacts (or they had none)')}`; },
    example: () => ({ is: 'Booked', ok: true }),
    validate: () => V('ok') && V('is') ? '' : 'Pick the in-service status and tick the portal box.',
    done: t => { facById(t.fac).inservice = V('is'); },
    opens: t => { const f = facById(t.fac); return { subject: 'Follow up with ' + (f.wound && f.wound.name) + ' / ' + (f.regional && f.regional.name), body: '<p>No reply to the in-service & contacts request in 5 business days. Follow up, and mark the task done once the portal contacts are updated.</p>' }; }
  },
  CHICAGO_FOLLOW: {
    title: t => 'Chicago hasn\'t sent the facility email: ' + facName(facById(t.fac)),
    form: () => `<div class="instr">The system nudged Chicago once. Reach out to ${esc(st.settings.chicagoGreeting)} directly.</div>${chk('ok', 'Chicago confirmed it went out')}`,
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when confirmed.',
    done: (t, ctx) => markEmail2(facById(t.fac), ctx.byName),
    opens: t => ({ subject: 'Chicago still hasn\'t sent it: ' + facName(facById(t.fac)), body: '<p>5 business days since the Chicago handoff email and no transfer notice to the facility yet. Reach out to ' + esc(st.settings.chicagoGreeting) + ' directly.</p>' })
  }
};

function portalForm(f) {
  const g = FG(f), d = f.dates, rep = nameOf(f.rep);
  const nonCovEnt = g.cov.Enteral === 'Covered and Noncovered';
  const rows = [['"Account Manager"', nameOf(acctOf(f)) || '(none picked. Pick one on the facility page)'], ['"Biller"', st.settings.biller], ['"Clinical Review"', nameOf(f.clin || f.rep)], ['"Insurance Specialist", "Intake Specialist"', rep], ['"Price Table"', g.price ? g.price + ' (Amy usually fills it. Empty → type it)' : 'Already set up for this corporate. Leave it as it is.'], ['"Pricing Group"', 'Placeholder Pricing Group'],
    ['"Main Vendor"', f.gdd === 'Yes' ? f.gddWh : f.gdd === 'No' ? 'Not GDD. Leave it as it is' : 'Chris hasn\'t answered yet. Leave it. If he says GDD, you get a separate task'],
    ['"Emergency Supply Days"', '4'], ['"Ship Point"', String(d.ship) + ' (' + f.state + ')'], ['"Ship Point- United Ostomy, Fordmed"', String(d.shipOst || '')],
    ['"Pump Brand"', 'Brand in the feed set name on the report (Cardinal KGR Omni Feed Set → Omni). No spike set on the report → from "Pump Tracking" (Eduardo: ' + (f.pumps === 'checked' ? 'checked ✓' : 'not checked yet') + ')'],
    ['"Spike Set"', 'Item code on the report minus the 3-letter prefix + "-N" (CAR-BSPFF → BSPFF-N). None on the report → leave blank'], ['"Syringe"', 'ISE-N'], ['"Drainage Bag"', '10273-N'],
    ...AREAS.map(a => ['"CoverageType": ' + a + (f.cov && f.cov[a] ? ' (this facility only)' : ''), g.cov[a] + (a === 'Supplements' ? ' (report shows supplements sent → Facility Bulk Order)' : '')]),
    ['"Auto-supply ENFIT adapter"', nonCovEnt ? 'Check it if the pump is Kangaroo or Omni. Otherwise leave it' : 'Leave unchecked (enteral isn\'t non-covered)'],
    ['"Notes" and "General Info"', 'Transition from Chicago / email Shani list of eligible pump and trach pts so she can check the prior Gentell billing / anything useful from the report (skip respiratory) / no spike set on the report → "Rep to find out which spike set they use at the first pump-fed patient"']];
  if (!g.noteDone) rows.push(['Corporate note ("Corporates")', 'Don\'t charge shipping for special orders or pumps (we will charge for rush shipping, but get corp approval for rush orders)']);
  return `<div class="instr">portal.isgmed.com → "Facilities" → "Facilities" → search 1 word → check "Corporate" → edit pencil. Leave every other field as it is. Have the Brightree report open for the pump, spike set and supplements lines.</div><div class="note">Nothing here gets typed back into this app.</div><div class="tablewrap"><table class="vals">${rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join('')}</table></div><div class="note">EMR and contacts are separate tasks, so this doesn't wait on them.</div>${chk('ok', 'Saved ("Facility successfully updated.")')}`;
}
function dateEditor(f) {
  const d = f.dates, r = f.rec, w = dateWarn(f, d.dos);
  return `<div class="card" style="padding:10px" id="dedit"><b>${d.changed ? 'Dates (changed)' : 'Recommended dates'}</b>${tip('Change any 1 date and the other 2 move with it.')}
  <div class="row">${fld('Ordering date', dt('de_ord', d.ord))}${fld('Date of service', dt('de_dos', d.dos))}${fld('Delivery date', dt('de_del', d.del))}</div>
  <div class="meta" id="de_info">${d.day} delivery · OS Days ${d.os} · ${d.partB ? 'Part B only: ordering 2 business days before DOS' : 'ordering 1 business day before DOS'} · Ship Point ${d.ship}</div>
  <div id="de_warn">${w.map(x => '<div class="err" style="margin-top:6px">' + esc(x) + '</div>').join('')}</div>
  ${r && d.changed ? `<div class="meta">Recommended: ${fmt(r.dos)} (${esc(basisText(f))}).</div>` : ''}
  <details style="margin-top:6px"><summary class="meta">How the recommended dates were calculated</summary><ul class="meta">${(r || d).why.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></details>
  <div class="row" style="margin-top:6px"><button type="button" class="btn sm pri" data-savedates="${f.id}">Save dates</button>${d.changed ? `<button type="button" class="btn sm" data-recdates="${f.id}">Back to recommended</button>` : ''}</div></div>`;
}
function scheduleForm(f) {
  const d = f.dates, b = f.bt;
  return `${dateEditor(f)}<div class="instr"><ol><li>"Facilities" → schedule icon under "Actions" → "Facility Schedule".</li><li>"Start Date" <span class="q">${fmtS(d.del)}</span>, "Day of the Week" <span class="q">${d.day}</span>, "Weeks" <span class="q">4</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>${b.cadence !== '4' ? `<li>"Select Area of Care" → "Enteral" → "Add Schedule": same Start Date and day, "Weeks" <span class="q">${b.cadence}</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>` : ''}<li>"Generate Dates" → check "Override Manually" → "Save".</li><li>"Schedules" → Ordering Calendar → open the entry on ${fmt(d.ord)} and check the 3 dates match the ones above. Wrong? Recheck Start Date, Day of the Week and OS Days and generate again. Missing? The ordering date probably landed on a weekend.</li><li>Intake note: <span class="q">Transition from Chicago</span> + <span class="q">Email Shani the list of eligible pump fed and trach pts so she can review Chicago's billing</span> + anything useful from the report.</li></ol></div>
  <div class="note">"Mark done" sends the Chicago handoff email with these dates. Changed a date above? Click "Save dates" first.</div>`;
}
