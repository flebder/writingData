import { NextResponse } from "next/server";
import { reduceProjectEvents, type ProjectEvent } from "@/lib/projects";

export const dynamic = "force-dynamic";

type ProjectApiBody = {
  events?: ProjectEvent[];
};

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseEventsCsv(text: string): ProjectEvent[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const index = (name: string) => headers.indexOf(name);
  const rows: ProjectEvent[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const payloadRaw = cells[index("payload")] || "{}";
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(payloadRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const event_type = cells[index("event_type")] as ProjectEvent["event_type"];
    if (!event_type) continue;
    rows.push({
      event_id: cells[index("event_id")] || `${event_type}-${rows.length}`,
      timestamp: cells[index("timestamp")] || new Date(0).toISOString(),
      event_type,
      project_id: cells[index("project_id")] || "",
      milestone_id: cells[index("milestone_id")] || undefined,
      payload
    });
  }

  return rows;
}

function normalizeEvents(value: unknown): ProjectEvent[] {
  const rawEvents = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { events?: unknown }).events) ? (value as { events: unknown[] }).events : [];
  return rawEvents
    .filter((event): event is ProjectEvent => !!event && typeof event === "object" && typeof (event as ProjectEvent).event_type === "string" && typeof (event as ProjectEvent).project_id === "string")
    .map((event) => ({
      event_id: String(event.event_id || `${event.event_type}-${event.project_id}-${event.milestone_id || "project"}`),
      timestamp: String(event.timestamp || new Date(0).toISOString()),
      event_type: event.event_type,
      project_id: event.project_id,
      milestone_id: event.milestone_id,
      payload: event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {}
    }));
}

async function fetchEvents(): Promise<{ configured: boolean; events: ProjectEvent[]; warning?: string }> {
  const readUrl = process.env.PROJECTS_EVENTS_CSV_URL || process.env.PROJECTS_EVENTS_READ_URL;
  if (!readUrl) return { configured: false, events: [], warning: "Project event sheet is not configured." };

  const response = await fetch(readUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Project event fetch failed: ${response.status}`);
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return { configured: true, events: [] };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { configured: true, events: normalizeEvents(JSON.parse(trimmed)) };
  }

  return { configured: true, events: parseEventsCsv(trimmed) };
}

export async function GET() {
  try {
    const { configured, events, warning } = await fetchEvents();
    return json({ ok: true, configured, events, state: reduceProjectEvents(events), warning });
  } catch (error) {
    return json({ ok: false, configured: true, events: [], state: reduceProjectEvents([]), warning: error instanceof Error ? error.message : "Project deadlines could not be loaded." }, { status: 200 });
  }
}

export async function POST(request: Request) {
  const writeUrl = process.env.PROJECTS_EVENTS_WEBHOOK_URL;
  if (!writeUrl) {
    return json({ ok: false, warning: "PROJECTS_EVENTS_WEBHOOK_URL is not configured, so project changes cannot be saved yet." }, { status: 501 });
  }

  const body = (await request.json()) as ProjectApiBody;
  const events = normalizeEvents(body.events || []);
  if (!events.length) return json({ ok: false, warning: "No project events were provided." }, { status: 400 });

  const response = await fetch(writeUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: process.env.PROJECTS_EVENTS_TOKEN || "", events })
  });

  if (!response.ok) return json({ ok: false, warning: `Project event write failed: ${response.status}` }, { status: 502 });
  return json({ ok: true, events });
}
