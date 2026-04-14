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

export type WritingRecommendation = {
  target: "today" | "tomorrow";
  targetDateYmd: string;
  weekday: string;
  suggestedStartMinutes: number;
  suggestedDurationMinutes: number;
  dataPoints: number;
  reason: "weekday_pattern" | "general_pattern" | "fallback_default";
  evidence: string;
};

type BucketStats = {
  bucketStart: number;
  weightedFrequency: number;
  weightedMinutes: number;
  weightedDurationSum: number;
  rawCount: number;
};

type RankedBucket = {
  bucket: BucketStats;
  score: number;
  avgDuration: number;
};

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((aUtc - bUtc) / 86_400_000);
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
  if (max <= 0) return 0;
  return value / max;
}

function toBucket(minuteOfDay: number, bucketSizeMinutes: number): number {
  return Math.max(0, Math.min(23 * 60 + 30, Math.floor(minuteOfDay / bucketSizeMinutes) * bucketSizeMinutes));
}

function inPreferredWindow(minuteOfDay: number, policy: RecommendationPolicy): boolean {
  return minuteOfDay >= policy.preferredStartWindow.earliestMinute && minuteOfDay <= policy.preferredStartWindow.latestMinute;
}

function rankBuckets(buckets: BucketStats[], policy: RecommendationPolicy): RankedBucket[] {
  if (!buckets.length) return [];

  const maxFreq = Math.max(...buckets.map((b) => b.weightedFrequency));
  const maxTotalMinutes = Math.max(...buckets.map((b) => b.weightedMinutes));
  const maxAvgDuration = Math.max(...buckets.map((b) => (b.weightedFrequency ? b.weightedDurationSum / b.weightedFrequency : 0)));

  const ranked = buckets.map((b) => {
    const avgDuration = b.weightedFrequency ? b.weightedDurationSum / b.weightedFrequency : 0;
    const preferenceWeight = inPreferredWindow(b.bucketStart, policy) ? 1 : policy.outOfWindowPenalty;
    const score = (
      normalize(b.weightedFrequency, maxFreq) * 0.4 +
      normalize(avgDuration, maxAvgDuration) * 0.35 +
      normalize(b.weightedMinutes, maxTotalMinutes) * 0.25
    ) * preferenceWeight;

    return { bucket: b, score, avgDuration };
  });

  ranked.sort((a, b) => b.score - a.score || b.avgDuration - a.avgDuration || b.bucket.rawCount - a.bucket.rawCount);
  return ranked;
}

function makeBuckets(sessions: WritingSession[], nowYmd: string, policy: RecommendationPolicy): BucketStats[] {
  const map = new Map<number, BucketStats>();
  for (const s of sessions) {
    const start = new Date(s.start);
    const dayKey = getYmdInWritingTz(start);
    const bucketStart = toBucket(getMinuteOfDayInWritingTz(start), policy.bucketSizeMinutes);
    const recency = getRecencyWeight(nowYmd, dayKey, policy.recencyHalfLifeDays);
    const duration = getSessionDurationMinutes(s);

    const bucket = map.get(bucketStart) || {
      bucketStart,
      weightedFrequency: 0,
      weightedMinutes: 0,
      weightedDurationSum: 0,
      rawCount: 0
    };

    bucket.weightedFrequency += recency;
    bucket.weightedMinutes += duration * recency;
    bucket.weightedDurationSum += duration * recency;
    bucket.rawCount += 1;
    map.set(bucketStart, bucket);
  }
  return Array.from(map.values());
}

function formatClock(minuteOfDay: number): string {
  return new Date(Date.UTC(2026, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60)).toLocaleTimeString("en-US", {
    timeZone: WRITING_TZ,
    hour: "numeric",
    minute: "2-digit"
  });
}

function getEvidenceLine(weekday: string, ranked: RankedBucket[], policy: RecommendationPolicy): string {
  if (!ranked.length) return "No strong weekday pattern yet, so this uses your overall best writing window.";
  const best = ranked[0].bucket.bucketStart;
  const rangeEnd = Math.min(23 * 60 + 59, best + policy.bucketSizeMinutes);
  return `On ${weekday}s, your strongest sessions cluster around ${formatClock(best)}–${formatClock(rangeEnd)}.`;
}

