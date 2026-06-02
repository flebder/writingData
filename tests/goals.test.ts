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
  assert.equal(validateWritingGoals({ baselineMinutes: 0, awesomeMinutes: 60, stretchMinutes: 120 }), "Baseline must be at least 1 minute.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 30, stretchMinutes: 120 }), "Goal must be at least one minute above baseline.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 60 }), "Stretch must be at least one minute above goal.");
  assert.equal(validateWritingGoals({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 }), null);
});


test("saving a goal change creates one effective-dated threshold update", () => {
  const event = createWritingGoalsEvent({ baselineMinutes: 40, awesomeMinutes: 75, stretchMinutes: 130 }, "2026-06-02");

  assert.equal(event.event_type, "update_writing_goals");
  assert.deepEqual(event.payload, {
    effective_date: "2026-06-02",
    baseline_minutes: 40,
    awesome_minutes: 75,
    stretch_minutes: 130
  });
});
