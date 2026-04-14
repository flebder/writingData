import {
  addDaysToYmd,
  aggregateDays,
  getCalendarRange,
  monthKeyFromYmd,
  todayYmdInWritingTz,
  WRITING_TZ,
  type WritingSession,
  yearKeyFromYmd
} from "@/lib/writing";
import { buildWritingRecommendation } from "@/lib/recommendation";

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
    target: "today" | "tomorrow";
    weekday: string;
    dataPoints: number;
    suggestedStartMinutes: number;
    suggestedDurationMinutes: number;
    confidence: "high" | "medium" | "low";
    reason: string;
    headline: string;
    detail: string;
  };
};

function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "high-confidence";
  if (confidence === "medium") return "solid";
  return "light";
}

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

  const recommendation = buildWritingRecommendation(sessions, now);
  const targetLabel = recommendation.target === "today" ? "today" : "tomorrow";
  const clock = new Date(Date.UTC(2026, 0, 1, Math.floor(recommendation.suggestedStartMinutes / 60), recommendation.suggestedStartMinutes % 60)).toLocaleTimeString("en-US", {
    timeZone: WRITING_TZ,
    hour: "numeric",
    minute: "2-digit"
  });

  return {
    dailyAverage,
    monthlyTotal,
    yearlyTotal,
    bestDayThisMonth,
    bestDayThisYear,
    trend: { dailyNow, dailyPrev, diff, pct, currentPeriod, previousPeriod },
    motivation: {
      target: recommendation.target,
      weekday: recommendation.weekday,
      dataPoints: recommendation.dataPoints,
      suggestedStartMinutes: recommendation.suggestedStartMinutes,
      suggestedDurationMinutes: recommendation.suggestedDurationMinutes,
      confidence: recommendation.confidence,
      reason: recommendation.reason,
      headline: `Best ${targetLabel} start: ${clock}`,
      detail: `Aim for about ${recommendation.suggestedDurationMinutes} minutes. This is a ${confidenceLabel(recommendation.confidence)} recommendation from your ${recommendation.dataPoints || "available"} historical sessions.`
    }
  };
}
