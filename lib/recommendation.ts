import { addDaysToYmd, getHourInWritingTz, getMinuteInWritingTz, getYmdInWritingTz, todayYmdInWritingTz, WRITING_TZ, zonedLocalToUtc, type WritingSession } from "@/lib/writing";

export type TimeBandPolicy = {
  preferred: { startMinute: number; endMinute: number; weight: number };
  acceptable: { startMinute: number; endMinute: number; weight: number };
  penalized: { startMinute: number; endMinute: number; weight: number };
};

export type RecommendationPolicy = {
  bucketSizeMinutes: number;
  recencyHalfLifeDays: number;
  minimumWeekdaySamples: number;
  minimumRecommendationMinutes: number;
  targetGoalMinutes: number;
  softMaxRecommendationMinutes: number;
  durationNudgeMinutes: number;
  futureBufferMinutes: number;
  confidenceK: number;
  timeBands: TimeBandPolicy;
};

export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  bucketSizeMinutes: 30,
  recencyHalfLifeDays: 60,
  minimumWeekdaySamples: 4,
  minimumRecommendationMinutes: 30,
  targetGoalMinutes: 60,
  softMaxRecommendationMinutes: 75,
  durationNudgeMinutes: 6,
  futureBufferMinutes: 10,
  confidenceK: 4,
  timeBands: {
    preferred: { startMinute: 5 * 60 + 30, endMinute: 22 * 60 + 30, weight: 1 },
    acceptable: { startMinute: 22 * 60 + 30, endMinute: 23 * 60 + 59, weight: 0.62 },
    penalized: { startMinute: 0, endMinute: 5 * 60 + 29, weight: 0.08 }
  }
};

export type ClusterStats = {
  bucketStart: number;
  bucketEnd: number;
  representativeMinute: number;
  score: number;
  sessionCount: number;
  averageDurationMinutes: number;
  totalMinutes: number;
};

export type WritingRecommendation = {
  target: "today" | "tomorrow";
  targetDateYmd: string;
  weekday: string;
  suggestedStartMinutes: number;
  suggestedDurationMinutes: number;
  chosenCluster: ClusterStats | null;
  alternativeCluster: ClusterStats | null;
  supportingSentence: string;
  encouragement: string;
};

type BucketAggregate = {
  bucketStart: number;
  weightedFrequency: number;
  weightedTotalMinutes: number;
  weightedDurationMeanNumerator: number;
  sessionCount: number;
  rawTotalMinutes: number;
  startMinutes: number[];
};

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

function getMinuteOfDayInWritingTz(date: Date, timeZone: string): number {
  return getHourInWritingTz(date, timeZone) * 60 + getMinuteInWritingTz(date, timeZone);
}

function getDurationMinutes(session: WritingSession): number {
  return Math.max(1, Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60_000));
}

function getRecencyWeight(nowYmd: string, sessionYmd: string, halfLifeDays: number): number {
  const ageDays = Math.max(0, daysBetweenYmd(nowYmd, sessionYmd));
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function weekdayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function toBucket(minuteOfDay: number, bucketSize: number): number {
  return Math.floor(minuteOfDay / bucketSize) * bucketSize;
}

function normalize(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

function bandWeight(minute: number, policy: RecommendationPolicy): number {
  if (minute >= policy.timeBands.preferred.startMinute && minute <= policy.timeBands.preferred.endMinute) return policy.timeBands.preferred.weight;
  if (minute >= policy.timeBands.acceptable.startMinute && minute <= policy.timeBands.acceptable.endMinute) return policy.timeBands.acceptable.weight;
  return policy.timeBands.penalized.weight;
}

function formatClock(minute: number, timeZone: string): string {
  return new Date(Date.UTC(2026, 0, 1, Math.floor(minute / 60), minute % 60)).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });
}

function aggregateBuckets(sessions: WritingSession[], nowYmd: string, policy: RecommendationPolicy, timeZone: string): BucketAggregate[] {
  const map = new Map<number, BucketAggregate>();
  for (const session of sessions) {
    const start = new Date(session.start);
    const dayYmd = session.dateKey || getYmdInWritingTz(start, timeZone);
    const minute = getMinuteOfDayInWritingTz(start, timeZone);
    const bucketStart = toBucket(minute, policy.bucketSizeMinutes);
    const duration = getDurationMinutes(session);
    const recencyWeight = getRecencyWeight(nowYmd, dayYmd, policy.recencyHalfLifeDays);

    const bucket = map.get(bucketStart) || {
      bucketStart,
      weightedFrequency: 0,
      weightedTotalMinutes: 0,
      weightedDurationMeanNumerator: 0,
      sessionCount: 0,
      rawTotalMinutes: 0,
      startMinutes: []
    };

    bucket.weightedFrequency += recencyWeight;
    bucket.weightedTotalMinutes += duration * recencyWeight;
    bucket.weightedDurationMeanNumerator += duration * recencyWeight;
    bucket.sessionCount += 1;
    bucket.rawTotalMinutes += duration;
    bucket.startMinutes.push(minute);
    map.set(bucketStart, bucket);
  }
  return Array.from(map.values());
}

