import {
  addDaysToYmd,
  aggregateDays,
  averageDurationMinutes,
  getCalendarRange,
  getHourInWritingTz,
  getMinuteInWritingTz,
  monthKeyFromYmd,
  todayYmdInWritingTz,
  type WritingSession,
  yearKeyFromYmd
} from "@/lib/writing";

export type DashboardStats = {
  dailyAverage: number;
  monthlyTotal: number;
  yearlyTotal: number;
  bestDayThisMonth: { date: string; minutes: number };
  bestDayThisYear: { date: string; minutes: number };
  trend: {
    dailyNow: number;
    dailyPrev: number;
    diff: number;
    pct: number;
    currentPeriod: string[];
    previousPeriod: string[];
  };
  motivation: {
    weekday: string;
    dataPoints: number;
    medianStart: number;
    avgDuration: number;
    startExamples: string[];
    durations: number[];
  };
};

const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });

export function calculateDashboardStats(sessions: WritingSession[], now = new Date()): DashboardStats {
  const byDay = aggregateDays(sessions);
  const dayKeys = Object.keys(byDay).sort();
  const todayKey = todayYmdInWritingTz(now);
  const monthKey = monthKeyFromYmd(todayKey);
  const yearKey = yearKeyFromYmd(todayKey);

  let monthlyTotal = 0;
  let yearlyTotal = 0;
  let bestDayThisMonth = { date: "-", minutes: 0 };
  let bestDayThisYear = { date: "-", minutes: 0 };

  for (const day of dayKeys) {
    const minutes = byDay[day].minutes;
    if (day.startsWith(monthKey)) {
      monthlyTotal += minutes;
      if (minutes > bestDayThisMonth.minutes) bestDayThisMonth = { date: day, minutes };
    }
    if (day.startsWith(yearKey)) {
      yearlyTotal += minutes;
      if (minutes > bestDayThisYear.minutes) bestDayThisYear = { date: day, minutes };
    }
  }

  const daysInYear = dayKeys.filter((d) => d.startsWith(yearKey)).length;
  const dailyAverage = daysInYear ? Math.round(yearlyTotal / daysInYear) : 0;

  const currentPeriod = getCalendarRange(todayKey, 7);
  const previousPeriod = getCalendarRange(addDaysToYmd(todayKey, -7), 7);
  const weekNow = currentPeriod.reduce((sum, day) => sum + (byDay[day]?.minutes || 0), 0);
  const weekPrev = previousPeriod.reduce((sum, day) => sum + (byDay[day]?.minutes || 0), 0);
  const dailyNow = Math.round(weekNow / 7);
  const dailyPrev = Math.round(weekPrev / 7);
  const diff = dailyNow - dailyPrev;
  const pct = dailyPrev ? Math.round((diff / dailyPrev) * 100) : 0;

  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowWeekday = tomorrow.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" });
  const sameWeekday = sessions.filter(
    (session) => new Date(session.start).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }) === tomorrowWeekday
  );

  const starts = sameWeekday
    .map((s) => {
      const d = new Date(s.start);
      return getHourInWritingTz(d) * 60 + getMinuteInWritingTz(d);
    })
    .sort((a, b) => a - b);

  const medianStart = starts.length ? starts[Math.floor(starts.length / 2)] : 9 * 60;
  const clustered = sameWeekday.filter((s) => {
    const d = new Date(s.start);
    const minuteOfDay = getHourInWritingTz(d) * 60 + getMinuteInWritingTz(d);
    return Math.abs(minuteOfDay - medianStart) <= 90;
  });
  const sample = clustered.length >= 3 ? clustered : sameWeekday;

  return {
    dailyAverage,
    monthlyTotal,
    yearlyTotal,
    bestDayThisMonth,
    bestDayThisYear,
    trend: { dailyNow, dailyPrev, diff, pct, currentPeriod, previousPeriod },
    motivation: {
      weekday: tomorrowWeekday,
      dataPoints: sample.length,
      medianStart,
      avgDuration: sample.length ? averageDurationMinutes(sample) : 45,
      startExamples: sample.slice(0, 5).map((s) => timeLabel.format(new Date(s.start))),
      durations: sample.slice(0, 5).map((s) => Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000))
    }
  };
}
