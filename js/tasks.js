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
const peopleOpts = list => list.map(p => [lc(p.email), p.name]).sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: 'base' }));
// a rule box where blank means "picked per facility"
const selPer = (id, opts, v) => sel(id, opts, v, true).replace('<option  value="">Select…</option>', '<option value="">Per facility</option>').replace('<option value="">Select…</option>', '<option value="">Per facility</option>');
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
// screenshot boxes (FastCare task: facility + corporate contacts; Settings test). Paste (Ctrl+V) or pick an image.
// Kept in ui.shots until "Mark done" / "Send me a test" uploads them. which = 'fac' | 'corp'.
const shotFor = (t, which) => { const s = typeof ui !== 'undefined' && ui.shots && ui.shots['fc_' + which]; return s && s.task === t.key ? s : null; };
function shotZone(ctx, which, s) {
  const id = 'shot_' + ctx + '_' + which;
  return `<div class="drop shot" id="${id}" data-shot="${ctx}_${which}" tabindex="0">${s ? `<img src="${s.url}" alt="Screenshot"><div><button type="button" class="btn sm" data-shotx="${ctx}_${which}">Remove</button></div>` : `<b>Click here and press Ctrl+V</b> to paste a screenshot, or <label class="linkish" for="${id}_file">choose an image</label>`}<input type="file" id="${id}_file" data-shotfile="${ctx}_${which}" accept="image/*" hidden></div>`;
}
const contactTable = list => `<div class="tablewrap"><table><tr><th>First</th><th>Last</th><th>Department</th><th>Email</th><th>From</th></tr>${list.map(c => `<tr><td>${esc(c.first) || '<span class="meta">no first name</span>'}</td><td>${esc(c.last)}</td><td>${esc(c.dept)}${c.note ? ' → "Note": ' + esc(c.note) : ''}</td><td>${esc(c.email)}</td><td>${esc(c.src)}</td></tr>`).join('')}</table></div>`;

