const MINUTES_PER_DAY = 24 * 60;

export function localMinuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function minutesUntilLocalMidnight(now: Date): number {
  return Math.max(0, MINUTES_PER_DAY - localMinuteOfDay(now));
}

export function canFitToday(startMinute: number, requiredMinutes: number): boolean {
  return startMinute + requiredMinutes <= MINUTES_PER_DAY;
}

export function isFutureFeasibleToday(startMinute: number, nowMinute: number, requiredMinutes: number, futureBufferMinutes: number): boolean {
  return startMinute >= nowMinute + futureBufferMinutes && canFitToday(startMinute, requiredMinutes);
}

export function fitDurationBeforeMidnight(rawDurationMinutes: number, startMinute: number, requiredMinutes: number): number | null {
  const remainingAfterStart = Math.max(0, MINUTES_PER_DAY - startMinute);
  if (remainingAfterStart < requiredMinutes) return null;
  return Math.max(requiredMinutes, Math.min(rawDurationMinutes, remainingAfterStart));
}
