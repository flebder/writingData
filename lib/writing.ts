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

function normalizeDate(value: string): Date | null {
  const cleaned = value.trim();
  if (!cleaned) return null;

  // Handles gviz style: Date(2026,3,8,20,30,0)
  const gviz = cleaned.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (gviz) {
    const [, y, m, d, h, min, s] = gviz;
    return new Date(Number(y), Number(m), Number(d), Number(h), Number(min), Number(s));
  }

  const native = new Date(cleaned);
  if (!Number.isNaN(native.getTime())) return native;

  // Fallback for common sheets format mm/dd/yyyy hh:mm:ss
  const us = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!us) return null;
  let [, mm, dd, yyyy, hh, mins, secs, ap] = us;
  let hour = Number(hh);
  if (ap) {
    const upper = ap.toUpperCase();
    if (upper === "PM" && hour < 12) hour += 12;
    if (upper === "AM" && hour === 12) hour = 0;
  }
  const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
  return new Date(year, Number(mm) - 1, Number(dd), hour, Number(mins), Number(secs || 0));
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
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sessions: WritingSession[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const cols = line
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((part) => part.replace(/^"|"$/g, "").trim());

    if (cols.length < 3) continue;
    if (i === 0 && /start/i.test(cols[1]) && /end/i.test(cols[2])) continue;

    const start = normalizeDate(cols[1]);
    const end = normalizeDate(cols[2]);
    if (!start || !end || end <= start) continue;

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