function toCluster(bucket: BucketAggregate, score: number, policy: RecommendationPolicy): ClusterStats {
  const sortedStarts = [...bucket.startMinutes].sort((a, b) => a - b);
  const representativeMinute = sortedStarts[Math.floor(sortedStarts.length / 2)] ?? bucket.bucketStart;
  return {
    bucketStart: bucket.bucketStart,
    bucketEnd: Math.min(23 * 60 + 59, bucket.bucketStart + policy.bucketSizeMinutes),
    representativeMinute,
    score,
    sessionCount: bucket.sessionCount,
    averageDurationMinutes: Math.round(bucket.rawTotalMinutes / Math.max(1, bucket.sessionCount)),
    totalMinutes: Math.round(bucket.rawTotalMinutes)
  };
}

function rankClusters(buckets: BucketAggregate[], policy: RecommendationPolicy): ClusterStats[] {
  if (!buckets.length) return [];
  const maxFreq = Math.max(...buckets.map((b) => b.weightedFrequency));
  const maxTotal = Math.max(...buckets.map((b) => b.weightedTotalMinutes));
  const baselineAvg = buckets.reduce((sum, b) => sum + b.rawTotalMinutes, 0) / Math.max(1, buckets.reduce((sum, b) => sum + b.sessionCount, 0));
  const adjustedAverages = buckets.map((b) => {
    const rawAvg = b.weightedFrequency > 0 ? b.weightedDurationMeanNumerator / b.weightedFrequency : baselineAvg;
    const confidence = b.sessionCount / (b.sessionCount + policy.confidenceK);
    return rawAvg * confidence + baselineAvg * (1 - confidence);
  });
  const maxAvg = Math.max(...adjustedAverages);

  return buckets
    .map((bucket, idx) => {
      const avg = adjustedAverages[idx];
      const confidence = bucket.sessionCount / (bucket.sessionCount + policy.confidenceK);
      const weightedScore =
        normalize(bucket.weightedFrequency, maxFreq) * 0.25 +
        normalize(avg, maxAvg) * 0.4 +
        normalize(bucket.weightedTotalMinutes, maxTotal) * 0.2 +
        Math.min(1, bucket.sessionCount / 10) * 0.15;
      const score = weightedScore * bandWeight(bucket.bucketStart, policy) * (0.35 + 0.65 * confidence);
      return toCluster(bucket, score, policy);
    })
    .sort((a, b) => b.score - a.score || b.averageDurationMinutes - a.averageDurationMinutes || b.sessionCount - a.sessionCount || a.representativeMinute - b.representativeMinute);
}

function buildDurationRecommendation(chosen: ClusterStats | null, sessions: WritingSession[], policy: RecommendationPolicy, nowYmd: string, timeZone: string): number {
  const allDurations = sessions.map(getDurationMinutes);
  const overallAvg = allDurations.length ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : 48;

  const recentCutoffYmd = addDaysToYmd(nowYmd, -45);
  const recentDurations = sessions
    .filter((s) => (s.dateKey || getYmdInWritingTz(new Date(s.start), timeZone)) >= recentCutoffYmd)
    .map(getDurationMinutes);
  const recentAvg = recentDurations.length ? recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length : overallAvg;

  const clusterAvg = chosen?.averageDurationMinutes ?? overallAvg;
  const clusterWeight = Math.min(0.7, (chosen?.sessionCount ?? 0) / 10);
  const blended = clusterAvg * clusterWeight + overallAvg * 0.35 + recentAvg * (0.65 - clusterWeight);

  const nudge = blended < policy.targetGoalMinutes ? policy.durationNudgeMinutes : 0;
  const adjusted = roundToNearest(blended + nudge, 5);
  return clamp(adjusted, policy.minimumRecommendationMinutes, policy.softMaxRecommendationMinutes);
}

function isClusterStillValidToday(cluster: ClusterStats, targetYmd: string, now: Date, policy: RecommendationPolicy, timeZone: string): boolean {
  const [y, m, d] = targetYmd.split("-").map(Number);
  const scheduledUtc = zonedLocalToUtc(y, m, d, Math.floor(cluster.representativeMinute / 60), cluster.representativeMinute % 60, 0, timeZone).getTime();
  return scheduledUtc >= now.getTime() + policy.futureBufferMinutes * 60_000;
}

