import type { ProjectEvent } from "@/lib/projects";

export type WritingGoals = {
  baselineMinutes: number;
  awesomeMinutes: number;
  stretchMinutes: number;
};

export type EffectiveWritingGoals = WritingGoals & {
  effectiveDate: string;
};

export const DEFAULT_WRITING_GOALS: EffectiveWritingGoals = {
  baselineMinutes: 30,
  awesomeMinutes: 60,
  stretchMinutes: 120,
  effectiveDate: "0000-00-00"
};

export function validateWritingGoals(goals: WritingGoals): string | null {
  if (!Number.isFinite(goals.baselineMinutes) || goals.baselineMinutes < 1) return "Baseline must be at least 1 minute.";
  if (!Number.isFinite(goals.awesomeMinutes) || goals.awesomeMinutes < goals.baselineMinutes + 1) return "Goal must be at least one minute above baseline.";
  if (!Number.isFinite(goals.stretchMinutes) || goals.stretchMinutes < goals.awesomeMinutes + 1) return "Stretch must be at least one minute above goal.";
  return null;
}

function readPositiveInt(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function goalFromEvent(event: ProjectEvent): EffectiveWritingGoals | null {
  if (event.event_type !== "update_writing_goals") return null;
  const payload = event.payload || {};
  const baselineMinutes = readPositiveInt(payload.baseline_minutes);
  const awesomeMinutes = readPositiveInt(payload.awesome_minutes);
  const stretchMinutes = readPositiveInt(payload.stretch_minutes);
  const effectiveDate = typeof payload.effective_date === "string" ? payload.effective_date : "";

  if (!effectiveDate || baselineMinutes == null || awesomeMinutes == null || stretchMinutes == null) return null;
  const goals = { baselineMinutes, awesomeMinutes, stretchMinutes };
  if (validateWritingGoals(goals)) return null;
  return { ...goals, effectiveDate };
}

export function getWritingGoalHistory(events: ProjectEvent[]): EffectiveWritingGoals[] {
  return events
    .map((event, order) => ({ goals: goalFromEvent(event), order, timestamp: event.timestamp || "" }))
    .filter((entry): entry is { goals: EffectiveWritingGoals; order: number; timestamp: string } => Boolean(entry.goals))
    .sort((a, b) => (
      a.goals.effectiveDate.localeCompare(b.goals.effectiveDate)
      || a.timestamp.localeCompare(b.timestamp)
      || a.order - b.order
    ))
    .map((entry) => entry.goals);
}

export function getWritingGoalsForDate(events: ProjectEvent[], dateKey: string): EffectiveWritingGoals {
  let active = DEFAULT_WRITING_GOALS;
  for (const goals of getWritingGoalHistory(events)) {
    if (goals.effectiveDate <= dateKey) active = goals;
  }
  return active;
}
export function createWritingGoalsEvent(goals: WritingGoals, effectiveDate: string, extraPayload: Record<string, unknown> = {}): ProjectEvent {
  const validation = validateWritingGoals(goals);
  if (validation) throw new Error(validation);
  const cryptoObj = globalThis.crypto;
  const random = cryptoObj?.randomUUID ? cryptoObj.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    event_id: random,
    timestamp: new Date().toISOString(),
    event_type: "update_writing_goals",
    project_id: "writing_goals",
    payload: {
      ...extraPayload,
      effective_date: effectiveDate,
      baseline_minutes: goals.baselineMinutes,
      awesome_minutes: goals.awesomeMinutes,
      stretch_minutes: goals.stretchMinutes
    }
  };
}
