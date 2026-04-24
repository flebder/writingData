export type WritingSession = {
  id: string;
  start: string; // UTC ISO
  end: string; // UTC ISO
  dateKey: string; // canonical YYYY-MM-DD from sheet data
};

export type DayBucket = {
  date: string; // canonical YYYY-MM-DD from sheet data
  minutes: number;
  sessions: WritingSession[];
  sessionSegments: Array<{ session: WritingSession; countedMinutes: number; note: string }>;
};

export const SHEET_ID = "10vokY2B5p69eY_9CieUCzgfFY6NjJfKzAv36bAqj9Qg";
export const WRITING_TZ = "America/Los_Angeles";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();

export const FALLBACK_SESSIONS: WritingSession[] = [
  { id: "fallback-1", start: "2026-04-01T16:00:00.000Z", end: "2026-04-01T16:45:00.000Z", dateKey: "2026-04-01" },
  { id: "fallback-2", start: "2026-04-03T03:30:00.000Z", end: "2026-04-03T04:20:00.000Z", dateKey: "2026-04-03" },
  { id: "fallback-3", start: "2026-04-04T06:30:00.000Z", end: "2026-04-04T07:05:00.000Z", dateKey: "2026-04-04" }
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseSheetDateTimeParts(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const cleaned = value.replace(/^"|"$/g, "").trim();
  if (!cleaned) return null;

  const gviz = cleaned.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (gviz) {
    const [, y, m, d, h, min, s] = gviz;
    return { year: Number(y), month: Number(m) + 1, day: Number(d), hour: Number(h), minute: Number(min), second: Number(s) };
  }

  const monthName = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s*(?:at\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (monthName) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIdx = monthNames.indexOf(monthName[1].slice(0, 3).toLowerCase());
    if (monthIdx < 0) return null;
    let hour = Number(monthName[4]);
    const ap = monthName[7]?.toUpperCase();
    if (ap === "PM" && hour < 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
    return {
      year: Number(monthName[3]),
      month: monthIdx + 1,
      day: Number(monthName[2]),
      hour,
      minute: Number(monthName[5]),
      second: Number(monthName[6] || "0")
    };
  }

  const us = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,|\s)+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    let hour = Number(us[4]);
    const ap = us[7]?.toUpperCase();
    if (ap === "PM" && hour < 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
    return { year, month, day, hour, minute: Number(us[5]), second: Number(us[6] || "0") };
  }

  return null;
}

export function parseSheetDateTime(value: string): { date: Date; ymd: string } | null {
  const parts = parseSheetDateTimeParts(value);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  return { date, ymd: toYmd(parts.year, parts.month, parts.day) };
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

function findCanonicalDateColumn(headers: string[], startIdx: number): number {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const explicitDateIdx = normalized.findIndex((h) => h === "date" || h.includes("sessiondate") || h.includes("entrydate"));
  if (explicitDateIdx >= 0) return explicitDateIdx;
  const timestampIdx = normalized.findIndex((h) => h.includes("timestamp"));
  if (timestampIdx >= 0) return timestampIdx;
  return startIdx >= 0 ? startIdx : 0;
}

export function parseCsvSessions(csv: string): WritingSession[] {
  const rows = parseCsvRows(csv);
  if (!rows.length) return [];

  const { startIdx, endIdx } = findClockColumns(rows[0].raw);
  const fallbackStartIdx = startIdx >= 0 ? startIdx : 1;
  const fallbackEndIdx = endIdx >= 0 ? endIdx : 2;
  const canonicalDateIdx = findCanonicalDateColumn(rows[0].raw, fallbackStartIdx);

  const sessions: WritingSession[] = [];
  const dedupe = new Set<string>();
  const debug = process.env.DEBUG_SHEET_PARSE === "1";

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const startRaw = row.raw[fallbackStartIdx] || "";
    const endRaw = row.raw[fallbackEndIdx] || "";
    const canonicalRaw = row.raw[canonicalDateIdx] || startRaw;

    if (!startRaw && !endRaw) continue;

    const startParsed = parseSheetDateTime(startRaw);
    const endParsed = parseSheetDateTime(endRaw);
    const canonicalParsed = parseSheetDateTime(canonicalRaw) || startParsed;

    if (!startParsed || !endParsed || !canonicalParsed) {
      if (debug) console.log("[sheet-parse] excluded invalid row", { rowNum: row.rowNum, startRaw, endRaw, canonicalRaw });
      console.warn(`Skipping row ${row.rowNum}: invalid start/end`, { startRaw, endRaw });
      continue;
    }
    const start = startParsed.date;
    const end = endParsed.date;
    const canonicalDate = canonicalParsed.ymd;

    if (end <= start) {
      if (debug) console.log("[sheet-parse] excluded non-positive duration row", { rowNum: row.rowNum, start: start.toISOString(), end: end.toISOString() });
      console.warn(`Skipping row ${row.rowNum}: end must be after start`, { start: start.toISOString(), end: end.toISOString() });
      continue;
    }

    const key = `${start.toISOString()}__${end.toISOString()}`;
    if (dedupe.has(key)) {
      if (debug) console.log("[sheet-parse] excluded duplicate row", { rowNum: row.rowNum, key });
      console.warn(`Skipping row ${row.rowNum}: duplicate session`, key);
      continue;
    }
    dedupe.add(key);

    sessions.push({
      id: `${start.getTime()}-${end.getTime()}-${row.rowNum}`,
      start: start.toISOString(),
      end: end.toISOString(),
      dateKey: canonicalDate
    });
    if (debug && sessions.length <= 10) console.log("[sheet-parse] included row", { rowNum: row.rowNum, canonicalDate, start: start.toISOString(), end: end.toISOString() });
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

export function aggregateDays(sessions: WritingSession[], timeZone = WRITING_TZ): Record<string, DayBucket> {
  const byDay: Record<string, DayBucket> = {};
  for (const session of sessions) {
    const startMs = new Date(session.start).getTime();
    const endMs = new Date(session.end).getTime();
    if (!(endMs > startMs)) continue;

    const segments: Array<{ date: string; minutes: number }> = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const dt = new Date(cursor);
      const nextMidnightMs = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 1, 0, 0, 0);
      const chunkEnd = Math.min(endMs, nextMidnightMs);
      const minutes = Math.max(1, Math.round((chunkEnd - cursor) / MINUTE_MS));
      segments.push({ date: ymdFromUtcParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), minutes });
      cursor = chunkEnd;
    }

    segments.forEach((segment, idx) => {
      if (!byDay[segment.date]) byDay[segment.date] = { date: segment.date, minutes: 0, sessions: [], sessionSegments: [] };
      byDay[segment.date].minutes += segment.minutes;
      byDay[segment.date].sessions.push(session);

      const note =
        segments.length === 1
          ? ""
          : idx === 0
            ? `(${segment.minutes}m counted before midnight)`
            : idx === segments.length - 1
              ? `(${segment.minutes}m counted after midnight)`
              : `(${segment.minutes}m counted this day)`;
      byDay[segment.date].sessionSegments.push({ session, countedMinutes: segment.minutes, note });
    });
  }
  return byDay;
}

function ymdFromUtcParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