function pickBestValidClusterForToday(candidates: ClusterStats[], targetYmd: string, now: Date, policy: RecommendationPolicy, timeZone: string): ClusterStats | null {
  return candidates.find((cluster) => isClusterStillValidToday(cluster, targetYmd, now, policy, timeZone)) || null;
}

function supportingSentence(weekday: string, chosen: ClusterStats | null, timeZone: string): string {
  if (!chosen) return "Use this as a steady writing block and build momentum.";
  return `${weekday}s are most reliable around ${formatClock(chosen.bucketStart, timeZone)}–${formatClock(chosen.bucketEnd, timeZone)} (${chosen.sessionCount} sessions).`;
}

export function buildWritingRecommendation(
  sessions: WritingSession[],
  now = new Date(),
  policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY,
  timeZone = WRITING_TZ
): WritingRecommendation {
  const nowYmd = todayYmdInWritingTz(now, timeZone);
  const nowMinute = getMinuteOfDayInWritingTz(now, timeZone);
  const validSessions = sessions.filter((s) => new Date(s.start) <= now);
  const wroteToday = sessions.some((s) => (s.dateKey || getYmdInWritingTz(new Date(s.start), timeZone)) === nowYmd);

  const targetDate = new Date(now);
  let target: "today" | "tomorrow" = wroteToday ? "tomorrow" : "today";
  if (target === "tomorrow") targetDate.setUTCDate(targetDate.getUTCDate() + 1);

  const targetYmd = todayYmdInWritingTz(targetDate, timeZone);
  const weekday = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone });

  const weekdaySessions = validSessions.filter(
    (s) => weekdayFromYmd(s.dateKey || getYmdInWritingTz(new Date(s.start), timeZone)) === weekday
  );

  const weekdayClusters = rankClusters(aggregateBuckets(weekdaySessions, nowYmd, policy, timeZone), policy);
  const generalClusters = rankClusters(aggregateBuckets(validSessions, nowYmd, policy, timeZone), policy);

  let chosen: ClusterStats | null = weekdayClusters[0] || null;
  let alternative: ClusterStats | null =
    weekdayClusters.find((c) => c.bucketStart !== chosen?.bucketStart && c.sessionCount >= 3) || null;

  if (!chosen || weekdaySessions.length < policy.minimumWeekdaySamples) {
    chosen = generalClusters[0] || null;
    alternative = generalClusters[1] || null;
  }

  if (target === "today") {
    const weekdayValid = pickBestValidClusterForToday(weekdayClusters, targetYmd, now, policy, timeZone);
    const generalValid = pickBestValidClusterForToday(generalClusters, targetYmd, now, policy, timeZone);
    if (weekdayValid) {
      chosen = weekdayValid;
      alternative = weekdayClusters.find((c) => c.bucketStart !== weekdayValid.bucketStart && c.sessionCount >= 3) || null;
    } else if (generalValid) {
      chosen = generalValid;
      alternative = generalClusters.find((c) => c.bucketStart !== generalValid.bucketStart && c.sessionCount >= 3) || null;
    } else {
      // If all practical windows are already in the past and user has not written yet, choose the nearest upcoming slot today.
      const earliestFallback = Math.max(policy.timeBands.preferred.startMinute, nowMinute + policy.futureBufferMinutes);
      const fallbackMinute = clamp(roundToNearest(earliestFallback, policy.bucketSizeMinutes), earliestFallback, 23 * 60 + 59);
      chosen = {
        bucketStart: toBucket(fallbackMinute, policy.bucketSizeMinutes),
        bucketEnd: Math.min(23 * 60 + 59, toBucket(fallbackMinute, policy.bucketSizeMinutes) + policy.bucketSizeMinutes),
        representativeMinute: fallbackMinute,
        score: 0,
        sessionCount: 0,
        averageDurationMinutes: 45,
        totalMinutes: 0
      };
      alternative = generalClusters.find((c) => c.sessionCount >= 3) || null;
    }
  }

  const suggestedDurationMinutes = buildDurationRecommendation(chosen, validSessions, policy, nowYmd, timeZone);

  return {
    target,
    targetDateYmd: targetYmd,
    weekday,
    suggestedStartMinutes: chosen?.representativeMinute ?? policy.timeBands.preferred.startMinute,
    suggestedDurationMinutes,
    chosenCluster: chosen,
    alternativeCluster: alternative,
    supportingSentence: supportingSentence(weekday, chosen, timeZone),
    encouragement: "You got this!"
  };
}
