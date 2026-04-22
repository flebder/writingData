import { addDaysToYmd } from "@/lib/writing";

export type StreakSegment = {
  start: string;
  end: string;
  days: number;
  scoreMinutes: number;
};

export type StreakSummary = {
  current: StreakSegment | null;
  todayQualified: boolean;
  todayMinutes: number;
  longestYear: StreakSegment | null;
  bestScoreYear: StreakSegment | null;
  longestAllTime: StreakSegment | null;
  bestScoreAllTime: StreakSegment | null;
};

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

function buildSegments(byDay: Record<string, { minutes: number }>, baselineMinutes: number, filter?: (ymd: string) => boolean): StreakSegment[] {
  const qualifying = Object.keys(byDay)
    .filter((d) => byDay[d].minutes >= baselineMinutes && (!filter || filter(d)))
    .sort();
  const segments: StreakSegment[] = [];
  for (const day of qualifying) {
    const prev = segments.at(-1);
    if (!prev || daysBetween(day, prev.end) !== 1) {
      segments.push({ start: day, end: day, days: 1, scoreMinutes: byDay[day].minutes });
    } else {
      prev.end = day;
      prev.days += 1;
      prev.scoreMinutes += byDay[day].minutes;
    }
  }
  return segments;
}

function pickLongest(segments: StreakSegment[]): StreakSegment | null {
  if (!segments.length) return null;
  return [...segments].sort((a, b) => b.days - a.days || b.scoreMinutes - a.scoreMinutes || b.end.localeCompare(a.end))[0];
}

function pickBestScore(segments: StreakSegment[]): StreakSegment | null {
  if (!segments.length) return null;
  return [...segments].sort((a, b) => b.scoreMinutes - a.scoreMinutes || a.days - b.days || b.end.localeCompare(a.end))[0];
}

export function computeStreakSummary(byDay: Record<string, { minutes: number }>, todayYmd: string, baselineMinutes = 30): StreakSummary {
  const todayMinutes = byDay[todayYmd]?.minutes || 0;
  const todayQualified = todayMinutes >= baselineMinutes;

  const all = buildSegments(byDay, baselineMinutes);
  const anchor = todayQualified ? todayYmd : addDaysToYmd(todayYmd, -1);
  const current = all.find((s) => s.end === anchor) || null;

  const yearPrefix = `${todayYmd.slice(0, 4)}-`;
  const yearSegments = buildSegments(byDay, baselineMinutes, (ymd) => ymd.startsWith(yearPrefix));

  return {
    current,
    todayQualified,
    todayMinutes,
    longestYear: pickLongest(yearSegments),
    bestScoreYear: pickBestScore(yearSegments),
    longestAllTime: pickLongest(all),
    bestScoreAllTime: pickBestScore(all)
  };
}
