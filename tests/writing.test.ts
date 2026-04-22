import test from "node:test";
import assert from "node:assert/strict";

import { aggregateDays, getCalendarRange, parseCsvSessions, splitSessionAcrossDays } from "../lib/writing.ts";

test("parseCsvSessions handles headers, malformed rows, and dedupe", () => {
  const csv = [
    "Note,Clock In,Clock Out",
    "valid,04/01/2026 9:00 AM,04/01/2026 10:00 AM",
    "missing out,04/02/2026 9:00 AM,",
    "duplicate,04/01/2026 9:00 AM,04/01/2026 10:00 AM"
  ].join("\n");

  const sessions = parseCsvSessions(csv);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].start, "2026-04-01T09:00:00.000Z");
  assert.equal(sessions[0].end, "2026-04-01T10:00:00.000Z");
  assert.equal(sessions[0].dateKey, "2026-04-01");
});

test("splitSessionAcrossDays splits midnight crossing sessions", () => {
  const chunks = splitSessionAcrossDays(new Date("2026-04-01T06:30:00.000Z"), new Date("2026-04-01T08:00:00.000Z"));
  assert.deepEqual(chunks, [
    { date: "2026-03-31", minutes: 30 },
    { date: "2026-04-01", minutes: 60 }
  ]);
});

test("getCalendarRange returns contiguous dates", () => {
  const days = getCalendarRange("2026-04-13", 7);
  assert.deepEqual(days, [
    "2026-04-07",
    "2026-04-08",
    "2026-04-09",
    "2026-04-10",
    "2026-04-11",
    "2026-04-12",
    "2026-04-13"
  ]);
});

test("aggregateDays totals minutes without double counting chunks", () => {
  const sessions = [
    { id: "1", start: "2026-04-01T16:00:00.000Z", end: "2026-04-01T16:45:00.000Z", dateKey: "2026-04-01" },
    { id: "2", start: "2026-04-01T17:00:00.000Z", end: "2026-04-01T17:30:00.000Z", dateKey: "2026-04-01" }
  ];
  const byDay = aggregateDays(sessions);
  assert.equal(byDay["2026-04-01"].minutes, 75);
});

test("aggregateDays splits cross-midnight sessions across both days", () => {
  const sessions = [
    { id: "x", start: "2026-02-25T23:42:00.000Z", end: "2026-02-26T00:28:00.000Z", dateKey: "2026-02-25" }
  ];
  const byDay = aggregateDays(sessions);
  assert.equal(byDay["2026-02-25"].minutes, 18);
  assert.equal(byDay["2026-02-26"].minutes, 28);
  assert.equal(byDay["2026-02-25"].sessionSegments[0].note, "(18m counted before midnight)");
  assert.equal(byDay["2026-02-26"].sessionSegments[0].note, "(28m counted after midnight)");
});