// FastCare asks for the corporate / address only while they're still missing (they can be filled on the facility page first)
const fcNeed = t => { const n = t.need || {}, f = facById(t.fac) || {}; return { corp: !!n.corp && !f.group, addr: !!n.addr && !f.address }; };
// ---------- the task types ----------
const TT = {
  RULE: {
    title: t => t.group === '__nocorp' ? 'Pick the reps (corporate not known yet)' : 'Pick the reps for ' + t.group,
    form: t => {
      const fs = ruleFacs(t), R = peopleOpts(repList()), A = peopleOpts(amList()), g = t.group === '__nocorp' ? null : grp(t.group);
      const has = g && partialRule(g) && ruleText(g);
      // a row's box: needed → a dropdown; already set (by the rule or on the facility) → shown, still changeable
      const cell = (f, p) => { const opts = p === 'am' ? A : R, v = p === 'clin' ? f.clin : p === 'acct' ? f.acct : p === 'am' ? f.am : f.rep, need = ruleNeeds(f).includes(p) || (p === 'am' && !f.am && !(g && g.am)) || (p === 'rep' && !f.rep);
        return `<td class="${need ? 'need' : ''}">${sel(p + '_' + f.id, opts, v, true)}${!v && !need ? `<div class="meta">${p === 'clin' ? 'same as intake' : p === 'acct' ? (g && g.acct ? 'from the rule' : 'none') : 'from the rule'}</div>` : ''}</td>`; };
      return `<div class="instr">${fs.length} facilit${fs.length === 1 ? 'y needs' : 'ies need'} reps picked.${has ? ' The corporate rule fills some positions (' + esc(ruleText(g)) + '); pick the rest per facility.' : ''} Same people for all? Fill the top row and click "Apply to all" (blank boxes in the top row are skipped). Different per facility? Change the rows below. Boxes outlined in blue are the ones still needed.</div>
      <div class="card" style="padding:10px"><b>All facilities</b><div class="row">${fld('Intake rep', selPer('rep', R, has ? g.rep : ''))}${fld('Clinical rep', selPer('clin', [['__same', 'Same as intake rep'], ...R], has ? (g.clinSame ? '__same' : g.clin) : '__same'))}${fld('Account manager', selPer('acct', R, has ? g.acct : ''))}${fld('Transition lead', selPer('am', A, has ? g.am : ''))}</div><button type="button" class="btn sm" data-applyall="1">Apply to all ↓</button></div>
      <div class="tablewrap"><table class="ruletbl"><tr><th>Facility</th><th>Intake rep</th><th>Clinical rep</th><th>Account manager</th><th>Transition lead</th></tr>${fs.map(f => `<tr><td>${esc(f.name)}</td>${['rep', 'clin', 'acct', 'am'].map(p => cell(f, p)).join('')}</tr>`).join('')}</table></div>
      ${fld('Why these reps? (optional)', txt('why', '', 'Goes in the email to the transition lead'))}
      ${t.group === '__nocorp' ? '' : chk('rule', 'Save the top row as the corporate rule. Future facilities under this corporate get the positions filled in automatically; positions left blank are picked per facility each time.', true)}`;
    },
    example: t => { const r = repList()[0], a = amList()[0], o = { rep: lc(r.email), am: lc(a.email), clin: '__same', acct: lc(r.email) }; ruleFacs(t).forEach(f => { o['rep_' + f.id] = lc(r.email); o['am_' + f.id] = lc(a.email); }); return o; },
    validate: t => {
      const g = t.group === '__nocorp' ? null : grp(t.group), top = p => { const v = V(p); return p === 'clin' && v === '__same' ? '' : v; };
      if (V('rule') && !['rep', 'clin', 'acct', 'am'].some(p => top(p)) && V('clin') !== '__same') return 'To save a corporate rule, fill at least 1 position in the top row (or untick "Save the top row as the corporate rule").';
      for (const f of ruleFacs(t)) {
        // a blank row box takes the top row's value; a position the new rule fills counts as filled
        const willRule = p => V('rule') && g && (p === 'clin' ? !!V('clin') : !!top(p));
        const has = p => !!(V(p + '_' + f.id) || top(p) || willRule(p) || (p === 'clin' && V('clin') === '__same') || (p === 'am' && (f.am || (!V('rule') && g && g.am))) || (p !== 'am' && f[p]));
        const need = [...new Set(['rep', 'am', ...(V('rule') && g ? ['rep', 'clin', 'acct', 'am'].filter(p => p === 'clin' ? !V('clin') : !top(p)) : ruleNeeds(f))])];
        const miss = need.filter(p => !has(p));
        if (miss.length) return f.name + ': pick the ' + miss.map(posName).join(', ') + ' (or fill the top row).';
      }
      return '';
    },
    done: (t, ctx) => {
      const g = grp(t.group), top = p => V(p) === '__same' ? '' : V(p);
      if (g && V('rule')) setRule(g, { rep: V('rep'), clin: V('clin'), acct: V('acct'), am: V('am') });
      const byAm = {};
      ruleFacs(t).forEach(f => {
        f.rep = V('rep_' + f.id) || top('rep') || f.rep || (g && g.rep) || '';
        f.clin = V('clin_' + f.id) || top('clin') || f.clin || (g && g.clin && !g.clinSame ? g.clin : '') || f.rep;
        f.acct = V('acct_' + f.id) || top('acct') || f.acct || '';
        f.am = V('am_' + f.id) || top('am') || f.am || (g && g.am) || '';
        const a = amOf(f); (byAm[a] = byAm[a] || []).push(f);
      });
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
    form: t => { const g = grp(t.group); return `<div><b>Areas of care and what we're supplying</b>${areasTableHtml(g)}</div><div class="meta">Facilities: ${facsOfGroup(g.name).map(x => esc(x.name)).join(', ')}</div>${fld('"Price Table"', txt('price', g.price || '', 'e.g. Infinity (GNS G/XCEL25)'))}`; },
    example: () => ({ price: 'Infinity (GNS G/XCEL25)' }),
    validate: () => V('price') ? '' : 'Enter the price table.',
    done: t => { grp(t.group).price = V('price'); }
  },
  EMR: {
    title: t => 'EMR access for ' + t.group,
    form: t => { const gf = facsOfGroup(t.group).filter(x => !x.hold); return `<div class="instr">Enter "Emr", "Emr Username" and "Emr Password" in the portal on each facility below. Save the QR code on the server in the "Authenticator" folder, named the username.</div><div class="note">Only the username goes in here: the system needs it to ask corporate to add new facilities in this group to the same login.</div><ul>${gf.map(x => '<li>' + esc(facName(x)) + (x.inPortal ? '' : ' <b>(not in the portal yet)</b>') + '</li>').join('')}</ul>${fld('"Emr Username"', txt('user', grp(t.group).emr || '', 'e.g. ihcm.lakewood'))}${chk('ok', 'Entered in the portal on every facility above, and saved the QR code')}`; },
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
    form: t => { const f = facById(t.fac), g = G(f); return `<div class="kv"><div>Name</div><div>${esc(f.name)}</div><div>Address</div><div>${esc(f.address)}</div><div>Corporate</div><div>${g.standalone ? '<b>None. Set it up as its own corporate named "' + esc(f.group) + '"</b>' : esc(f.group)}</div><div>Price table</div><div>${esc(g.price || (g.existing ? 'Already set up for this corporate' : ''))}</div></div><div class="meta">Add it if it isn't there yet. Already there? Just mark done.</div>${fld('Facility name as Brightree shows it', txt('pn', f.portalName || '', 'Waters Of Lagrange- 211526'), 'Every email uses it.')}`; },
    example: t => ({ pn: facById(t.fac).name + '- 2115' + (26 + t.fac) }),
    validate: () => V('pn') ? '' : 'Enter the name as Brightree shows it.',
    done: t => { const f = facById(t.fac); f.inPortal = true; f.portalName = V('pn'); }
  },
  PUMPS: {
    title: t => 'Pumps: ' + facName(facById(t.fac)),
    form: () => `<div class="instr">Check if GNS Chicago sent this facility pumps, and add any to "Pump Tracking" in the portal.</div><div class="note"><b>${esc(PUMP_RULE)}</b></div>${chk('c', 'Checked, and added any pumps')}`,
    example: () => ({ c: true }), validate: () => V('c') ? '' : 'Tick when you\'ve checked.',
    done: t => { facById(t.fac).pumps = 'checked'; },
    quick: (t, a) => a === 'Checked' ? (facById(t.fac).pumps = 'checked', true) : false
  },
  GDD: {
    title: t => 'GDD orders for ' + facById(t.fac).name + '?',
    form: t => { const f = facById(t.fac); return `${fld('Did it get orders from GDD?', sel('g', ['Yes', 'No'], ['Yes', 'No'].includes(f.gdd) ? f.gdd : ''))}<div id="whbox" ${f.gdd === 'Yes' ? '' : 'hidden'}>${fld('Which warehouse?', sel('wh', st.settings.warehouses, f.gddWh || '', true), 'Missing from the list? Ask Raizy to add it in Settings.')}</div>`; },
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
      const f = facById(t.fac), n = fcNeed(t);
      const corpOpts = [...Object.values(st.groups).filter(g => !g.standalone).map(g => g.name).sort(az), 'New corporate…', 'No corporate (Independent HQ)'];
      return `<div class="instr">fastcare.gentell.com → "Facility" → "Search:" (1 word if the full name doesn't come up).${n.corp ? ' Corporate = "Ownership-Headquarters" / "Purchasing Group-Chain". "Independent HQ" means no corporate.' : ''} "Actions" → "Edit Facility" for the wound rep + regional, "Actions" → "Contacts" for contacts.</div>
      ${n.corp ? `<div class="row">${fld('Corporate', sel('fc_grp', corpOpts, f.group && grp(f.group) && !grp(f.group).standalone ? grp(f.group).name : '', true))}<div class="field" id="fc_newbox" hidden><label>New corporate name</label>${txt('fc_new', '')}</div></div>` : ''}
      ${n.addr ? fld('Address', txt('fc_addr', f.address || '', '123 Main St, City, ST 12345'), 'Paste it as it is in the portal. The state can be the 2 letters or the full name.') : ''}
      <div class="row">${fld('Wound and Product Specialist', personPick('w', f.wound), 'Pick from the list; it fills their Gentell email.')}${fld('Regional Manager', personPick('r', f.regional))}</div>
      <div class="sect">Contacts${tip('Take a screenshot of the contacts in FastCare and paste it here: facility contacts, corporate contacts, or both. They go into the contacts request so the wound rep and regional can check them.')}</div>
      <div class="row"><div class="field"><label>Facility contacts</label>${shotZone('fc', 'fac', shotFor(t, 'fac'))}</div><div class="field"><label>Corporate contacts</label>${shotZone('fc', 'corp', shotFor(t, 'corp'))}</div></div>
      ${f.contactsShot || f.corpShot ? `<div class="note">Already saved: the ${[f.contactsShot && 'facility', f.corpShot && 'corporate'].filter(Boolean).join(' and ')} contacts screenshot. Paste a new one only to replace it.</div>` : ''}
      ${chk('fc_nocts', 'No FastCare contacts available')}
      ${e3List(f).length ? `<div class="note">These also go in the email (added on the request, facility page or corporate): ${e3List(f).map(c => esc((c.first + ' ' + c.last).trim() || c.email)).join(', ')}</div>` : ''}`;
    },
    example: t => { const n = fcNeed(t); const o = { w: 'Peter West <peter.west@demo.gentell.com>', r: 'Brian McCauley <brian.mccauley@demo.gentell.com>' }; if (n.corp) { o.fc_grp = 'New corporate…'; o.fc_new = 'Infinity Healthcare Management'; } if (n.addr) o.fc_addr = '123 Demo St, LaGrange, IN 46761'; o.fc_nocts = true; return o; },
    validate: t => {
      const n = fcNeed(t);
      if (n.corp && !V('fc_grp')) return 'Pick the corporate (or "No corporate").';
      if (n.corp && V('fc_grp') === 'New corporate…' && !V('fc_new')) return 'Type the new corporate name.';
      // FastCare only needs an address it can read. A state with no ship point doesn't stop it: the transition lead gets an "Address" task that waits for one.
      if (n.addr && addressFormatProblem(V('fc_addr'))) return addressFormatProblem(V('fc_addr'));
      if (!readPerson('w')) return 'Pick the wound rep from the list (start typing their name).';
      if (!readPerson('r')) return 'Pick the regional from the list (start typing their name).';
      const f = facById(t.fac);
      if (!shotFor(t, 'fac') && !shotFor(t, 'corp') && !V('fc_nocts') && !f.contactsShot && !f.corpShot) return 'Paste a screenshot of the facility or corporate contacts (or both), or tick "No FastCare contacts available".';
      return '';
    },
    done: t => {
      const f = facById(t.fac), n = fcNeed(t);
      if (n.addr) { f.address = normAddr(V('fc_addr')); f.state = stateFrom(f.address); }
      if (n.corp) {
        const v = V('fc_grp');
        if (v === 'No corporate (Independent HQ)') makeStandalone(f);
        else { const g = ensureGroup(v === 'New corporate…' ? V('fc_new') : v); f.group = g.name; if (f.pendingCov) g.cov = Object.assign({}, f.pendingCov, g.cov || {}); }
      }
      const sv = (typeof ui !== 'undefined' && ui.shotSaved) || {};
      // done again after being put back: screenshots already saved stay unless a new one is pasted or "No FastCare contacts" is ticked
      const keep = !V('fc_nocts');
      f.contactsShot = sv.fac || (keep && f.contactsShot) || null; f.corpShot = sv.corp || (keep && f.corpShot) || null; f.noFcContacts = !f.contactsShot && !f.corpShot && !!V('fc_nocts');
      f.wound = readPerson('w'); f.regional = readPerson('r');
    }
  },
  BRIGHTREE: {
    title: t => 'Brightree report: ' + facById(t.fac).name,
    form: t => { const f = facById(t.fac); return `<div class="instr"><ol><li>GNS Chicago's Brightree: search the facility, copy "Name" exactly.</li><li>Star → "My Ad-Hoc Reports" → "GNS Lakewood Report". Error → log back in.</li><li>"Sales Order_Facility" "Equals" the name. "Delivery_Scheduled date" "Between" 01/01/2026 and <b>${fmtS(st.today)}</b>. "Request Report".</li><li>"My Scheduled Reports" → wait for "Completed" → open the CSV.</li><li>Sort by "Patient Full Name", then "Delivery Actual date" (column E, <b>never D</b>). Bottom row per area of care (column R).</li><li>"Save As" → "Excel Workbook" → Z: > GNS Chicago Transition > Sales Order Reports > ${esc(f.group || '(corporate)')} (create the folder if it's missing). Name it <span class="q">${esc(facName(f))} ${fmtS(st.today).replace(/\//g, '-')}</span>.</li></ol></div><div class="note">Only what the system needs goes in here: the dates (for scheduling), and how often enteral ships (the Chicago handoff email + schedule). Everything else on the report goes straight into the portal. Dates calculate from it.</div>
      <div class="row">${fld('Last enteral (Delivery Actual date)', dt('le', (f.bt || {}).lastEnt))}${fld('Last uro / ostomy / trach', dt('lo', (f.bt || {}).lastOuts))}</div>
      <div class="row">${fld('Enteral ships', sel('cad', ['Monthly', 'Weekly', 'Biweekly'], ({ 4: 'Monthly', 2: 'Biweekly', 1: 'Weekly' })[(f.bt || {}).cadence] || 'Monthly'))}</div>`; },
    example: () => ({ le: add(st.today, -19), lo: add(st.today, -23), cad: 'Monthly' }),
    validate: () => { if (!V('le') && !V('lo')) return 'Enter at least 1 last delivery date.'; if ((V('le') && V('le') > st.today) || (V('lo') && V('lo') > st.today)) return 'A last delivery date can\'t be in the future.'; if (!V('cad')) return 'Pick how often enteral ships.'; return ''; },
    done: (t, ctx) => { const f = facById(t.fac); f.bt = { lastEnt: V('le'), lastOuts: V('lo'), cadence: ({ Monthly: '4', Biweekly: '2', Weekly: '1' })[V('cad')] || '4' }; f.btAt = nowIso(); f.btBy = ctx ? ctx.byName : ''; }
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
    form: t => { const f = facById(t.fac); return `<div class="instr">${f.address ? 'The address on file is <span class="q">' + esc(f.address) + '</span>, but ' + (stateFrom(f.address) ? 'there\'s no ship point for ' + esc(stateFrom(f.address)) + ' in Settings ("Ship points"). Ask Raizy to add it; this task closes itself once she does.' : 'it doesn\'t end with a state and zip.') : 'We don\'t have an address for this facility.'} The state decides the ship point, which decides the delivery date, so dates can\'t be worked out without it.</div>${fld('Full address', txt('ad_addr', f.address || '', '123 Main St, City, ST 12345'))}`; },
    example: () => ({ ad_addr: '123 Demo St, LaGrange, IN 46761' }),
    validate: () => addressProblem(V('ad_addr')),
    done: t => { const f = facById(t.fac); f.address = normAddr(V('ad_addr')); f.state = stateFrom(f.address); }
  },
  E3_REPLY: {
    title: t => 'Contacts reply: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac), r = t.reply || {}, m = (st.inbox || []).find(x => x._id && x._id === r.inbox);
      return `<div class="instr">${esc(r.from ? e3Who(f, r.from) : 'Someone')} replied to the contacts request${r.at ? ' on ' + fmt(r.at) : ''}. Put the info they sent (new contacts, corrections) into the portal.${m && m.path ? ` <a href="${esc(STORE.fileUrl(m.path))}" target="_blank" rel="noopener">Open their email</a>` : ''}</div>${m && m.preview ? `<div class="note">"${esc(m.preview.slice(0, 300))}"</div>` : ''}${fld('Where things stand', sel('e3s', [['done', 'Their info is in the portal'], ['more', 'They didn\'t send everything yet: keep following up']], '', true))}`; },
    example: () => ({ e3s: 'done' }), validate: () => V('e3s') ? '' : 'Pick where things stand.',
    done: t => { const f = facById(t.fac); if (V('e3s') === 'more') { f.e3Reply = null; f.e3Round = (f.e3Round || 0) + 1; f.e3RoundFrom = st.today; } else markE3Done(f, typeof meName === 'function' ? meName() : ''); }
  },
  EMAIL3_FOLLOW: {
    title: t => 'Contacts follow-up: ' + facName(facById(t.fac)),
    form: t => { const f = facById(t.fac); const who = [...new Set([f.wound && f.wound.name, f.regional && f.regional.name].filter(Boolean))].map(esc).join(' and ') || 'the wound rep and regional'; return `<div class="instr">The contacts request went to ${who}${f.email3 ? ' on ' + fmt(f.email3) : ''}. It asked them to check our contacts, send the missing ones and get the in-service booked.<ol><li>Find their reply (subject <span class="q">${esc(facName(f))}- Transfer from GNS Chicago to Lakewood</span>).</li><li>Put any corrections and new contacts into the portal.</li><li>Pick the in-service status below and mark done.</li></ol></div><div class="note">Replies to ${esc(CFG.mailbox)} also show on the facility page under "Mailbox". No reply yet? Follow up with them, or mark done with "Not yet".</div>${fld('In-service', sel('is', ['Booked', 'Not yet', 'Facility didn\'t join'], '', true), 'The rep and Malka see this on the tracker.')}${chk('ok', 'Portal has their corrections and new contacts (or they had none)')}`; },
    example: () => ({ is: 'Booked', ok: true }),
    validate: () => V('ok') && V('is') ? '' : 'Pick the in-service status and tick the portal box.',
    done: t => { facById(t.fac).inservice = V('is'); },
    opens: t => { const f = facById(t.fac); return { subject: 'Follow up with ' + (f.wound && f.wound.name) + ' / ' + (f.regional && f.regional.name), body: '<p>No reply to the contacts request in 5 business days. Follow up, and mark the task done once the portal contacts are updated.</p>' }; }
  },
  PORTAL_UPDATE: {
    title: t => 'Update the portal: ' + facName(facById(t.fac)),
    form: t => { const items = t.items || []; return `<div class="instr">These details changed after the portal setup was done. portal.isgmed.com → "Facilities" → "Facilities" → search 1 word → edit pencil. Change each field to the value under "Now".</div><div class="tablewrap"><table class="vals"><tr><th>Field</th><th>Was</th><th>Now</th></tr>${items.map(i => `<tr><td>${esc(pvLabel(i.k))}</td><td>${esc(i.from) || '<span class="meta">blank</span>'}</td><td><b>${esc(i.to) || 'blank'}</b></td></tr>`).join('')}</table></div>${items.some(i => i.k === 'addr' || i.k === 'corp') ? '<div class="note">Address or corporate: change it in Brightree too.</div>' : ''}<div class="note">If something else changes before you do this, it's added to this list. If a change is undone, it comes off.</div>${chk('ok', 'Updated in the portal')}`; },
    example: () => ({ ok: true }), validate: () => V('ok') ? '' : 'Tick when the portal is updated.', done: () => { }
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
// the Brightree report's dates, editable on the schedule task. After 8 hours it opens with a warning to run the report again.
function btRecheck(f) {
  const b = f.bt || {}, w = btWhen(f), stale = btStale(f);
  const fields = `<div class="row">${fld('Last enteral (Delivery Actual date)', dt('rc_le', b.lastEnt))}${fld('Last uro / ostomy / trach', dt('rc_lo', b.lastOuts))}${fld('Enteral ships', sel('rc_cad', ['Monthly', 'Weekly', 'Biweekly'], ({ 4: 'Monthly', 2: 'Biweekly', 1: 'Weekly' })[b.cadence] || 'Monthly'))}</div><div id="rc_err"></div><div class="row"><button type="button" class="btn sm pri" data-recheckbt="${f.id}">Save and recalculate</button></div><div class="meta">Saving with new dates recalculates the recommended dates below${f.dosChosen ? ' and replaces the date of service picked by hand (' + fmt(f.dosChosen) + ')' : ''}. Same dates? Saving just records that you rechecked.</div>`;
  if (stale) return `<div class="card warnbox" id="btrc"><b>⚠ The Brightree report was run ${w ? esc(btWhenText(w)) : 'a while ago'}</b>${w && w.exact ? '' : ' <span class="meta">(time not recorded)</span>'}<div style="margin:4px 0 8px">That's more than 8 hours ago. Chicago may have shipped since, so the last delivery dates may have changed. Recommended: run the report again (same steps as the Brightree report task) and check the last delivery dates. Update them here if they changed.</div>${fields}</div>`;
  return `<details class="card" style="padding:10px" id="btrc"><summary><b>Brightree report dates</b> <span class="meta">(run ${w ? esc(btWhenText(w)) : '-'}${f.btBy ? ' by ' + esc(f.btBy) : ''})</span></summary><div class="meta" style="margin:6px 0">Last enteral ${b.lastEnt ? fmtS(b.lastEnt) : '-'} · last uro / ostomy / trach ${b.lastOuts ? fmtS(b.lastOuts) : '-'}. Reran the report and something changed? Fix it here.</div>${fields}</details>`;
}
function scheduleForm(f) {
  const d = f.dates, b = f.bt;
  return `${btRecheck(f)}${dateEditor(f)}<div class="instr"><ol><li>"Facilities" → schedule icon under "Actions" → "Facility Schedule".</li><li>"Start Date" <span class="q">${fmtS(d.del)}</span>, "Day of the Week" <span class="q">${d.day}</span>, "Weeks" <span class="q">4</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>${b.cadence !== '4' ? `<li>"Select Area of Care" → "Enteral" → "Add Schedule": same Start Date and day, "Weeks" <span class="q">${b.cadence}</span>, "OS Days" <span class="q">${d.os}</span>. "Save".</li>` : ''}<li>"Generate Dates" → check "Override Manually" → "Save".</li><li>"Schedules" → Ordering Calendar → open the entry on ${fmt(d.ord)} and check the 3 dates match the ones above. Wrong? Recheck Start Date, Day of the Week and OS Days and generate again. Missing? The ordering date probably landed on a weekend.</li><li>Intake note: <span class="q">Transition from Chicago</span> + <span class="q">Email Shani the list of eligible pump fed and trach pts so she can review Chicago's billing</span> + anything useful from the report.</li></ol></div>
  <div class="note">"Mark done" sends the Chicago handoff email with these dates. Changed a date above? Click "Save dates" first.</div>`;
}
