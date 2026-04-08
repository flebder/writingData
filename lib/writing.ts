export type WritingSession = {
  id: string;
  start: string;
  end: string;
};

export type DayBucket = {
  date: string;
  minutes: number;
  sessions: WritingSession[];
};

export const SHEET_ID = "10vokY2B5p69eY_9CieUCzgfFY6NjJfKzAv36bAqj9Qg";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const FALLBACK_SESSIONS: WritingSession[] = [
  { id: "fallback-1", start: "2026-04-01T09:00:00.000Z", end: "2026-04-01T09:45:00.000Z" },
  { id: "fallback-2", start: "2026-04-02T20:30:00.000Z", end: "2026-04-02T21:20:00.000Z" },
  { id: "fallback-3", start: "2026-04-03T23:30:00.000Z", end: "2026-04-04T00:05:00.000Z" }
];

function parseUsDateLike(value: string): Date | null {
  // Supports: 4/6/26, 9:24 | 1/23/26, 11:54 PM | 4/6/2026 9:24
  const m = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,|\s)+(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)(?:\s*(AM|PM))?$/i
  );
  if (!m) return null;

  let [, mm, dd, yyyy, hh, min, sec, ampm] = m;
  const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
  let hour = Number(hh);
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === "PM" && hour < 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  }
  return new Date(year, Number(mm) - 1, Number(dd), hour, Number(min), Number(sec || 0));
}

function normalizeDate(value: string): Date | null {
  const cleaned = value.replace(/^"|"$/g, "").trim();
  if (!cleaned) return null;

  // gviz style: Date(2026,3,8,20,30,0)
  const gviz = cleaned.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (gviz) {
    const [, y, m, d, h, min, s] = gviz;
    return new Date(Number(y), Number(m), Number(d), Number(h), Number(min), Number(s));
  }

  const commonTransforms = [
    cleaned,
    cleaned.replace(" at ", " "),
    cleaned.replace(/,\s*/g, " ")
  ];

  for (const candidate of commonTransforms) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const us = parseUsDateLike(candidate);
    if (us && !Number.isNaN(us.getTime())) return us;
  }

  return null;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function splitSessionAcrossDays(start: Date, end: Date) {
  const chunks: Array<{ date: string; minutes: number }> = [];
  let cursor = start.getTime();
  const endTs = end.getTime();

  while (cursor < endTs) {
    const current = new Date(cursor);
    const nextMidnight = new Date(current);
    nextMidnight.setHours(24, 0, 0, 0);
    const chunkEnd = Math.min(endTs, nextMidnight.getTime());
    const minutes = Math.max(0, Math.round((chunkEnd - cursor) / MINUTE_MS));
    chunks.push({ date: toYmd(current), minutes });
    cursor = chunkEnd;
  }

  return chunks;
}

export function parseCsvSessions(csv: string): WritingSession[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sessions: WritingSession[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const cols = lines[i]
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((part) => part.trim());

    // Column B = index 1, Column C = index 2
    const start = normalizeDate(cols[1] || "");
    const end = normalizeDate(cols[2] || "");

    if (!start || !end || end <= start) {
      continue;
    }

    sessions.push({
      id: `${start.getTime()}-${end.getTime()}-${i}`,
      start: start.toISOString(),
      end: end.toISOString()
    });
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

export function aggregateDays(sessions: WritingSession[]): Record<string, DayBucket> {
  const byDay: Record<string, DayBucket> = {};

  for (const session of sessions) {
    const start = new Date(session.start);
    const end = new Date(session.end);

    for (const chunk of splitSessionAcrossDays(start, end)) {
      if (!byDay[chunk.date]) {
        byDay[chunk.date] = { date: chunk.date, minutes: 0, sessions: [] };
      }
      byDay[chunk.date].minutes += chunk.minutes;
      byDay[chunk.date].sessions.push(session);
    }
  }

  return byDay;
}

export function rollingWeekMinutes(day: string, byDay: Record<string, DayBucket>) {
  const end = new Date(`${day}T00:00:00`);
  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(end.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    total += byDay[d]?.minutes || 0;
  }
  return total;
}
