# Chicago Transitions app: notes for Claude

Raizy Kreiser (PM, Gentell Nutritional Services) owns this. She isn't a developer: she asks for changes in plain words, you make them, test them, and push to `main`. GitHub Pages publishes `main` within about a minute. Keep answers to her short and non-technical.

## What it is
A task app that runs the Chicago → Lakewood facility transition process from the Quick Guide / Reference Guide. Plain HTML + JavaScript, no build step, hosted on GitHub Pages. Data lives in SharePoint lists on the site in `config.js`. People sign in with Microsoft (MSAL, app registration in Gentell's Entra tenant). Two Power Automate flows (run by Raizy) send email and read the shared mailbox.

## Files
- `config.js`: tenant, app (client) ID, SharePoint site, shared mailbox, app URL. Empty clientId = demo mode.
- `js/engine.js`: the rules. `run()` creates every task and email that's due. Dates, email wording (Chicago handoff email / in-service & contacts request templates), reminders, inbox matching.
- `js/tasks.js`: the task types (`TT`): title, form, validate, done, opens (waiting tasks), quick (email-button answers).
- `js/store.js`: loading and saving. `SPStore` (Microsoft Graph) and `DemoStore` (in memory).
- `js/analytics.js`: the Analytics screen, laid out like the "Transition Lead Analytics" preview Raizy approved: takeaway line, 7 tiles, tabs Overview / Bottlenecks / Schedule / Corporates / Facilities. The 8 steps are `MS` (FastCare → GDD answer). Read-only: never changes or saves data. Loaded before ui.js.
- `js/ui.js`: screens and clicks. Every change goes through `act()`: reload → change → `run()` → save → reload.
- `index.html`, `style.css`, `vendor/msal-browser.min.js` (MSAL 4.30.0, UMD).

## Data (SharePoint lists, created by the app's first-run setup)
- **CT Data**: 1 row per record. Columns `Key` (unique), `Kind` (settings/grp/fac/task/req), `Data` (JSON), `Ct` (CT-0001, facilities only), `Am` (AM email, facilities only, used by the mailbox flow), `Archived` (Yes/No).
- **CT Outbox**: 1 row per email. `Key` (unique), `Code`, `ToList`, `CcList` (semicolon-separated), `Subject`, `HtmlBody`, `SendOn` (UTC), `SendStatus` (Queued/Sent/Failed/Cancelled), `Facility`, `TaskKey`, `Cond` (JSON: when to cancel), `ErrorText`, `Importance` (Normal/High), `AttachPath`+`AttachName` and `AttachPath2`+`AttachName2` (up to 2 screenshots: facility and corporate contacts; path like "/Shared Documents/CT Request files/CT-0001/facility-contacts-CT-0001.jpg", referenced in the body as `cid:<name>`). `GraphMessage` = the whole email as Microsoft Graph message JSON (subject, HTML body, to/cc, importance, attachments with "@@A1@@"/"@@A2@@" placeholders). The flow reads the screenshot files with "Get file content using path" (falls back to `CT Request files/none.txt`; "Infer content type" must be No, or none.txt comes back as text and the send step fails), swaps them in as inline attachments (contentId = AttachName) and sends via Office 365 Outlook "Send an HTTP request": create the message in the shared mailbox, then /send. (The shared-mailbox send step can't show pictures inside the email.) These columns were added later; the app adds them on sign-in and fills GraphMessage on older queued rows.
- **CT Inbox**: written by the "CT - Mailbox" flow. `Title` (subject), `FromAddress`, `ToAddresses`, `CcAddresses`, `Received`, `Preview`, `FilePath` (.eml saved in Documents/CT Mailbox), `Processed`, `Facility`.
- **CT Numbers**: 1 row per facility; the item ID is the facility's CT number.

Never rename these lists or columns: the flows use them.

## Rules that matter
- Keys must be deterministic (same task/email → same key) so 2 browsers never create duplicates; the unique `Key` column rejects the second one.
- Emails are never sent by the browser. The app writes Outbox rows; the flow sends `Queued` rows whose `SendOn` has passed. Later emails (reminders, nudges, first-order day) are queued with a future `SendOn` and a `cond`; `run()` cancels them when they're no longer needed.
- Saving merges top-level fields with the latest saved version (see `mergeChanged`), so 2 people editing the same facility don't overwrite each other.
- Failures must show (banner, Failed email status). Never fail silently.
- Changing a list/column the flows read means Raizy has to change the flow too: tell her exactly what to click.

## Names users see
Never say "Email 1/2/3" in the UI or emails. Internally (code, `email1`/`email2`/`email3` fields, E14/E16 codes) they still are. Email 1 = "Chicago handoff email" (us → GNS Chicago). Email 2 = "Transfer notice to facility" (GNS Chicago → facility). Email 3 = "Contacts request" (us → wound rep + regional; was "In-service & contacts request" before Oct 16 2026).

## People on a facility
`am` in the data (`f.am`, `g.am`, `p.am`, `amOf`, the `Am` column) is the **transition lead**: runs the transition, gets the tasks and emails. Never rename it (the mailbox flow reads `Am`). The **account manager** is `acct` (`f.acct`, `g.acct`, `acctOf`): picked from the "Rep / account manager" list and CC'd only where the intake rep gets email (Chicago handoff, in-service & contacts request). It also fills the portal's "Account Manager" field.

## Email 3 (contacts request) and the in-service ask
Since Oct 16 2026 the two asks are split. The contacts request (`sendEmail3`, `f.e3v2`) goes to the wound rep + regional the moment the FastCare task is done, asks only for contacts, subject "<facility>- Contacts needed: Transfer from GNS Chicago to Lakewood". The in-service ask is on the Chicago handoff email: the wound rep + regional are in To and `inserviceAsk(f)` adds a line addressed to them in the top part (above the `<hr>`, so Chicago doesn't forward it). Not tracked, not a blocker. Facilities that got the old combined email (no `e3v2`) keep the old subject and wording (`email3BodyOld`) on follow-ups, and still get the in-service line on their handoff. Scheduling never waits on the contacts; completion does.
Email 3 replies: `processInbox` treats any email to the mailbox (in To) with the facility name + "transfer from gns chicago" in the subject (and, for `e3v2` facilities, "contacts needed", so reply-alls to the handoff email don't count), received on/after Email 3, as a reply, unless it's from the mailbox, GNS Chicago (Email 1 To/CC) or someone on the team who isn't the wound rep/regional. A reply sets `f.e3Reply` and makes an `E3_REPLY` task for the transition lead (put their info in; or "keep following up", which starts a new follow-up round `f.e3Round`). No reply: `chaseEmail3` queues 1 step at a time (+3 business days, +3, then an alert to the transition lead). Manual: "Contacts: taken care of" on the facility page. Completion waits on `e3Done`. Follow-ups (E15, E16F, E16A, E17) go out as High importance.

## Reminders
Reminders are E17 emails on a task: automatic (1, 2, 4 business days after due, `ensureTaskMails`) or sent by a transition lead / admin with "Send reminder" (All open tasks, or in the task; key `m:E17:<task>:manual:<day>`). Never 2 on the same task within 24 hours: `canRemind` blocks a manual one, and `spaceReminders` (end of `run()`) moves any queued automatic one that's too close to the one before (weekend → 8 am Eastern next business day). Moved send times are saved (the Outbox snapshot includes SendOn). Demo mode uses a pretend clock: 9 am Eastern on the demo day.

## Archiving
Completed facilities are never archived (since Oct 2026). The first load after opening the app includes archived rows, and `run()` un-archives completed facilities an older version archived, plus their done tasks (open ones stay archived so no old reminders go out). Only deleted facilities stay archived.

## Address and dates
The state (from the address) picks the ship point, which sets the delivery date. `stateOK(f)` = a state with a ship point in Settings. No `stateOK` → `calcDates` returns null and `f.dates` is cleared (before the Chicago handoff email), so portal setup and scheduling can't happen. Once FastCare is done (or skipped), a missing/bad address makes an `ADDRESS` task for the transition lead; it closes itself when the address is fixed anywhere. `parseAddr()` reads any normal US address (state as 2 letters or the full name, with or without a comma, zip or zip+4, trailing "USA"); `normAddr()` saves it as "…, City, ST 12345". The request, facility page and FastCare only need a readable address (`addressFormatProblem`); a state with no ship point doesn't block them, it makes an `ADDRESS` task instead. Only the `ADDRESS` task needs `addressProblem()` (readable + ship point). A state change after the handoff email emails the transition lead (dates stay as sent). Ship points added Oct 16 2026 (AZ DC KS MN MT WV = 2, HI = 3; ostomy AZ = 3, MS = 4) go into live Settings once via `importShip20261016` (only states not already in that table). AK still has no Ship Point (enteral).

## Price table and contacts
PRICE waits for the corporate's areas of care. `isTier2(g)` (everything but wound care is Covered Only / Don't Supply) → `g.price = settings.tier2Price` ("2022 Tier 2"), `g.priceAuto`, no task; if the areas change so it's no longer Tier 2, the auto price is dropped and a PRICE task is made. The PRICE email and task show the areas table.
FastCare contacts go straight into the portal; the FastCare task takes pasted screenshots of facility and/or corporate contacts (`ui.shots` → uploaded on Mark done → `f.contactsShot`, `f.corpShot`) or "No FastCare contacts available". `e3Contacts(f)` builds the 4 variants (screenshot + typed list / screenshot / typed list / none → ask for contacts).

## Request form
Corporate is per line (no dropdown). "Already done" (`PRE_ITEMS` in engine.js, `applyPre`) sets what the skipped steps would have set and the engine skips their tasks; `g.existing` = corporate already in the portal (no price table / EMR access tasks). Info-only emails (`FYI_CODES`) get a "no action needed" line. To-do emails for tasks with steps use `todo()`: one line, details live in the task.

## Put back in the queue / steps marked on the facility page
- A Done task (not Not needed) can be "Put back in the queue" from its drawer, for the same person or someone else (`reopenTask`, `canReopen`). Not for SCHEDULE / CHICAGO_FOLLOW (they sent or recorded the Chicago emails). Nothing it saved is erased: `t.history` keeps who did it, and forms prefill what's on file so re-doing it doesn't blank anything (FastCare keeps its saved screenshots unless new ones are pasted or "No FastCare contacts" is ticked). PUMPS clears `f.pumps = 'checked'`. The person gets an E26 "Back in your queue" email. Some tasks close themselves again if what they ask for is filled in (price table, address); the UI says so.
- Facility page "Mark steps done" uses `PRE_ITEMS` (same list as the request). `markStepsDone` sets what the request's "Already done" would, closes the open tasks in `stepTasks` as Done (`t.closedOnFac`), and sends 1 E25 "Not needed anymore" (FYI) email per assignee other than the person ticking. A step with an open task never shows as done.

## Speed
Saving no longer re-downloads everything: after a save, `SPStore.save` updates its own copy (ids, `base`, and the merged version of each row written in place into the screen's objects), and `settle()` only loads again when `r.reload` is set (a duplicate-key create, a failed write, an email the flow already changed, a row archived/unarchived). Quick loads after a click skip the big `GraphMessage` column; the first load and the 90-second refresh (`load({ full: true })`) include it, so old queued rows still get it filled in. Buttons that start a save show a spinner (`btnLoading`, `pressedBtn`).

## Dropdowns
- `js/combo.js` (loaded last) gives every `<select>` with 5+ non-blank options a type-to-search box. The real select stays in the page (hidden, `.combo-native`) and holds the value; picking sets it and fires `input` + `change`, so all reading/saving code is unchanged. Code that sets a select's value directly must fire `change` so the box shows it.
- Dropdowns of people, facilities and corporates are A to Z (`byName`, `az`, `sortedPeople`, `peopleOpts`). The saved `settings.people` order is never changed.

## Rep rule (partial, Oct 2026)
- A corporate's rule can fill only some positions. `setRule` saves it: blank = picked per facility (`g.ruleIndiv` lists those), clinical can be "Same as intake rep" (`g.clinSame`). `applyRule` fills only a facility's empty positions; it never overwrites. `ruleNeeds(f)` = what a facility still needs (intake rep always; the rule's blanks until the Chicago handoff email). The "Pick the reps" task lists only facilities with needs and closes itself when none are left.
- Corporates saved before this have no `ruleIndiv` and behave exactly as before. Saving the corporate page only rewrites the rule when a rule box changed, so other edits never convert an old rule.
- Corporate page "Apply to open facilities": tick which of intake / clinical / account manager / transition lead / areas of care to overwrite on every open facility; the rest stay as each facility has them. Ticking a position that's blank in the rule is blocked.

## Completion
A facility is never marked complete while its FastCare task is open (since Oct 15 2026). Facilities already complete stay as they are.

## Brightree report → portal setup → schedule (Oct 19 2026)
- Done together when possible: the schedule is based on the report's last delivery dates, and they change if Chicago ships again (overlapping billing). Order stays BT → portal setup → schedule (schedule still waits for portal setup).
- Finishing BRIGHTREE or PORTAL_SETUP opens `nextDrawer` (`ui.next`, `nextStep(f, from)`): "Recommended: do the … now" + a button straight to the next task, or what it still waits on (`psWaiting`).
- SCHEDULE is "High importance" (`isHighTask`, orange `p-high`, never "At risk"), sorts first, its to-do email is High.
- `f.btAt` / `f.btBy` = when the report dates were entered or rechecked; `t.doneAt` = exact time any task was done (older ones only have `doneOn`, so `btWhen` falls back to the day). After 8 hours (`btStale`) the schedule task shows a warning with fields to recheck the dates (`btRecheck`, `updateBt`): new dates recalc and replace a hand-picked DOS (`f.dosChosen` cleared); old values kept in `f.btHistory`. Report dates can't be cleared, and can't change after the handoff email.

## Transition lead notes and editing facility details (Oct 19 2026)
- `f.leadNotes` (+ `leadNotesBy`, `leadNotesOn`): textarea on every tracker row (saves on change/blur; `poll` skips while it's focused), on the facility page, and on any task assigned to the facility's transition lead (`noteBox`). In the CSV.
- Facility page "Edit details" (`editDetails`, `editFacilityCheck`, `editFacility` in engine.js) edits everything entered: names, address, corporate, the 4 reps, wound rep, regional, GDD answer/warehouse, Brightree dates, reason. Contacts edit separately (`saveContacts`: a changed contact goes back to "not in portal" → "Contacts into portal" task). Tracker "Edit details" opens it expanded (`ui.editOpen`).
- Nothing that was entered can be cleared (wrong from the start → put the task back in the queue). Dropdowns always include the current person (`withCur`).
- Side effects: transition lead change → E20 to the new lead (amTask tasks follow); intake rep or state change after the handoff email → E13 to the lead to send a correction; GDD change → E11 FYI (and GDD_PORTAL closed if no longer GDD). FastCare only asks for the corporate/address while still missing (`fcNeed`).
- "Update the portal" (`PORTAL_UPDATE`, repeatable): `trackPortal` (end of `run()`) keeps `f.portalSnap` of what was typed into the portal at setup (`portalVals`: account manager, clinical, intake, price table, Main Vendor, both ship points, coverage per area, corporate, address). Snapshot is taken silently the first time (so existing facilities get no task); later differences from anywhere (facility page, corporate page, tracker bulk, Settings ship points) go on 1 open task for the lead; a change undone comes off. Portal setup put back in the queue drops the snapshot and closes the open update task. The GDD task answering after setup updates the snapshot itself (GDD_PORTAL covers it).

## Names, greeting, week push, EMR check (Oct 19 2026, afternoon)
- `f.name` = the Chicago (Gentell) name from the request; `f.portalName` = our Brightree/portal name from "Add to Brightree". `facName` (portal name once there is one) is the name everywhere: task titles, emails, screens. `chiName(f)` / `chiTag(f)` show the Chicago name in small letters wherever they differ (tracker, task lines and drawers, facility page, analytics, internal emails' footer). FastCare and the Brightree report task show the Chicago name to search with. The Chicago handoff email subject is `bothNames(f)` "Portal / Chicago- Transfer from GNS Chicago to Lakewood". Inbox matching accepts either name, and the Chicago name without its "(IN)" (`facNames`).
- Handoff greeting `chiGreet(f)`: Settings `chicagoGreetingNoEnt` ("Brittany") when enteral is Don't Supply, else `chicagoGreeting`. Also on the E15 nudge and the Chicago follow-up task.
- Handoff sent before FastCare (no wound rep / regional): sets `f.e1NoWound`; once FastCare is done they get E27 "In-service needed" on its own (`sendInservice`, `f.inserviceMail`). Facilities handed off before this have no flag and get nothing new.
- `calcDates`: the ordering date is at least 7 calendar days from today (first orders start processing a week before). `rec.weekPush` / `rec.pushedWeek`; the date editor shows "Pushed out a week" with a box; unticking sets `f.noPush` (rush) and the dates go back to the original calculation. Recalculates daily like the rest until the handoff email.
- Portal setup has an EMR access check (`emrReady`): required when access is ready (`f.emrChecked`); not ready → `f.emrCheckDue`, and an `EMR_CHECK` task for the lead once it is. The Shani note moved from portal notes to the schedule task's calendar pop-up note (with "Chicago transition").

## Cache
`index.html` loads the css/js with `?v=N`. Bump N on every push that changes css or js, or people keep the old version for up to 10 minutes.

## Testing before every push
Open `index.html?demo` (demo mode, nothing saved) and walk through the change. Automated tests live outside this repo; at minimum run `node --check` on every js file and click through a full transition in demo mode.

## Writing for Raizy
Short, direct, no filler. Quote UI labels exactly. Edge cases matter to her.
