import assert from "node:assert/strict";
import test from "node:test";
import { fitDurationBeforeMidnight, isFutureFeasibleToday, minutesUntilLocalMidnight } from "../lib/motivationTime.ts";

test("today recommendation timing rejects starts that already passed", () => {
  assert.equal(isFutureFeasibleToday(11 * 60, 12 * 60, 30, 10), false);
});

test("today recommendation timing rejects starts that cannot fit required baseline minutes", () => {
  assert.equal(isFutureFeasibleToday(23 * 60 + 26, 23 * 60, 36, 10), false);
});

test("today recommendation timing accepts future starts that fit before midnight", () => {
  assert.equal(isFutureFeasibleToday(23 * 60 + 10, 23 * 60, 36, 10), true);
});

test("today duration is capped before midnight but not below required baseline minutes", () => {
  assert.equal(fitDurationBeforeMidnight(75, 23 * 60 + 10, 36), 50);
  assert.equal(fitDurationBeforeMidnight(30, 23 * 60 + 10, 36), 36);
  assert.equal(fitDurationBeforeMidnight(75, 23 * 60 + 30, 36), null);
});

test("minutes until local midnight uses the local clock", () => {
  assert.equal(minutesUntilLocalMidnight(new Date(2026, 6, 2, 23, 30)), 30);
});
