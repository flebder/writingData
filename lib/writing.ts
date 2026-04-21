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

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();

export const FALLBACK_SESSIONS: WritingSession[] = [
  { id: "fallback-1", start: "2026-04-01T16:00:00.000Z", end: "2026-04-01T16:45:00.000Z" },
  { id: "fallback-2", start: "2026-04-03T03:30:00.000Z", end: "2026-04-03T04:20:00.000Z" },
  { id: "fallback-3", start: "2026-04-04T06:30:00.000Z", end: "2026-04-04T07:05:00.000Z" }
];

const tzHourFormatters = new Map<string, Intl.DateTimeFormat>();
const tzMinuteFormatters = new Map<string, Intl.DateTimeFormat>();

function getYmdFormatter(timeZone: string) {
  const existing = ymdFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  ymdFormatters.set(timeZone, formatter);
  return formatter;
}

function getHourFormatter(timeZone: string) {
  const existing = tzHourFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false });
  tzHourFormatters.set(timeZone, formatter);
  return formatter;
}

function getMinuteFormatter(timeZone: string) {
  const existing = tzMinuteFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" });
  tzMinuteFormatters.set(timeZone, formatter);
  return formatter;
}

export function parseTzOffsetMinutes(utcMs: number, timeZone: string): number {
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

export function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0, timeZone = WRITING_TZ) {
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = baseUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = parseTzOffsetMinutes(guess, timeZone);
    guess = Date.UTC(year, month - 1, day, hour, minute, second) - offset * MINUTE_MS;
  }
  return new Date(guess);
}

export function getYmdInWritingTz(date: Date, timeZone = WRITING_TZ): string {
  return getYmdFormatter(timeZone).format(date);
}

export function getHourInWritingTz(date: Date, timeZone = WRITING_TZ): number {
  return Number(getHourFormatter(timeZone).format(date));
}

export function getMinuteInWritingTz(date: Date, timeZone = WRITING_TZ): number {
  return Number(getMinuteFormatter(timeZone).format(date));
}

export function todayYmdInWritingTz(now: Date, timeZone = WRITING_TZ): string {
  return getYmdInWritingTz(now, timeZone);
}

export function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

export function yearKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 4);
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
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

export function normalizeDate(value: string): Date | null {
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

export function splitSessionAcrossDays(start: Date, end: Date, timeZone = WRITING_TZ) {
  const chunks: Array<{ date: string; minutes: number }> = [];
  let cursor = start.getTime();
  const endTs = end.getTime();

  while (cursor < endTs) {
    const currentYmd = getYmdInWritingTz(new Date(cursor), timeZone);
    const nextYmd = addDaysToYmd(currentYmd, 1);
    const [ny, nm, nd] = nextYmd.split("-").map(Number);
    const nextMidnightUtc = zonedLocalToUtc(ny, nm, nd, 0, 0, 0, timeZone).getTime();
    const chunkEnd = Math.min(endTs, nextMidnightUtc);
    const minutes = Math.max(0, Math.floor((chunkEnd - cursor) / MINUTE_MS));
    if (minutes > 0) chunks.push({ date: currentYmd, minutes });
    cursor = chunkEnd;
  }

  return chunks;
}

type ParsedCsvRow = { raw: string[]; rowNum: number };

function parseCsvRows(csv: string): ParsedCsvRow[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => ({
      raw: line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((part) => part.trim()),
      rowNum: idx + 1
    }));
}

function findClockColumns(headers: string[]) {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const startIdx = normalized.findIndex((h) => h.includes("clockin") || h.includes("start"));
  const endIdx = normalized.findIndex((h) => h.includes("clockout") || h.includes("end"));
  return { startIdx, endIdx };
}

export function parseCsvSessions(csv: string): WritingSession[] {
  const rows = parseCsvRows(csv);
  if (!rows.length) return [];

  const { startIdx, endIdx } = findClockColumns(rows[0].raw);
  const fallbackStartIdx = startIdx >= 0 ? startIdx : 1;
  const fallbackEndIdx = endIdx >= 0 ? endIdx : 2;

  const sessions: WritingSession[] = [];
  const dedupe = new Set<string>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const startRaw = row.raw[fallbackStartIdx] || "";
    const endRaw = row.raw[fallbackEndIdx] || "";

    if (!startRaw && !endRaw) continue;

    const start = normalizeDate(startRaw);
    const end = normalizeDate(endRaw);

    if (!start || !end) {
      console.warn(`Skipping row ${row.rowNum}: invalid start/end`, { startRaw, endRaw });
      continue;
    }
    if (end <= start) {
      console.warn(`Skipping row ${row.rowNum}: end must be after start`, { start: start.toISOString(), end: end.toISOString() });
      continue;
    }

    const key = `${start.toISOString()}__${end.toISOString()}`;
    if (dedupe.has(key)) {
      console.warn(`Skipping row ${row.rowNum}: duplicate session`, key);
      continue;
    }
    dedupe.add(key);

    sessions.push({
      id: `${start.getTime()}-${end.getTime()}-${row.rowNum}`,
      start: start.toISOString(),
      end: end.toISOString()
    });
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

export function aggregateDays(sessions: WritingSession[], timeZone = WRITING_TZ): Record<string, DayBucket> {
  const byDay: Record<string, DayBucket> = {};
  for (const session of sessions) {
    for (const chunk of splitSessionAcrossDays(new Date(session.start), new Date(session.end), timeZone)) {
      if (!byDay[chunk.date]) byDay[chunk.date] = { date: chunk.date, minutes: 0, sessions: [] };
      byDay[chunk.date].minutes += chunk.minutes;
      byDay[chunk.date].sessions.push(session);
    }
  }
  return byDay;
}

export function rollingWeekMinutes(day: string, byDay: Record<string, DayBucket>) {
  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const key = addDaysToYmd(day, -i);
    total += byDay[key]?.minutes || 0;
  }
  return total;
}

export function getCalendarRange(endDay: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(addDaysToYmd(endDay, -i));
  }
  return out;
}

export function averageDurationMinutes(sessions: WritingSession[]): number {
  if (!sessions.length) return 0;
  const total = sessions.reduce((sum, s) => sum + (new Date(s.end).getTime() - new Date(s.start).getTime()) / MINUTE_MS, 0);
  return Math.round(total / sessions.length);
}

export { DAY_MS };
