import assert from "node:assert/strict";
import test from "node:test";
import { capLinePointsAtDate } from "../lib/lineGraph.ts";

test("current-period line graph points are capped at today", () => {
  const points = [
    { date: "2026-07-01", minutes: 10 },
    { date: "2026-07-02", minutes: 20 },
    { date: "2026-07-03", minutes: 30 }
  ];

  assert.deepEqual(capLinePointsAtDate(points, "2026-07-02"), points.slice(0, 2));
});

test("line graph points are unchanged when no cap date is provided", () => {
  const points = [{ date: "2026-06-01", minutes: 10 }];
  assert.equal(capLinePointsAtDate(points), points);
});
