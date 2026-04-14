import { getHourInWritingTz, getMinuteInWritingTz, getYmdInWritingTz, todayYmdInWritingTz, WRITING_TZ, type WritingSession } from "@/lib/writing";

export type WritingRecommendation = {
  target: "today" | "tomorrow";
  targetDateYmd: string;
  weekday: string;
  suggestedStartMinutes: number;
  suggestedDurationMinutes: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
  reason: string;
};

type BucketStats = {
  bucketStart: number;
  weightedFrequency: number;
  weightedMinutes: number;
  weightedDurationSum: number;
  rawCount: number;
};

const RECENCY_HALF_LIFE_DAYS = 75;
const BUCKET_SIZE_MINUTES = 30;

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

function getRecencyWeight(nowYmd: string, sessionYmd: string): number {
  const ageDays = Math.max(0, daysBetweenYmd(nowYmd, sessionYmd));
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function toBucket(minuteOfDay: number): number {
  return Math.max(0, Math.min(23 * 60 + 30, Math.floor(minuteOfDay / BUCKET_SIZE_MINUTES) * BUCKET_SIZE_MINUTES));
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return value / max;
}

function chooseBestBucket(buckets: BucketStats[]): BucketStats | null {
  if (!buckets.length) return null;

  const maxFreq = Math.max(...buckets.map((b) => b.weightedFrequency));
  const maxTotalMinutes = Math.max(...buckets.map((b) => b.weightedMinutes));
  const maxAvgDuration = Math.max(...buckets.map((b) => (b.weightedFrequency ? b.weightedDurationSum / b.weightedFrequency : 0)));

  const scored = buckets.map((b) => {
    const avgDuration = b.weightedFrequency ? b.weightedDurationSum / b.weightedFrequency : 0;
    const score =
      normalize(b.weightedFrequency, maxFreq) * 0.4 +
      normalize(avgDuration, maxAvgDuration) * 0.35 +
      normalize(b.weightedMinutes, maxTotalMinutes) * 0.25;
    return { bucket: b, score, avgDuration };
  });

  scored.sort((a, b) => b.score - a.score || b.avgDuration - a.avgDuration || b.bucket.rawCount - a.bucket.rawCount);
  return scored[0].bucket;
}

function makeBuckets(sessions: WritingSession[], nowYmd: string): BucketStats[] {
  const map = new Map<number, BucketStats>();
  for (const s of sessions) {
    const start = new Date(s.start);
    const dayKey = getYmdInWritingTz(start);
    const bucketStart = toBucket(getMinuteOfDayInWritingTz(start));
    const recency = getRecencyWeight(nowYmd, dayKey);
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

export function buildWritingRecommendation(sessions: WritingSession[], now = new Date()): WritingRecommendation {
  const nowYmd = todayYmdInWritingTz(now);
  const validSessions = sessions.filter((s) => new Date(s.start) <= now);
  const wroteToday = validSessions.some((s) => getYmdInWritingTz(new Date(s.start)) === nowYmd);

  const targetDate = new Date(now);
  const target: "today" | "tomorrow" = wroteToday ? "tomorrow" : "today";
  if (target === "tomorrow") targetDate.setUTCDate(targetDate.getUTCDate() + 1);

  const targetDateYmd = todayYmdInWritingTz(targetDate);
  const targetWeekday = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ });

  const sameWeekdaySessions = validSessions.filter(
    (s) => new Date(s.start).toLocaleDateString("en-US", { weekday: "long", timeZone: WRITING_TZ }) === targetWeekday
  );

  const weekdayBuckets = makeBuckets(sameWeekdaySessions, nowYmd);
  const bestWeekdayBucket = chooseBestBucket(weekdayBuckets);

  if (bestWeekdayBucket && sameWeekdaySessions.length >= 3) {
    const duration = Math.round(bestWeekdayBucket.weightedDurationSum / Math.max(1, bestWeekdayBucket.weightedFrequency));
    return {
      target,
      targetDateYmd,
      weekday: targetWeekday,
      suggestedStartMinutes: bestWeekdayBucket.bucketStart + BUCKET_SIZE_MINUTES / 2,
      suggestedDurationMinutes: Math.max(20, duration),
      confidence: sameWeekdaySessions.length >= 8 ? "high" : "medium",
      dataPoints: sameWeekdaySessions.length,
      reason: "weekday_pattern"
    };
  }

  const allBuckets = makeBuckets(validSessions, nowYmd);
  const bestGeneralBucket = chooseBestBucket(allBuckets);
  if (bestGeneralBucket) {
    const duration = Math.round(bestGeneralBucket.weightedDurationSum / Math.max(1, bestGeneralBucket.weightedFrequency));
    return {
      target,
      targetDateYmd,
      weekday: targetWeekday,
      suggestedStartMinutes: bestGeneralBucket.bucketStart + BUCKET_SIZE_MINUTES / 2,
      suggestedDurationMinutes: Math.max(20, duration || 45),
      confidence: validSessions.length >= 6 ? "medium" : "low",
      dataPoints: validSessions.length,
      reason: "general_pattern"
    };
  }

  return {
    target,
    targetDateYmd,
    weekday: targetWeekday,
    suggestedStartMinutes: 9 * 60,
    suggestedDurationMinutes: 45,
    confidence: "low",
    dataPoints: 0,
    reason: "fallback_default"
  };
}
