import { getHourInWritingTz, getMinuteInWritingTz, getYmdInWritingTz, todayYmdInWritingTz, WRITING_TZ, type WritingSession } from "@/lib/writing";

export type RecommendationPolicy = {
  preferredStartWindow: { earliestMinute: number; latestMinute: number };
  outOfWindowPenalty: number;
  bucketSizeMinutes: number;
  recencyHalfLifeDays: number;
  minimumWeekdaySamples: number;
};

export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  preferredStartWindow: {
    earliestMinute: 5 * 60 + 30,
    latestMinute: 23 * 60 + 59
  },
  outOfWindowPenalty: 0.58,
  bucketSizeMinutes: 30,
  recencyHalfLifeDays: 75,
  minimumWeekdaySamples: 3
};

type ClusterStats = {
  bucketStart: number;
  bucketEnd: number;
  recommendedMinute: number;
  score: number;
  sessionCount: number;
  avgDurationMinutes: number;
  totalMinutes: number;
  weightedFrequency: number;
};

export type WritingRecommendation = {
  target: "today" | "tomorrow";
  targetDateYmd: string;
  weekday: string;
  suggestedStartMinutes: number;
  suggestedDurationMinutes: number;
  reason: "weekday_pattern" | "general_pattern" | "fallback_default";
  supportingSentence: string;
  chosenCluster: ClusterStats | null;
  comparisonCluster: ClusterStats | null;
};

type BucketStats = {
  bucketStart: number;
  weightedFrequency: number;
  weightedMinutes: number;
  weightedDurationSum: number;
  rawCount: number;
  totalMinutesRaw: number;
  startsRaw: number[];
};

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

function getMinuteOfDayInWritingTz(date: Date): number {
  return getHourInWritingTz(date) * 60 + getMinuteInWritingTz(date);
}

function getSessionDurationMinutes(session: WritingSession): number {
  return Math.max(1, Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60_000));
}

