# Projects / Deadlines Google Sheets setup

The Projects feature uses an append-only event log so deadline changes are auditable and old rows are never rewritten.

## Sheet tab

Create a Google Sheet tab named `ProjectEvents` with this header row:

```csv
event_id,timestamp,event_type,project_id,milestone_id,payload
```

Each row represents one event. The `payload` cell contains JSON for the event details.

Supported `event_type` values:

- `create_project`
- `update_project`
- `archive_project`
- `add_milestone`
- `update_milestone`
- `complete_milestone`
- `change_deadline`

## Environment variables

Configure these variables in Vercel or your local `.env.local`:

- `PROJECTS_EVENTS_CSV_URL`: a published CSV/export URL for the `ProjectEvents` tab, or an Apps Script read endpoint that returns the rows.
- `PROJECTS_EVENTS_WEBHOOK_URL`: an Apps Script web app URL that accepts server-side `POST` requests and appends project events to the sheet.
- `PROJECTS_EVENTS_TOKEN` (optional): a shared secret sent only from the Next.js API route to Apps Script.

The browser never receives the token or Apps Script write URL. It only calls `/api/projects`.

## Apps Script write endpoint shape

The Next.js API route posts JSON like this to `PROJECTS_EVENTS_WEBHOOK_URL`:

```json
{
  "token": "optional shared secret",
  "events": [
    {
      "event_id": "milestone_...",
      "timestamp": "2026-05-29T12:00:00.000Z",
      "event_type": "change_deadline",
      "project_id": "project_...",
      "milestone_id": "milestone_...",
      "payload": {
        "previous_deadline_date": "2026-06-01",
        "deadline_date": "2026-06-03"
      }
    }
  ]
}
```

Your Apps Script should validate the optional token, then append one row per event using the six columns above. Store `payload` with `JSON.stringify(event.payload)`.

If the project environment variables are missing or the project sheet cannot be loaded, the writing dashboard still works and the project strip falls back gracefully.