function pickFutureBucketForToday(ranked: RankedBucket[], nowMinute: number, policy: RecommendationPolicy): RankedBucket | null {
  const remaining = ranked.filter((r) => r.bucket.bucketStart >= nowMinute);
  if (remaining.length) return remaining[0];

  const inWindow = ranked.filter((r) => inPreferredWindow(r.bucket.bucketStart, policy));
  return inWindow[0] || null;
}

export function buildWritingRecommendation(sessions: WritingSession[], now = new Date(), policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY): WritingRecommendation {
  const nowYmd = todayYmdInWritingTz(now);
  const nowMinute = getMinuteOfDayInWritingTz(now);
  const validSessions = sessions.filter((s) => new Date(s.start) <= now);
  const wroteToday = validSessions.some((s) => getYmdInWritingTz(new Date(s.start)) === nowYmd);

  const candidateDate = new Date(now);
  let target: "today" | "tomorrow" = wroteToday ? "tomorrow" : "today";
  if (target === "tomorrow") candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);

  const weekday = candidateDate.toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ });
  const targetDateYmd = todayYmdInWritingTz(candidateDate);

  const sameWeekdaySessions = validSessions.filter(
    (s) => new Date(s.start).toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ }) === weekday
  );

  const weekdayRanked = rankBuckets(makeBuckets(sameWeekdaySessions, nowYmd, policy), policy);
  const generalRanked = rankBuckets(makeBuckets(validSessions, nowYmd, policy), policy);

  let chosen = weekdayRanked[0];
  let reason: WritingRecommendation["reason"] = "weekday_pattern";
  let evidence = getEvidenceLine(weekday, weekdayRanked, policy);
  let dataPoints = sameWeekdaySessions.length;

  if (!chosen || sameWeekdaySessions.length < policy.minimumWeekdaySamples) {
    chosen = generalRanked[0];
    reason = "general_pattern";
    evidence = "Using your broader writing history because this weekday has limited data.";
    dataPoints = validSessions.length;
  }

  if (target === "today" && chosen) {
    const weekdayTodayChoice = pickFutureBucketForToday(weekdayRanked, nowMinute, policy);
    const generalTodayChoice = pickFutureBucketForToday(generalRanked, nowMinute, policy);

    const bestFuture = weekdayTodayChoice || generalTodayChoice;
    if (bestFuture) {
      chosen = bestFuture;
      if (bestFuture === generalTodayChoice && !weekdayTodayChoice) {
        reason = "general_pattern";
        evidence = "Today’s weekday pattern has no remaining time slots, so this uses your best later-time habit.";
      }
    } else {
      target = "tomorrow";
      const tomorrowDate = new Date(now);
      tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
      const tomorrowWeekday = tomorrowDate.toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ });
      const tomorrowSessions = validSessions.filter(
        (s) => new Date(s.start).toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ }) === tomorrowWeekday
      );
      const tomorrowRanked = rankBuckets(makeBuckets(tomorrowSessions, nowYmd, policy), policy);
      chosen = tomorrowRanked[0] || generalRanked[0];
      reason = tomorrowRanked[0] ? "weekday_pattern" : "general_pattern";
      evidence = tomorrowRanked[0]
        ? getEvidenceLine(tomorrowWeekday, tomorrowRanked, policy)
        : "All remaining times today have passed, so this uses your strongest overall writing window for tomorrow.";
      dataPoints = tomorrowRanked[0] ? tomorrowSessions.length : validSessions.length;
      return {
        target,
        targetDateYmd: todayYmdInWritingTz(tomorrowDate),
        weekday: tomorrowWeekday,
        suggestedStartMinutes: chosen ? chosen.bucket.bucketStart + policy.bucketSizeMinutes / 2 : 9 * 60,
        suggestedDurationMinutes: chosen ? Math.max(20, Math.round(chosen.avgDuration || 45)) : 45,
        dataPoints,
        reason,
        evidence
      };
    }
  }

  if (!chosen) {
    return {
      target,
      targetDateYmd,
      weekday,
      suggestedStartMinutes: Math.max(policy.preferredStartWindow.earliestMinute, 9 * 60),
      suggestedDurationMinutes: 45,
      dataPoints: 0,
      reason: "fallback_default",
      evidence: "No strong history yet; this is a simple starter plan based on your preferred writing window."
    };
  }

  return {
    target,
    targetDateYmd,
    weekday,
    suggestedStartMinutes: chosen.bucket.bucketStart + policy.bucketSizeMinutes / 2,
    suggestedDurationMinutes: Math.max(20, Math.round(chosen.avgDuration || 45)),
    dataPoints,
    reason,
    evidence
  };
}
