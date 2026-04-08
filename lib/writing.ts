export type WritingSession = {
  id: string;
  start: string; // UTC ISO
  end: string; // UTC ISO
};

export type DayBucket = {
  date: string; // YYYY-MM-DD in America/Los_Angeles
  minutes: number;
  sessions: WritingSession[];
};

export const SHEET_ID = "10vokY2B5p69eY_9CieUCzgfFY6NjJfKzAv36bAqj9Qg";
export const WRITING_TZ = "America/Los_Angeles";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: WRITING_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export const FALLBACK_SESSIONS: WritingSession[] = [
  { id: "fallback-1", start: "2026-04-01T16:00:00.000Z", end: "2026-04-01T16:45:00.000Z" },
  { id: "fallback-2", start: "2026-04-03T03:30:00.000Z", end: "2026-04-03T04:20:00.000Z" },
  { id: "fallback-3", start: "2026-04-04T06:30:00.000Z", end: "2026-04-04T07:05:00.000Z" }
];

function parseTzOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(new Date(utcMs));
  const zone = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+0";
  const m = zone.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/) || zone.match(/UTC([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || "0"));
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = baseUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = parseTzOffsetMinutes(guess, WRITING_TZ);
    guess = Date.UTC(year, month - 1, day, hour, minute, second) - offset * MINUTE_MS;
  }
  return new Date(guess);
}

function getYmdInWritingTz(date: Date): string {
  return ymdFormatter.format(date);
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function parseUsDateLike(value: string): Date | null {
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
  return zonedLocalToUtc(year, Number(mm), Number(dd), hour, Number(min), Number(sec || 0));
}

function parseMonthNameDate(value: string): Date | null {
  const m = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s*(?:at\s*)?(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!m) return null;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIdx = monthNames.indexOf(m[1].slice(0, 3).toLowerCase());
  if (monthIdx < 0) return null;
  let hour = Number(m[4]);
  const ap = m[6]?.toUpperCase();
  if (ap) {
    if (ap === "PM" && hour < 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
  }
  return zonedLocalToUtc(Number(m[3]), monthIdx + 1, Number(m[2]), hour, Number(m[5]));
}

function normalizeDate(value: string): Date | null {
  const cleaned = value.replace(/^"|"$/g, "").trim();
  if (!cleaned) return null;

  const gviz = cleaned.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (gviz) {
    const [, y, m, d, h, min, s] = gviz;
    return zonedLocalToUtc(Number(y), Number(m) + 1, Number(d), Number(h), Number(min), Number(s));
  }

  const parsers = [cleaned, cleaned.replace(" at ", " ")];
  for (const candidate of parsers) {
    const monthName = parseMonthNameDate(candidate);
    if (monthName) return monthName;

    const us = parseUsDateLike(candidate);
    if (us) return us;
  }

  return null;
}

export function splitSessionAcrossDays(start: Date, end: Date) {
  const chunks: Array<{ date: string; minutes: number }> = [];
  let cursor = start.getTime();
  const endTs = end.getTime();

  while (cursor < endTs) {
    const current = new Date(cursor);
    const currentYmd = getYmdInWritingTz(current);
    const nextYmd = addOneDay(currentYmd);
    const [ny, nm, nd] = nextYmd.split("-").map(Number);
    const nextMidnightUtc = zonedLocalToUtc(ny, nm, nd, 0, 0, 0).getTime();
    const chunkEnd = Math.min(endTs, nextMidnightUtc);
    const minutes = Math.max(0, Math.round((chunkEnd - cursor) / MINUTE_MS));
    chunks.push({ date: currentYmd, minutes });
    cursor = chunkEnd;
  }

  return chunks;
}

export function parseCsvSessions(csv: string): WritingSession[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sessions: WritingSession[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const cols = lines[i]
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((part) => part.trim());

    const start = normalizeDate(cols[1] || "");
    const end = normalizeDate(cols[2] || "");
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
    for (const chunk of splitSessionAcrossDays(new Date(session.start), new Date(session.end))) {
      if (!byDay[chunk.date]) byDay[chunk.date] = { date: chunk.date, minutes: 0, sessions: [] };
      byDay[chunk.date].minutes += chunk.minutes;
      byDay[chunk.date].sessions.push(session);
    }
  }
  return byDay;
}

export function rollingWeekMinutes(day: string, byDay: Record<string, DayBucket>) {
  const [y, m, d] = day.split("-").map(Number);
  const end = Date.UTC(y, m - 1, d);
  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(end - i * DAY_MS);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    total += byDay[key]?.minutes || 0;
  }
  return total;
}
