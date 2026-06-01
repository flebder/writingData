# Writing Journal privacy and private Google Sheets setup

## Current privacy audit

### Browser/client exposure

The browser only calls same-origin API routes:

- `/api/sessions` for writing sessions.
- `/api/projects` for project/deadline events and writes.

No `NEXT_PUBLIC_` environment variables are used for Sheet URLs, Apps Script URLs, or tokens. The browser bundle should not receive Google Sheet URLs, Apps Script webhook URLs, or shared tokens.

### Server-side data access

- Writing sessions are read by `app/api/sessions/route.ts` on the server.
- Project events are read and written by `app/api/projects/route.ts` on the server.
- Project writes post to `PROJECTS_EVENTS_WEBHOOK_URL` with `PROJECTS_EVENTS_TOKEN` in the server-side JSON body.
- Project reads can use either `PROJECTS_EVENTS_READ_URL` / `PROJECTS_EVENTS_CSV_URL`; if the URL is an Apps Script endpoint, the server appends `PROJECTS_EVENTS_TOKEN` as a query parameter.

### Public Sheet risk

If `WRITING_SESSIONS_CSV_URL` or `PROJECTS_EVENTS_CSV_URL` is a Google Sheets published/export CSV URL, that tab must be published or link-accessible enough for Vercel's server to fetch it. That means anyone who obtains the URL may be able to read the sheet/tab.

For private Sheets, use the Apps Script endpoint below and point Vercel to the Apps Script URL instead of a public Google CSV export URL.

## Recommended private architecture

1. Browser loads the Writing Journal site.
2. Browser calls only same-origin Next.js API routes (`/api/sessions`, `/api/projects`).
3. Next.js API routes call the same Google Apps Script web app with a shared token.
4. Apps Script runs as you and reads/writes the private Google Sheet.
5. The same spreadsheet contains the writing-session tab (`data entry`) and project-event tab (`ProjectEvents`).
6. The Google Sheet can remain private; do not publish it to the web.

## Required Vercel environment variables

All of these are server-only. Do **not** prefix them with `NEXT_PUBLIC_`.

### Writing sessions

- `WRITING_SESSIONS_READ_URL`: Apps Script web app URL for reading writing sessions. Use the same `/exec` URL from the existing project/deadline Apps Script deployment.
- `WRITING_SESSIONS_TOKEN`: shared secret token expected by Apps Script for session reads.

Optional legacy fallback:

- `WRITING_SESSIONS_CSV_URL`: server-side CSV URL. Only use this if you intentionally keep a sheet/tab published or link-readable. Prefer `WRITING_SESSIONS_READ_URL` for private sheets.

### Project events

- `PROJECTS_EVENTS_READ_URL`: Apps Script web app URL for reading project events. Use the same `/exec` URL.
- `PROJECTS_EVENTS_WEBHOOK_URL`: Apps Script web app URL for writing project events. Use the same `/exec` URL.
- `PROJECTS_EVENTS_TOKEN`: shared secret token expected by Apps Script for project reads/writes.

Compatibility:

- `PROJECTS_EVENTS_CSV_URL` is still supported. For private Sheets, leave it unset and use `PROJECTS_EVENTS_READ_URL`, or set it to the same Apps Script `/exec` URL for compatibility.

## Apps Script `Code.gs`

Set Script Properties in Apps Script:

- `SPREADSHEET_ID`: `10vokY2B5p69eY_9CieUCzgfFY6NjJfKzAv36bAqj9Qg`
- `TOKEN`: a long random shared secret. Use the same value in Vercel as `WRITING_SESSIONS_TOKEN` and `PROJECTS_EVENTS_TOKEN`, or adapt the code for separate tokens.
- `WRITING_SHEET_NAME`: `data entry`
- `PROJECT_EVENTS_SHEET_NAME`: `ProjectEvents`.

The `ProjectEvents` tab header should be:

```csv
event_id,timestamp,event_type,project_id,milestone_id,payload
```

Paste this as `Code.gs`:

```js
const REQUIRED_PROJECT_HEADERS = ["event_id", "timestamp", "event_type", "project_id", "milestone_id", "payload"];

function props_() {
  return PropertiesService.getScriptProperties();
}

function json_(value, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ statusCode: statusCode || 200 }, value)))
    .setMimeType(ContentService.MimeType.JSON);
}

function csv_(value) {
  return ContentService
    .createTextOutput(value)
    .setMimeType(ContentService.MimeType.CSV);
}

function validateToken_(token) {
  const expected = props_().getProperty("TOKEN") || "";
  return expected && token && String(token) === expected;
}

function sheet_(name) {
  const spreadsheetId = props_().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID script property");
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet tab: " + name);
  return sheet;
}

function csvEscape_(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function sheetToCsv_(sheetName) {
  const values = sheet_(sheetName).getDataRange().getDisplayValues();
  return values.map(row => row.map(csvEscape_).join(",")).join("\n");
}

function ensureProjectHeader_() {
  const sheetName = props_().getProperty("PROJECT_EVENTS_SHEET_NAME") || "ProjectEvents";
  const sheet = sheet_(sheetName);
  const firstRow = sheet.getRange(1, 1, 1, REQUIRED_PROJECT_HEADERS.length).getValues()[0];
  const hasHeader = REQUIRED_PROJECT_HEADERS.every((header, index) => String(firstRow[index] || "") === header);
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, REQUIRED_PROJECT_HEADERS.length).setValues([REQUIRED_PROJECT_HEADERS]);
  }
  return sheet;
}

function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : "";
  if (!validateToken_(token)) return json_({ ok: false, error: "Unauthorized" }, 401);

  const action = (e.parameter.action || e.parameter.type || "sessions").toLowerCase();
  if (action === "projects" || action === "project-events") {
    const projectSheet = props_().getProperty("PROJECT_EVENTS_SHEET_NAME") || "ProjectEvents";
    return csv_(sheetToCsv_(projectSheet));
  }

  const writingSheet = props_().getProperty("WRITING_SHEET_NAME") || "data entry";
  return csv_(sheetToCsv_(writingSheet));
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (error) {
    return json_({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!validateToken_(body.token)) return json_({ ok: false, error: "Unauthorized" }, 401);

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return json_({ ok: false, error: "No events" }, 400);

  const sheet = ensureProjectHeader_();
  const rows = events.map(event => [
    event.event_id || Utilities.getUuid(),
    event.timestamp || new Date().toISOString(),
    event.event_type || "",
    event.project_id || "",
    event.milestone_id || "",
    JSON.stringify(event.payload || {})
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, REQUIRED_PROJECT_HEADERS.length).setValues(rows);
  return json_({ ok: true, appended: rows.length }, 200);
}
```

## Deploy Apps Script

Use the same Apps Script web app for writing-session reads, project-event reads, and project-event writes. You do not need a separate deployment for writing sessions.

1. Open the private Google Sheet.
2. Go to **Extensions → Apps Script**.
3. Paste the `Code.gs` above.
4. Add Script Properties listed above.
5. Deploy with **Deploy → New deployment → Web app**.
6. Choose:
   - **Execute as:** Me
   - **Who has access:** Anyone / Anyone with the link
7. Copy the same `/exec` Web app URL into `WRITING_SESSIONS_READ_URL`, `PROJECTS_EVENTS_READ_URL`, and `PROJECTS_EVENTS_WEBHOOK_URL` in Vercel.

Even though the web app is reachable by link, it only returns data when the token matches. The Sheet itself can remain private because the script executes as you.

## Vercel Deployment Protection / Vercel Authentication

Use Vercel's built-in Deployment Protection rather than adding custom auth code. Vercel documentation: https://vercel.com/docs/security/deployment-protection

Recommended setup:

1. Open the Vercel project dashboard.
2. Go to **Settings → Deployment Protection**.
3. Enable protection for Production and Preview deployments.
4. Choose **Vercel Authentication** if you want only Vercel users with suitable access to view it.
5. If you are on a plan/add-on that supports Password Protection and prefer a password, choose Password Protection instead.
6. Avoid Deployment Protection Exceptions unless you intentionally need a public path. See methods and exceptions: https://vercel.com/docs/deployment-protection/methods-to-protect-deployments

Vercel Authentication protects requests to the site before the app runs, including API routes, so casual visitors should not be able to view the dashboard or call `/api/sessions` / `/api/projects` without passing Vercel protection.

## Can the Sheet be private?

Yes. Once `WRITING_SESSIONS_READ_URL`, `PROJECTS_EVENTS_READ_URL`, and `PROJECTS_EVENTS_WEBHOOK_URL` point to the same Apps Script web app and the tokens are set in Vercel, the Google Sheet no longer needs to be published to the web.

You can then remove public publishing/link sharing from the Google Sheet and rely on Apps Script running as you.
