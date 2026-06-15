"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { addDaysToYmd, aggregateDays, getYmdInWritingTz, localTodayYmd, rollingWeekMinutes, zonedLocalToUtc, type WritingSession } from "@/lib/writing";
import { calculateDashboardStats } from "@/lib/stats";
import { computeStreakSummary, type StreakSegment } from "@/lib/streaks";
import { reduceProjectEvents, type ProjectDeadline, type ProjectEvent, type ProjectState } from "@/lib/projects";
import { createWritingGoalsEvent, getWritingGoalsForDate, validateWritingGoals, type WritingGoals } from "@/lib/goals";

type ApiPayload = { sessions: WritingSession[]; source: string; fetchedAt: string; warning?: string };
type ProjectsPayload = { ok: boolean; configured: boolean; state: ProjectState; events?: ProjectEvent[]; warning?: string };

const EMPTY_PROJECT_STATE: ProjectState = { projects: [], milestones: [], activeDeadlines: [], completedMilestones: [], nextDeadline: null };
const PROJECTS_UNAVAILABLE: ProjectsPayload = { ok: false, configured: true, state: EMPTY_PROJECT_STATE, warning: "Project deadlines unavailable" };
type ViewMode = "month" | "year";
type CalendarMode = "grid" | "line";

type LinePoint = {
  tooltipLabel: string;
  date: string;
  minutes: number;
};

const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const minuteWord = (n: number) => (n === 1 ? "minute" : "minutes");
const level = (min: number, goals: WritingGoals) => (!min ? "none" : min < goals.baselineMinutes ? "below" : min < goals.awesomeMinutes ? "baseline" : min < goals.stretchMinutes ? "goal" : "super");
const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);

const monthOrdinal = (s: string, timeZone: string) => {
  if (!s || s === "-") return "-";
  const [y, m, d] = s.split("-").map(Number);
  const anchored = zonedLocalToUtc(y, m, d, 12, 0, 0, timeZone);
  return `${anchored.toLocaleDateString("en-US", { month: "long", timeZone })} ${ordinal(d)}`;
};

function formatYmdLabel(ymd: string, dateFmt: Intl.DateTimeFormat, timeZone: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return dateFmt.format(zonedLocalToUtc(y, m, d, 12, 0, 0, timeZone));
}

function formatCompactRange(startYmd: string, endYmd: string, timeZone: string): string {
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  const start = zonedLocalToUtc(sy, sm, sd, 12, 0, 0, timeZone);
  const end = zonedLocalToUtc(ey, em, ed, 12, 0, 0, timeZone);
  if (sm === em && sy === ey) {
    const month = start.toLocaleDateString("en-US", { month: "short", timeZone });
    return `${month} ${sd}–${ed}`;
  }
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  return `${startLabel}–${endLabel}`;
}


function formatProjectDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

function formatGoalValue(minutes: number): string {
  return fmtMinutes(minutes);
}

function projectDueText(deadline: ProjectDeadline): string {
  if (deadline.daysUntil < 0) return `${Math.abs(deadline.daysUntil)} ${Math.abs(deadline.daysUntil) === 1 ? "day" : "days"} ago`;
  if (deadline.daysUntil === 0) return "due today";
  return `${deadline.daysUntil} ${deadline.daysUntil === 1 ? "day" : "days"} left`;
}

function projectUiUrgency(deadline: ProjectDeadline | null): "overdue" | "today" | "soon" | "approaching" | "future" | null {
  if (!deadline) return null;
  if (deadline.daysUntil < 0) return "overdue";
  if (deadline.daysUntil === 0) return "today";
  if (deadline.daysUntil <= 5) return "soon";
  if (deadline.daysUntil <= 14) return "approaching";
  return "future";
}

function ymdFromUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildMonthMiniCalendar(year: number, month: number): Array<Date | null> {
  const first = new Date(Date.UTC(year, month, 1));
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<Date | null> = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= total; d += 1) cells.push(new Date(Date.UTC(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function startOfDayUtcFromYmd(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isMissedDay(day: string, minutes: number, todayYmd: string): boolean {
  return minutes === 0 && startOfDayUtcFromYmd(day) < startOfDayUtcFromYmd(todayYmd);
}

function buildMonthLineData(monthDays: Array<Date | null>, byDay: Record<string, { minutes: number }>, dateFmt: Intl.DateTimeFormat, timeZone: string): LinePoint[] {
  return monthDays
    .filter(Boolean)
    .map((d) => {
      const day = d as Date;
      const key = getYmdInWritingTz(day, timeZone);
      const rolling7 = Array.from({ length: 7 }, (_, i) => byDay[addDaysToYmd(key, -i)]?.minutes || 0).reduce((sum, v) => sum + v, 0);
      return {
        tooltipLabel: formatYmdLabel(key, dateFmt, timeZone),
        date: key,
        minutes: rolling7
      };
    });
}

function fmtDateRange(seg: StreakSegment | null): string {
  if (!seg) return "-";
  const start = new Date(`${seg.start}T12:00:00Z`);
  const end = new Date(`${seg.end}T12:00:00Z`);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${startLabel} – ${endLabel}`;
}

function buildYearLineData(year: number, byDay: Record<string, { minutes: number }>, timeZone: string): LinePoint[] {
  const rows: LinePoint[] = [];
  let cursor = `${year}-01-01`;
  const end = `${year}-12-31`;

  while (cursor <= end) {
    const weekStartYmd = cursor;
    let weekMinutes = 0;

    for (let i = 0; i < 7 && cursor <= end; i += 1) {
      weekMinutes += byDay[cursor]?.minutes || 0;
      cursor = addDaysToYmd(cursor, 1);
    }

    const [sy, sm, sd] = weekStartYmd.split("-").map(Number);
    const weekStart = zonedLocalToUtc(sy, sm, sd, 12, 0, 0, timeZone);
    const weekEndYmd = addDaysToYmd(cursor, -1);
    const [ey, em, ed] = weekEndYmd.split("-").map(Number);
    const weekEnd = zonedLocalToUtc(ey, em, ed, 12, 0, 0, timeZone);
    const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })}–${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })}`;

    rows.push({
      tooltipLabel: `${weekLabel} (${year})`,
      date: weekStartYmd,
      minutes: weekMinutes
    });
  }

  return rows;
}

export default function Dashboard() {
  const canonicalTimeZone = "UTC";
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: canonicalTimeZone, hour: "numeric", minute: "2-digit" }),
    [canonicalTimeZone]
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: canonicalTimeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    [canonicalTimeZone]
  );
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [projectsPayload, setProjectsPayload] = useState<ProjectsPayload | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("grid");
  const [displayDate, setDisplayDate] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });
  const rememberedMonthsRef = useRef<Record<number, number>>({ [displayDate.getUTCFullYear()]: displayDate.getUTCMonth() });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  const [hourHover, setHourHover] = useState<{ hour: number; x: number; y: number } | null>(null);
  const [lineHover, setLineHover] = useState<{ item: LinePoint; x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState<null | "trend" | "motivation" | "streak">(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);
  const [todayKey, setTodayKey] = useState(() => localTodayYmd(new Date()));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalForm, setGoalForm] = useState<WritingGoals>({ baselineMinutes: 30, awesomeMinutes: 60, stretchMinutes: 120 });
  const [goalMessage, setGoalMessage] = useState<string | null>(null);
  const [savingGoals, setSavingGoals] = useState(false);
  const settingsPanelRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    fetch("/api/sessions", { cache: "no-store" }).then((r) => r.json()).then(setPayload).catch(() => setPayload({ sessions: [], source: "fallback", fetchedAt: new Date().toISOString() }));
    fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()).then((data) => setProjectsPayload(data?.state ? data : PROJECTS_UNAVAILABLE)).catch(() => setProjectsPayload(PROJECTS_UNAVAILABLE));
  }, []);

  useEffect(() => {
    const refreshToday = () => setTodayKey(localTodayYmd(new Date()));
    refreshToday();
    const interval = window.setInterval(refreshToday, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedDay(null);
        setExpanded(null);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("wj-theme");
    const initial = saved === "dark" || saved === "light" ? saved : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("wj-theme", theme);
  }, [theme, themeReady]);

  useEffect(() => {
    if (!selectedDay && !expanded) return;
    if (!window.matchMedia("(max-width: 600px)").matches) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflowY: body.style.overflowY,
      paddingRight: body.style.paddingRight
    };
    const scrollbarComp = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflowY = "hidden";
    if (scrollbarComp > 0) body.style.paddingRight = `${scrollbarComp}px`;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflowY = prev.overflowY;
      body.style.paddingRight = prev.paddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [selectedDay, expanded]);

  const byDay = useMemo(() => aggregateDays(payload?.sessions || [], canonicalTimeZone), [payload, canonicalTimeZone]);

  const displayYear = displayDate.getUTCFullYear();
  const displayMonth = displayDate.getUTCMonth();

  useEffect(() => {
    if (viewMode === "month") rememberedMonthsRef.current[displayYear] = displayMonth;
  }, [viewMode, displayYear, displayMonth]);

  const monthDateForYear = (year: number) => new Date(Date.UTC(year, rememberedMonthsRef.current[year] ?? 0, 1));

  const toggleViewMode = () => {
    if (viewMode === "month") {
      rememberedMonthsRef.current[displayYear] = displayMonth;
      setViewMode("year");
    } else {
      setDisplayDate(monthDateForYear(displayYear));
      setViewMode("month");
    }
  };

  const monthDays = useMemo(() => {
    const y = displayYear;
    const m = displayMonth;
    const first = new Date(Date.UTC(y, m, 1));
    const cells: Array<Date | null> = Array.from({ length: first.getUTCDay() }, () => null);
    const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= total; d += 1) cells.push(new Date(Date.UTC(y, m, d)));
    return cells;
  }, [displayYear, displayMonth]);

  const months = useMemo(() => {
    const y = displayYear;
    return Array.from({ length: 12 }, (_, m) => ({
      month: m,
      name: new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" }),
      cells: buildMonthMiniCalendar(y, m)
    }));
  }, [displayYear]);

  const stats = useMemo(() => calculateDashboardStats(payload?.sessions || [], new Date(), canonicalTimeZone), [payload, canonicalTimeZone]);
  const projectEvents = projectsPayload?.events || [];
  const localProjectState = useMemo(() => reduceProjectEvents(projectEvents, todayKey), [projectEvents, todayKey]);
  const goalsForDay = (day: string) => getWritingGoalsForDate(projectEvents, day);
  const todayGoals = getWritingGoalsForDate(projectEvents, todayKey);
  const streaks = useMemo(() => computeStreakSummary(byDay, todayKey, (day) => getWritingGoalsForDate(projectEvents, day).baselineMinutes), [byDay, todayKey, projectEvents]);
  const projectDeadlines = localProjectState.activeDeadlines;
  const completedProjectDeadlines = localProjectState.completedMilestones;
  const projectDeadlinesByDay = useMemo(() => {
    const grouped: Record<string, ProjectDeadline[]> = {};
    for (const deadline of [...projectDeadlines, ...completedProjectDeadlines]) {
      const key = deadline.milestone.deadline_date;
      grouped[key] = [...(grouped[key] || []), deadline];
    }
    return grouped;
  }, [projectDeadlines, completedProjectDeadlines]);
  const projectBarDeadline = localProjectState.nextDeadline;
  const projectsUnavailable = projectsPayload !== null && !projectsPayload.ok && Boolean(projectsPayload.warning);
  const projectBarClass = projectsUnavailable ? "unavailable" : projectUiUrgency(projectBarDeadline) || (projectsPayload === null ? "loading" : "empty");
  useEffect(() => {
    setGoalForm({ baselineMinutes: todayGoals.baselineMinutes, awesomeMinutes: todayGoals.awesomeMinutes, stretchMinutes: todayGoals.stretchMinutes });
  }, [todayGoals.baselineMinutes, todayGoals.awesomeMinutes, todayGoals.stretchMinutes, todayKey]);

  useEffect(() => {
    if (!settingsOpen) return;
    window.setTimeout(() => settingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }, [settingsOpen]);


  function dueFlagState(deadlines: ProjectDeadline[]) {
    if (deadlines.some((item) => item.milestone.status === "active" && item.urgency === "overdue")) return "overdue";
    if (deadlines.some((item) => item.milestone.status === "completed")) return "completed";
    if (deadlines.some((item) => item.milestone.status === "active" && item.urgency === "today")) return "today";
    return deadlines.length ? "future" : "";
  }

  async function saveGoals(event: FormEvent) {
    event.preventDefault();
    setGoalMessage(null);
    const validation = validateWritingGoals(goalForm);
    if (validation) {
      setGoalMessage(validation);
      return;
    }

    const goalEffectiveDate = addDaysToYmd(todayKey, 1);
    const goalEvents = [createWritingGoalsEvent(goalForm, goalEffectiveDate)];

    setSavingGoals(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: goalEvents })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.warning || "Unable to save writing goals.");
      setProjectsPayload((current) => current ? { ...current, events: [...(current.events || []), ...goalEvents] } : current);
      setGoalMessage("Saved. New goals start tomorrow.");
      setSettingsOpen(false);
    } catch {
      setGoalMessage("Writing goals could not be saved right now.");
    } finally {
      setSavingGoals(false);
    }
  }

  const weekdayBars = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const rows = names.map((name) => ({ name, total: 0, count: 0, avg: 0 }));
    const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: canonicalTimeZone, weekday: "short" });
    for (const [d, b] of Object.entries(byDay)) {
      const idx = formatYmdLabel(d, weekdayFmt, canonicalTimeZone);
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const rowIdx = map[idx] ?? 0;
      rows[rowIdx].total += b.minutes;
      rows[rowIdx].count += 1;
    }
    rows.forEach((r) => (r.avg = r.count ? Math.round(r.total / r.count) : 0));
    return rows;
  }, [byDay, canonicalTimeZone]);

  const hourly = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, h) => ({ hour: h, days: new Set<string>(), totalMinutes: 0, avgMinutes: 0, daysCount: 0 }));
    for (const s of payload?.sessions || []) {
      const st = new Date(s.start).getTime();
      const et = new Date(s.end).getTime();
      let cursorMs = st;
      while (cursorMs < et) {
        const cursor = new Date(cursorMs);
        const h = cursor.getUTCHours();
        const dayKey = s.dateKey || ymdFromUtcDate(cursor);
        const nextHourMs = Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          cursor.getUTCHours() + 1,
          0,
          0
        );
        const chunkEndMs = Math.min(et, nextHourMs);
        bins[h].days.add(dayKey);
        bins[h].totalMinutes += Math.max(1, Math.round((chunkEndMs - cursorMs) / 60000));
        cursorMs = chunkEndMs;
      }
    }
    bins.forEach((b) => {
      b.daysCount = b.days.size;
      b.avgMinutes = b.daysCount ? Math.round(b.totalMinutes / b.daysCount) : 0;
    });
    return bins;
  }, [payload, canonicalTimeZone]);

  const lineData = useMemo(() => {
    if (viewMode === "month") return buildMonthLineData(monthDays, byDay, dateFmt, canonicalTimeZone);
    return buildYearLineData(displayYear, byDay, canonicalTimeZone);
  }, [viewMode, monthDays, byDay, displayYear, dateFmt, canonicalTimeZone]);
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const isViewingCurrentMonth = displayYear === todayYear && displayMonth === todayMonth - 1;

  const moveBack = () => viewMode === "year" ? setDisplayDate(monthDateForYear(displayYear - 1)) : setDisplayDate(new Date(Date.UTC(displayYear, displayMonth - 1, 1)));
  const moveNext = () => viewMode === "year" ? setDisplayDate(monthDateForYear(displayYear + 1)) : setDisplayDate(new Date(Date.UTC(displayYear, displayMonth + 1, 1)));

  const selected = selectedDay ? byDay[selectedDay] : null;
  const selectedGoals = selectedDay ? goalsForDay(selectedDay) : null;
  const hovered = hover?.day ? byDay[hover.day] : null;
  const maxHour = Math.max(1, ...hourly.map((h) => h.daysCount));
  const maxLine = Math.max(1, ...lineData.map((d) => d.minutes));
  const trendMinutes = Math.abs(stats.trend.diff);
  const trendDirection = stats.trend.diff >= 0 ? "more" : "less";
  const comparedCurrent = formatCompactRange(stats.trend.currentPeriod[0], stats.trend.currentPeriod.at(-1) || stats.trend.currentPeriod[0], canonicalTimeZone);
  const comparedPrevious = formatCompactRange(stats.trend.previousPeriod[0], stats.trend.previousPeriod.at(-1) || stats.trend.previousPeriod[0], canonicalTimeZone);
  const motivationStart = timeFmt.format(new Date(Date.UTC(2026, 0, 1, Math.floor(stats.motivation.suggestedStartMinutes / 60), stats.motivation.suggestedStartMinutes % 60)));
  const motivationWindow = stats.motivation.chosenCluster ? `${timeFmt.format(new Date(Date.UTC(2026, 0, 1, Math.floor(stats.motivation.chosenCluster.bucketStart / 60), stats.motivation.chosenCluster.bucketStart % 60)))}–${timeFmt.format(new Date(Date.UTC(2026, 0, 1, Math.floor(stats.motivation.chosenCluster.bucketEnd / 60), stats.motivation.chosenCluster.bucketEnd % 60)))}` : null;
  const hourTooltipPoint = (event: MouseEvent<HTMLElement>) => ({
    x: Math.min(event.clientX + 12, window.innerWidth - 190),
    y: Math.min(event.clientY + 12, window.innerHeight - 96)
  });

  return (
    <main className="journalShell">
      <header className="hero"><h1>Writing Journal</h1><a className={`projectBar ${projectBarClass}`} href="/projects">{projectsPayload === null ? "Loading project deadline…" : projectsUnavailable ? "Project deadlines unavailable" : projectBarDeadline ? <><span className="projectBarName">{projectBarDeadline.milestone.milestone_name}</span><span className="projectBarSep">—</span><strong>{projectDueText(projectBarDeadline)}</strong><span className="projectBarDate">· {formatProjectDate(projectBarDeadline.milestone.deadline_date)}</span></> : "No active project deadline"}</a><div className="heroActions"><button className="themeToggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle theme">{theme === "light" ? "☀️" : "🌙"}</button><button className="streakBadge" onClick={() => setExpanded("streak")} title="View streak details"><span className={streaks.todayQualified ? "flame active" : "flame"}>🔥</span><strong className="streakCount">{payload === null ? "…" : (streaks.current?.days ?? 0)}</strong></button></div></header>

      {payload === null ? (
        <div className="dashboardSkeleton" aria-live="polite" aria-busy="true">
          <section className="panel calendarPanel skeletonPanel">
            <div className="toolbar">
              <div className="skeletonLine skeletonTitle" />
              <div className="modeSwitch"><span className="skeletonButton" /><span className="skeletonButton" /></div>
            </div>
            <div className="monthGrid skeletonGrid">{Array.from({ length: 35 }, (_, i) => <span key={i} className="day skeletonCell" />)}</div>
          </section>
          <section className="stats">{Array.from({ length: 5 }, (_, i) => <article key={i} className="panel skeletonStat"><span className="skeletonLine skeletonLabel" /><span className="skeletonLine skeletonValue" /></article>)}</section>
          <section className="stats secondaryStats">{Array.from({ length: 2 }, (_, i) => <article key={i} className="panel skeletonStat"><span className="skeletonLine skeletonLabel" /><span className="skeletonLine skeletonText" /><span className="skeletonLine skeletonText short" /></article>)}</section>
          <section className="panel chartPanel skeletonPanel"><span className="skeletonLine skeletonTitle" /><div className="skeletonChart" /></section>
        </div>
      ) : (
        <div className="dashboardContent isLoaded">
      <section className="panel calendarPanel">
        <div className="toolbar">
          <div className="navBlock"><button onClick={moveBack}>←</button><strong>{viewMode === "year" ? displayYear : displayDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><button onClick={moveNext}>→</button></div>
          <div className="modeSwitch">
            <button className="active" onClick={toggleViewMode}>{viewMode === "month" ? "Month View" : "Year View"}</button>
            <button className="active" onClick={() => setCalendarMode(calendarMode === "grid" ? "line" : "grid")}>{calendarMode === "grid" ? "Grid" : "Line"}</button>
          </div>
        </div>

        {calendarMode === "grid" && viewMode === "month" ? (
          <div className="monthGrid">
            {monthDays.map((d, i) => {
              if (!d) return <div key={i} className="day empty" />;
              const key = getYmdInWritingTz(d, canonicalTimeZone);
              const min = byDay[key]?.minutes || 0;
              const missed = isMissedDay(key, min, todayKey);
              const due = projectDeadlinesByDay[key] || [];
              const dueUrgency = dueFlagState(due);
              return <button key={key} className={`day ${level(min, goalsForDay(key))} ${missed ? "zeroPast" : ""} ${key === todayKey ? "today" : ""} ${due.length ? `hasDue due-${dueUrgency}` : ""}`} onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} onClick={() => setSelectedDay(key)}>{d.getUTCDate()}{due.length ? <span className="dueMarker">{due.length > 1 ? due.length : ""}</span> : null}</button>;
            })}
          </div>
        ) : calendarMode === "grid" ? (
          <div className="yearWrap">
            {months.map((m) => <div key={m.name} className="monthBlock"><button className="monthJump" onClick={() => { rememberedMonthsRef.current[displayYear] = m.month; setDisplayDate(new Date(Date.UTC(displayYear, m.month, 1))); setViewMode("month"); }}>{m.name}</button><div className="monthMiniGrid">{m.cells.map((d, idx) => { if (!d) return <div key={`${m.name}-blank-${idx}`} className="mini ghEmpty" />; const key = ymdFromUtcDate(d); const min = byDay[key]?.minutes || 0; const missed = isMissedDay(key, min, todayKey); const due = projectDeadlinesByDay[key] || []; const dueUrgency = dueFlagState(due); return <button key={key} className={`mini ${level(min, goalsForDay(key))} ${missed ? "zeroPast" : ""} ${key === todayKey ? "today" : ""} ${due.length ? `hasDue due-${dueUrgency}` : ""}`} onClick={() => setSelectedDay(key)} onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}>{due.length ? <span className="dueMarker">{due.length > 1 ? due.length : ""}</span> : null}</button>; })}</div></div>)}
          </div>
        ) : (
          <div className="lineWrap">
            <svg viewBox="0 0 100 42" className="lineChartAlt">
              <line x1="7" y1="2" x2="7" y2="38" stroke="#a9b8ad" strokeWidth="0.4" />
              <line x1="7" y1="38" x2="98" y2="38" stroke="#a9b8ad" strokeWidth="0.4" />
              <polygon fill="rgba(47,127,97,0.10)" points={`${lineData.map((p, i) => `${7 + (i / Math.max(1, lineData.length - 1)) * 91},${38 - (p.minutes / maxLine) * 32}`).join(" ")} 98,38 7,38`} />
              <polyline fill="none" stroke="#2f7f61" strokeWidth={viewMode === "year" ? "1" : "1.4"} points={lineData.map((p, i) => `${7 + (i / Math.max(1, lineData.length - 1)) * 91},${38 - (p.minutes / maxLine) * 32}`).join(" ")} />
              {viewMode === "month" && lineData.map((p, i) => {
                const isTodayPoint = isViewingCurrentMonth && p.date === todayKey;
                return <circle key={`${p.date}-${i}`} cx={7 + (i / Math.max(1, lineData.length - 1)) * 91} cy={38 - (p.minutes / maxLine) * 32} r={isTodayPoint ? "1.9" : "1"} fill={isTodayPoint ? "#e47a1f" : "#2f7f61"} stroke={isTodayPoint ? "#f8f3eb" : "none"} strokeWidth={isTodayPoint ? "0.5" : "0"} onMouseEnter={(e) => setLineHover({ item: p, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setLineHover({ item: p, x: e.clientX, y: e.clientY })} onMouseLeave={() => setLineHover(null)} />;
              })}
              {viewMode === "year" && lineData.map((p, i) => <rect key={`${p.date}-${i}`} x={7 + (i / Math.max(1, lineData.length - 1)) * 91 - 0.5} y={0} width={1} height={42} fill="transparent" onMouseEnter={(e) => setLineHover({ item: p, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setLineHover({ item: p, x: e.clientX, y: e.clientY })} onMouseLeave={() => setLineHover(null)} />)}
            </svg>
            <p className="axisLabel">{viewMode === "month" ? "Rolling 7-day writing total (month view)" : "Weekly writing totals this year"}</p>
          </div>
        )}

        {hover && <div className="hoverTip" style={{ left: hover.x + 12, top: hover.y + 12 }}><strong>{formatYmdLabel(hover.day, dateFmt, canonicalTimeZone)}</strong><span>{fmtMinutes(hovered?.minutes || 0)} written</span>{(projectDeadlinesByDay[hover.day] || []).map((deadline) => <span key={deadline.milestone.milestone_id}>Due: {deadline.milestone.milestone_name}</span>)}</div>}
        {lineHover && <div className="hoverTip" style={{ left: lineHover.x + 12, top: lineHover.y + 12 }}><strong>{lineHover.item.tooltipLabel}</strong><span>{fmtMinutes(lineHover.item.minutes)} written</span></div>}
      </section>

      <section className="stats">
        <article className="panel"><h3>Daily Average</h3><p>{fmtMinutes(stats.dailyAverage)}</p></article>
        <article className="panel"><h3>Monthly Total</h3><p>{fmtMinutes(stats.monthlyTotal)}</p></article>
        <article className="panel"><h3>Yearly Total</h3><p>{fmtMinutes(stats.yearlyTotal)}</p></article>
        <article className="panel"><h3>Best Day This Month</h3><p className="statInline"><span>{monthOrdinal(stats.bestDayThisMonth.date, canonicalTimeZone)}</span><small>{fmtMinutes(stats.bestDayThisMonth.minutes)}</small></p></article>
        <article className="panel"><h3>Best Day This Year</h3><p className="statInline"><span>{monthOrdinal(stats.bestDayThisYear.date, canonicalTimeZone)}</span><small>{fmtMinutes(stats.bestDayThisYear.minutes)}</small></p></article>
      </section>

      <section className="stats secondaryStats"><article className="panel clickableCard" onClick={() => setExpanded("trend")}><h3>Trend</h3><p>You’re writing <strong>{trendMinutes} {minuteWord(trendMinutes)} {trendDirection}</strong> per day compared to the prior week{stats.trend.dailyPrev ? ` (${Math.abs(stats.trend.pct)}% ${trendDirection})` : ""}.</p></article><article className="panel clickableCard" onClick={() => setExpanded("motivation")}><h3>Motivation</h3><p>Write <strong>{stats.motivation.target === "today" ? "today" : "tomorrow"}</strong> at <strong>{motivationStart}</strong> for <strong>{stats.motivation.suggestedDurationMinutes} minutes</strong>.<br />{stats.motivation.encouragement}</p></article></section>

      <section className="panel chartPanel">
        <h3>Typical writing time by day</h3>
        <div className="hBars">{weekdayBars.map((d) => { const max = Math.max(1, ...weekdayBars.map((x) => x.avg)); return <div key={d.name} className="hBarRow"><span>{d.name}</span><div className="hBarTrack"><div className="hBarFill" style={{ width: `${(d.avg / max) * 100}%` }} /></div><strong>{fmtMinutes(d.avg)}</strong></div>; })}</div>
        <h3>Writing activity across the day</h3>
        <div className="hourHist">{hourly.map((h) => <button type="button" key={h.hour} className={`hourCol ${hourHover?.hour === h.hour ? "isHovered" : ""}`} aria-label={`${String(h.hour).padStart(2, "0")}:00 writing activity`} onMouseEnter={(e) => setHourHover({ hour: h.hour, ...hourTooltipPoint(e) })} onMouseMove={(e) => setHourHover({ hour: h.hour, ...hourTooltipPoint(e) })} onMouseLeave={() => setHourHover(null)} onClick={(e) => { const point = hourTooltipPoint(e); setHourHover((current) => current?.hour === h.hour ? null : { hour: h.hour, ...point }); }}><div className="hourBar" style={{ height: `${Math.max(8, (h.daysCount / maxHour) * 100)}%` }} /></button>)}</div>
        <div className="hourTicks">{Array.from({ length: 24 }, (_, i) => <span key={i} className={i % 3 === 0 ? "major" : "minor"}>{String(i).padStart(2, "0")}</span>)}</div>
        {hourHover && <div className="hourTooltip" style={{ left: hourHover.x, top: hourHover.y }}><strong>{String(hourHover.hour).padStart(2, "0")}:00</strong><span>Written on {hourly[hourHover.hour].daysCount} days</span><span>Average: {hourly[hourHover.hour].avgMinutes} minutes</span></div>}
      </section>



      <section className="settingsFooter">
        <button className="settingsToggle" onClick={() => setSettingsOpen((open) => !open)}>{settingsOpen ? "Close settings" : "Settings"}</button>
        {settingsOpen && <form ref={settingsPanelRef} className="panel goalSettingsPanel" onSubmit={saveGoals}>
          <div>
            <p className="eyebrow">Writing goals</p>
            <h3>Current thresholds</h3>
            <p>New goals start tomorrow. Earlier days keep the thresholds that were active then.</p>
          </div>
          <div className="goalInputs">
            <label>Baseline minutes<input type="number" min="1" value={goalForm.baselineMinutes} onChange={(e) => setGoalForm({ ...goalForm, baselineMinutes: Number(e.target.value) })} /></label>
            <label>Goal minutes<input type="number" min={goalForm.baselineMinutes + 1} value={goalForm.awesomeMinutes} onChange={(e) => setGoalForm({ ...goalForm, awesomeMinutes: Number(e.target.value) })} /></label>
            <label>Stretch minutes<input type="number" min={goalForm.awesomeMinutes + 1} value={goalForm.stretchMinutes} onChange={(e) => setGoalForm({ ...goalForm, stretchMinutes: Number(e.target.value) })} /></label>
          </div>
          {goalMessage ? <p className="settingsMessage">{goalMessage}</p> : null}
          <button className="settingsSave" disabled={savingGoals}>{savingGoals ? "Saving…" : "Save goals"}</button>
        </form>}
      </section>

      {selected && selectedGoals && calendarMode === "grid" && <div className="modal" onClick={() => setSelectedDay(null)}><div className="modalCard dayDetailCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setSelectedDay(null)}>×</button><h3>{formatYmdLabel(selected.date, dateFmt, canonicalTimeZone)}</h3><div className="dayDetailStats"><p><span>Total writing</span><strong>{fmtMinutes(selected.minutes)}</strong></p><p><span>Last 7 days</span><strong>{fmtMinutes(rollingWeekMinutes(selected.date, byDay))}</strong></p></div>{(projectDeadlinesByDay[selected.date] || []).length ? <div className="dayDeadlineList"><strong>Deadlines</strong><ul>{projectDeadlinesByDay[selected.date].map((deadline) => <li key={deadline.milestone.milestone_id}>Due: {deadline.milestone.milestone_name}{deadline.project.project_name ? ` — ${deadline.project.project_name}` : ""}</li>)}</ul></div> : null}<div className="dayGoalBox"><strong>Goals for this day</strong><div><span>Baseline: {formatGoalValue(selectedGoals.baselineMinutes)}</span><span>Goal: {formatGoalValue(selectedGoals.awesomeMinutes)}</span><span>Stretch: {formatGoalValue(selectedGoals.stretchMinutes)}</span></div></div><div className="daySessions"><strong>Writing sessions</strong><ul>{(selected.sessionSegments?.length ? selected.sessionSegments : selected.sessions.map((session) => ({ session, note: "" }))).map((entry, idx) => <li key={`${entry.session.id}-${idx}`}>{timeFmt.format(new Date(entry.session.start))} – {timeFmt.format(new Date(entry.session.end))}{entry.note ? ` ${entry.note}` : ""}</li>)}</ul></div></div></div>}

      {expanded === "trend" && <div className="modal" onClick={() => setExpanded(null)}><div className="modalCard detailCard trendDetailCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setExpanded(null)}>×</button><h3>Trend details</h3><p><strong>Current pace:</strong> {stats.trend.dailyNow} {minuteWord(stats.trend.dailyNow)}/day</p><p><strong>Previous pace:</strong> {stats.trend.dailyPrev} {minuteWord(stats.trend.dailyPrev)}/day</p><p><strong>Change:</strong> {trendMinutes} {minuteWord(trendMinutes)} {trendDirection} per day</p><p><strong>Compared:</strong> {comparedCurrent} vs. {comparedPrevious}</p></div></div>}

      {expanded === "motivation" && <div className="modal" onClick={() => setExpanded(null)}><div className="modalCard detailCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setExpanded(null)}>×</button><h3>Motivation details</h3><p><strong>Recommended:</strong> {stats.motivation.target === "today" ? "Today" : "Tomorrow"} at {motivationStart}</p><p><strong>Goal:</strong> {stats.motivation.suggestedDurationMinutes} minutes</p><p><strong>Why:</strong> {motivationWindow ? `Your strongest ${stats.motivation.weekday} window is ${motivationWindow}.` : stats.motivation.detail}</p><p><strong>Based on:</strong> {stats.motivation.chosenCluster?.sessionCount ?? 0} sessions averaging {fmtMinutes(stats.motivation.chosenCluster?.averageDurationMinutes ?? stats.motivation.suggestedDurationMinutes)}.</p></div></div>}
      {expanded === "streak" && <div className="modal" onClick={() => setExpanded(null)}><div className="modalCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setExpanded(null)}>×</button><h3>Streak details</h3><section className="stats streakGrid"><article className="panel streakCard"><h3>Current streak</h3><p>{streaks.current?.days ?? 0} days</p><small>{fmtDateRange(streaks.current)}</small></article><article className="panel streakCard"><h3>Current score</h3><p>{fmtMinutes(streaks.current?.scoreMinutes ?? 0)}</p><small>Daily avg. {fmtMinutes(streaks.current ? Math.round(streaks.current.scoreMinutes / Math.max(1, streaks.current.days)) : 0)}</small></article><article className="panel streakCard"><h3>Longest streak (year)</h3><p>{streaks.longestYear?.days ?? 0} days</p><small>{fmtDateRange(streaks.longestYear)}</small></article><article className="panel streakCard"><h3>Best score (year)</h3><p>{fmtMinutes(streaks.bestScoreYear?.scoreMinutes ?? 0)}</p><small>{fmtDateRange(streaks.bestScoreYear)}</small></article><article className="panel streakCard"><h3>Longest streak (all time)</h3><p>{streaks.longestAllTime?.days ?? 0} days</p><small>{fmtDateRange(streaks.longestAllTime)}</small></article><article className="panel streakCard"><h3>Best score (all time)</h3><p>{fmtMinutes(streaks.bestScoreAllTime?.scoreMinutes ?? 0)}</p><small>{fmtDateRange(streaks.bestScoreAllTime)}</small></article></section></div></div>}
        </div>
      )}
    </main>
  );
}
