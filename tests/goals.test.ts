import assert from "node:assert/strict";
import test from "node:test";
import { buildGradualGoalSchedule, createWritingGoalsEvent, getWritingGoalsForDate, validateWritingGoals } from "../lib/goals.ts";

test("writing goals are effective-dated and non-retroactive", () => {
  const event = createWritingGoalsEvent({ baselineMinutes: 35, awesomeMinutes: 70, stretchMinutes: 140 }, "2026-06-01");

  assert.equal(getWritingGoalsForDate([event], "2026-05-31").baselineMinutes, 30);
  assert.equal(getWritingGoalsForDate([event], "2026-06-01").baselineMinutes, 35);
  assert.equal(getWritingGoalsForDate([event], "2026-06-10").stretchMinutes, 140);
});

test("writing goal validation requires increasing thresholds", () => {
  assert.equal(validateWritingGoals({ baselineMinutes: 0, awesomeMinutes: 60, stretchMinutes: 120 }), "Baseline must be at least 1 minute.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 30, stretchMinutes: 120 }), "Goal must be at least one minute above baseline.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 60 }), "Stretch must be at least one minute above goal.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 }), null);
});


test("gradual goal shifts create two-week five-minute steps", () => {
  const schedule = buildGradualGoalSchedule(
    { baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 },
    { baselineMinutes: 45, awesomeMinutes: 75, stretchMinutes: 135 },
    "2026-06-01"
  );

  assert.deepEqual(schedule.map((goals) => [goals.effectiveDate, goals.baselineMinutes, goals.awesomeMinutes, goals.stretchMinutes]), [
    ["2026-06-01", 35, 65, 125],
    ["2026-06-15", 40, 70, 130],
    ["2026-06-29", 45, 75, 135]
  ]);
});

test("gradual goal shifts can move downward", () => {
  const schedule = buildGradualGoalSchedule(
    { baselineMinutes: 45, awesomeMinutes: 75, stretchMinutes: 135 },
    { baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 },
    "2026-06-01"
  );

  assert.deepEqual(schedule.map((goals) => [goals.effectiveDate, goals.baselineMinutes]), [
    ["2026-06-01", 40],
    ["2026-06-15", 35],
    ["2026-06-29", 30]
  ]);
});
