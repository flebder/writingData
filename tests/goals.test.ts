import assert from "node:assert/strict";
import test from "node:test";
import { createWritingGoalsEvent, getWritingGoalsForDate, validateWritingGoals } from "../lib/goals.ts";

test("writing goals are effective-dated and non-retroactive", () => {
  const event = createWritingGoalsEvent({ baselineMinutes: 35, awesomeMinutes: 70, stretchMinutes: 140 }, "2026-06-01");

  assert.equal(getWritingGoalsForDate([event], "2026-05-31").baselineMinutes, 30);
  assert.equal(getWritingGoalsForDate([event], "2026-06-01").baselineMinutes, 35);
  assert.equal(getWritingGoalsForDate([event], "2026-06-10").stretchMinutes, 140);
});

test("writing goal validation requires increasing thresholds", () => {
  assert.equal(validateWritingGoals({ baselineMinutes: 0, awesomeMinutes: 60, stretchMinutes: 120 }), "Goal must be at least 1 minute.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 30, stretchMinutes: 120 }), "Awesome must be at least one minute above goal.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 60 }), "Stretch must be at least one minute above awesome.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 }), null);
});