function getRecencyWeight(nowYmd: string, sessionYmd: string, halfLifeDays: number): number {
  const ageDays = Math.max(0, daysBetweenYmd(nowYmd, sessionYmd));
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function normalize(value: number, max: number): number {
  return max <= 0 ? 0 : value / max;
}

function toBucket(minuteOfDay: number, bucketSizeMinutes: number): number {
  return Math.max(0, Math.min(23 * 60 + 30, Math.floor(minuteOfDay / bucketSizeMinutes) * bucketSizeMinutes));
}

function inPreferredWindow(minuteOfDay: number, policy: RecommendationPolicy): boolean {
  return minuteOfDay >= policy.preferredStartWindow.earliestMinute && minuteOfDay <= policy.preferredStartWindow.latestMinute;
}

function pickRepresentativeMinute(startsRaw: number[]): number {
  const starts = [...startsRaw].sort((a, b) => a - b);
  return starts[Math.floor(starts.length / 2)] ?? 9 * 60;
}

function formatClock(minuteOfDay: number): string {
  return new Date(Date.UTC(2026, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60)).toLocaleTimeString("en-US", {
    timeZone: WRITING_TZ,
    hour: "numeric",
    minute: "2-digit"
  });
}

function toClusterStats(bucket: BucketStats, score: number, policy: RecommendationPolicy): ClusterStats {
  return {
    bucketStart: bucket.bucketStart,
    bucketEnd: Math.min(23 * 60 + 59, bucket.bucketStart + policy.bucketSizeMinutes),
    recommendedMinute: pickRepresentativeMinute(bucket.startsRaw),
    score,
    sessionCount: bucket.rawCount,
    avgDurationMinutes: Math.round(bucket.totalMinutesRaw / Math.max(1, bucket.rawCount)),
    totalMinutes: Math.round(bucket.totalMinutesRaw),
    weightedFrequency: bucket.weightedFrequency
  };
}

function rankBuckets(buckets: BucketStats[], policy: RecommendationPolicy): ClusterStats[] {
  if (!buckets.length) return [];

  const maxFreq = Math.max(...buckets.map((b) => b.weightedFrequency));
  const maxTotalMinutes = Math.max(...buckets.map((b) => b.weightedMinutes));
  const maxAvgDuration = Math.max(...buckets.map((b) => (b.weightedFrequency ? b.weightedDurationSum / b.weightedFrequency : 0)));

  return buckets
    .map((bucket) => {
      const avgDuration = bucket.weightedFrequency ? bucket.weightedDurationSum / bucket.weightedFrequency : 0;
      const preferenceWeight = inPreferredWindow(bucket.bucketStart, policy) ? 1 : policy.outOfWindowPenalty;
      const score = (
        normalize(bucket.weightedFrequency, maxFreq) * 0.35 +
        normalize(avgDuration, maxAvgDuration) * 0.4 +
        normalize(bucket.weightedMinutes, maxTotalMinutes) * 0.25
      ) * preferenceWeight;
      return toClusterStats(bucket, score, policy);
    })
    .sort((a, b) => b.score - a.score || b.avgDurationMinutes - a.avgDurationMinutes || b.sessionCount - a.sessionCount);
}

function makeBuckets(sessions: WritingSession[], nowYmd: string, policy: RecommendationPolicy): BucketStats[] {
  const map = new Map<number, BucketStats>();
  for (const session of sessions) {
    const start = new Date(session.start);
    const startMinute = getMinuteOfDayInWritingTz(start);
    const bucketStart = toBucket(startMinute, policy.bucketSizeMinutes);
    const dayKey = getYmdInWritingTz(start);
    const recency = getRecencyWeight(nowYmd, dayKey, policy.recencyHalfLifeDays);
    const duration = getSessionDurationMinutes(session);

    const bucket = map.get(bucketStart) || {
      bucketStart,
      weightedFrequency: 0,
      weightedMinutes: 0,
      weightedDurationSum: 0,
      rawCount: 0,
      totalMinutesRaw: 0,
      startsRaw: []
    };

    bucket.weightedFrequency += recency;
    bucket.weightedMinutes += duration * recency;
    bucket.weightedDurationSum += duration * recency;
    bucket.rawCount += 1;
    bucket.totalMinutesRaw += duration;
    bucket.startsRaw.push(startMinute);
    map.set(bucketStart, bucket);
  }

  return Array.from(map.values());
}

function buildSupportingSentence(weekday: string, chosen: ClusterStats | null, comparison: ClusterStats | null): string {
  if (!chosen) return "No strong pattern yet—this is a simple starter recommendation.";

  const chosenWindow = `${formatClock(chosen.bucketStart)}–${formatClock(chosen.bucketEnd)}`;
  if (!comparison) {
    return `On ${weekday}s, your longest sessions usually start around ${chosenWindow}.`;
  }

  const diff = chosen.avgDurationMinutes - comparison.avgDurationMinutes;
  if (diff >= 5) {
    return `On ${weekday}s, ${chosenWindow} sessions run about ${diff} minutes longer than your next-best window.`;
  }

  return `On ${weekday}s, your strongest window is ${chosenWindow} based on session length and consistency.`;
}

function pickFutureCluster(ranked: ClusterStats[], nowMinute: number): ClusterStats | null {
  return ranked.find((cluster) => cluster.recommendedMinute >= nowMinute) || null;
}

export function buildWritingRecommendation(sessions: WritingSession[], now = new Date(), policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY): WritingRecommendation {
  const nowYmd = todayYmdInWritingTz(now);
  const nowMinute = getMinuteOfDayInWritingTz(now);
  const validSessions = sessions.filter((session) => new Date(session.start) <= now);
  const wroteToday = validSessions.some((session) => getYmdInWritingTz(new Date(session.start)) === nowYmd);

  const targetDate = new Date(now);
  let target: "today" | "tomorrow" = wroteToday ? "tomorrow" : "today";
  if (target === "tomorrow") targetDate.setUTCDate(targetDate.getUTCDate() + 1);

  const weekday = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ });
  const targetDateYmd = todayYmdInWritingTz(targetDate);

  const weekdaySessions = validSessions.filter(
    (session) => new Date(session.start).toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ }) === weekday
  );

  const weekdayRanked = rankBuckets(makeBuckets(weekdaySessions, nowYmd, policy), policy);
  const generalRanked = rankBuckets(makeBuckets(validSessions, nowYmd, policy), policy);

  let chosen: ClusterStats | null = weekdayRanked[0] || null;
  let comparison: ClusterStats | null = weekdayRanked[1] || null;
  let reason: WritingRecommendation["reason"] = "weekday_pattern";

  if (!chosen || weekdaySessions.length < policy.minimumWeekdaySamples) {
    chosen = generalRanked[0] || null;
    comparison = generalRanked[1] || null;
    reason = chosen ? "general_pattern" : "fallback_default";
  }

  if (target === "today") {
    const weekdayFuture = pickFutureCluster(weekdayRanked, nowMinute);
    const generalFuture = pickFutureCluster(generalRanked, nowMinute);

    if (weekdayFuture) {
      chosen = weekdayFuture;
      comparison = weekdayRanked.find((c) => c.bucketStart !== weekdayFuture.bucketStart) || null;
      reason = "weekday_pattern";
    } else if (generalFuture) {
      chosen = generalFuture;
      comparison = generalRanked.find((c) => c.bucketStart !== generalFuture.bucketStart) || null;
      reason = "general_pattern";
    } else {
      target = "tomorrow";
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowWeekday = tomorrow.toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ });
      const tomorrowSessions = validSessions.filter(
        (session) => new Date(session.start).toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ }) === tomorrowWeekday
      );
      const tomorrowRanked = rankBuckets(makeBuckets(tomorrowSessions, nowYmd, policy), policy);
      chosen = tomorrowRanked[0] || generalRanked[0] || null;
      comparison = tomorrowRanked[1] || generalRanked[1] || null;
      reason = tomorrowRanked[0] ? "weekday_pattern" : chosen ? "general_pattern" : "fallback_default";

      return {
        target,
        targetDateYmd: todayYmdInWritingTz(tomorrow),
        weekday: tomorrowWeekday,
        suggestedStartMinutes: chosen?.recommendedMinute ?? policy.preferredStartWindow.earliestMinute,
        suggestedDurationMinutes: chosen?.avgDurationMinutes ?? 45,
        reason,
        supportingSentence: buildSupportingSentence(tomorrowWeekday, chosen, comparison),
        chosenCluster: chosen,
        comparisonCluster: comparison
      };
    }
  }

  return {
    target,
    targetDateYmd,
    weekday,
    suggestedStartMinutes: chosen?.recommendedMinute ?? policy.preferredStartWindow.earliestMinute,
    suggestedDurationMinutes: chosen?.avgDurationMinutes ?? 45,
    reason,
    supportingSentence: buildSupportingSentence(weekday, chosen, comparison),
    chosenCluster: chosen,
    comparisonCluster: comparison
  };
}
