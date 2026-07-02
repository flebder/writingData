export type LinePointLike = { date: string };

export function capLinePointsAtDate<T extends LinePointLike>(points: T[], capDate?: string): T[] {
  if (!capDate) return points;
  return points.filter((point) => point.date <= capDate);
}
