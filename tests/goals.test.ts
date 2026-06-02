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


test("gradual goal shifts work backward from the target date", () => {
  const schedule = buildGradualGoalSchedule(
    { baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 },
    { baselineMinutes: 40, awesomeMinutes: 60, stretchMinutes: 120 },
    "2026-07-08"
  );

  assert.deepEqual(schedule.map((goals) => [goals.effectiveDate, goals.baselineMinutes, goals.awesomeMinutes, goals.stretchMinutes]), [
    ["2026-06-24", 35, 60, 120],
    ["2026-07-08", 40, 60, 120]
  ]);
});

test("gradual goal shifts can move downward toward the target date", () => {
  const schedule = buildGradualGoalSchedule(
    { baselineMinutes: 40, awesomeMinutes: 60, stretchMinutes: 120 },
    { baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 },
    "2026-07-08"
  );

  assert.deepEqual(schedule.map((goals) => [goals.effectiveDate, goals.baselineMinutes]), [
    ["2026-06-24", 35],
    ["2026-07-08", 30]
  ]);
});


test("small gradual shifts create only a target-date snapshot", () => {
  const schedule = buildGradualGoalSchedule(
    { baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 },
    { baselineMinutes: 34, awesomeMinutes: 60, stretchMinutes: 120 },
    "2026-07-08"
  );

  assert.deepEqual(schedule.map((goals) => [goals.effectiveDate, goals.baselineMinutes]), [["2026-07-08", 34]]);
});
