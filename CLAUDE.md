# Chicago Transitions app: notes for Claude

Raizy Kreiser (PM, Gentell Nutritional Services) owns this. She isn't a developer: she asks for changes in plain words, you make them, test them, and push to `main`. GitHub Pages publishes `main` within about a minute. Keep answers to her short and non-technical.

## What it is
A task app that runs the Chicago → Lakewood facility transition process from the Quick Guide / Reference Guide. Plain HTML + JavaScript, no build step, hosted on GitHub Pages. Data lives in SharePoint lists on the site in `config.js`. People sign in with Microsoft (MSAL, app registration in Gentell's Entra tenant). Two Power Automate flows (run by Raizy) send email and read the shared mailbox.

## Files
- `config.js`: tenant, app (client) ID, SharePoint site, shared mailbox, app URL. Empty clientId = demo mode.
- `js/engine.js`: the rules. `run()` creates every task and email that's due. Dates, email wording (Chicago handoff email / in-service & contacts request templates), reminders, inbox matching.
- `js/tasks.js`: the task types (`TT`): title, form, validate, done, opens (waiting tasks), quick (email-button answers).
- `js/store.js`: loading and saving. `SPStore` (Microsoft Graph) and `DemoStore` (in memory).
- `js/ui.js`: screens and clicks. Every change goes through `act()`: reload → change → `run()` → save → reload.
- `index.html`, `style.css`, `vendor/msal-browser.min.js` (MSAL 4.30.0, UMD).

## Data (SharePoint lists, created by the app's first-run setup)
- **CT Data**: 1 row per record. Columns `Key` (unique), `Kind` (settings/grp/fac/task/req), `Data` (JSON), `Ct` (CT-0001, facilities only), `Am` (AM email, facilities only, used by the mailbox flow), `Archived` (Yes/No).
- **CT Outbox**: 1 row per email. `Key` (unique), `Code`, `ToList`, `CcList` (semicolon-separated), `Subject`, `HtmlBody`, `SendOn` (UTC), `SendStatus` (Queued/Sent/Failed/Cancelled), `Facility`, `TaskKey`, `Cond` (JSON: when to cancel), `ErrorText`, `Importance` (Normal/High; the send flow uses it. Added on sign-in to lists made before it existed).
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
Never say "Email 1/2/3" in the UI or emails. Internally (code, `email1`/`email2`/`email3` fields, E14/E16 codes) they still are. Email 1 = "Chicago handoff email" (us → GNS Chicago). Email 2 = "Transfer notice to facility" (GNS Chicago → facility). Email 3 = "In-service & contacts request" (us → wound rep + regional).

## People on a facility
`am` in the data (`f.am`, `g.am`, `p.am`, `amOf`, the `Am` column) is the **transition lead**: runs the transition, gets the tasks and emails. Never rename it (the mailbox flow reads `Am`). The **account manager** is `acct` (`f.acct`, `g.acct`, `acctOf`): picked from the "Rep / account manager" list and CC'd only where the intake rep gets email (Chicago handoff, in-service & contacts request). It also fills the portal's "Account Manager" field.

## Email 3 replies
Email 3 goes to the wound rep + regional. `processInbox` treats any email to the mailbox (in To) with the facility name + "transfer from gns chicago" in the subject, received on/after Email 3, as a reply, unless it's from the mailbox, GNS Chicago (Email 1 To/CC) or someone on the team who isn't the wound rep/regional. A reply sets `f.e3Reply` and makes an `E3_REPLY` task for the transition lead (put their info in; or "keep following up", which starts a new follow-up round `f.e3Round`). No reply: `chaseEmail3` queues 1 step at a time (+3 business days, +3, then an alert to the transition lead). Manual: "In-service & contacts: taken care of" on the facility page. Completion waits on `e3Done`. Follow-ups (E15, E16F, E16A, E17) go out as High importance.

## Request form
Corporate is per line (no dropdown). "Already done" (`PRE_ITEMS` in engine.js, `applyPre`) sets what the skipped steps would have set and the engine skips their tasks; `g.existing` = corporate already in the portal (no price table / EMR access tasks). Info-only emails (`FYI_CODES`) get a "no action needed" line. To-do emails for tasks with steps use `todo()`: one line, details live in the task.

## Cache
`index.html` loads the css/js with `?v=N`. Bump N on every push that changes css or js, or people keep the old version for up to 10 minutes.

## Testing before every push
Open `index.html?demo` (demo mode, nothing saved) and walk through the change. Automated tests live outside this repo; at minimum run `node --check` on every js file and click through a full transition in demo mode.

## Writing for Raizy
Short, direct, no filler. Quote UI labels exactly. Edge cases matter to her.
