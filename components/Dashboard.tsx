"use client";

import { useEffect, useMemo, useState } from "react";
import { aggregateDays, getHourInWritingTz, getYmdInWritingTz, rollingWeekMinutes, WRITING_TZ, zonedLocalToUtc, type WritingSession } from "@/lib/writing";
import { calculateDashboardStats } from "@/lib/stats";

type ApiPayload = { sessions: WritingSession[]; source: string; fetchedAt: string; warning?: string };
type ViewMode = "month" | "year";
type CalendarMode = "grid" | "line";

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const level = (min: number) => (!min ? "none" : min < 30 ? "below" : min < 60 ? "baseline" : min < 120 ? "goal" : "super");
const ymd = (d: Date) => getYmdInWritingTz(d);
const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);
const monthOrdinal = (s: string) => {
  if (!s || s === "-") return "-";
  const d = new Date(`${s}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { month: "long" })} ${ordinal(d.getUTCDate())}`;
};

export default function Dashboard() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("grid");
  const [displayDate, setDisplayDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  const [hourHover, setHourHover] = useState<{ hour: number; x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState<null | "trend" | "motivation">(null);

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then(setPayload).catch(() => setPayload({ sessions: [], source: "fallback", fetchedAt: new Date().toISOString() }));
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

  const byDay = useMemo(() => aggregateDays(payload?.sessions || []), [payload]);

  const monthDays = useMemo(() => {
    const y = displayDate.getFullYear();
    const m = displayDate.getMonth();
    const first = new Date(y, m, 1);
    const cells: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
    const total = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= total; d += 1) cells.push(new Date(y, m, d));
    return cells;
  }, [displayDate]);

  const months = useMemo(() => {
    const y = displayDate.getFullYear();
    return Array.from({ length: 12 }, (_, m) => ({ month: m, name: new Date(y, m, 1).toLocaleDateString(undefined, { month: "long" }), days: Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => new Date(y, m, i + 1)) }));
  }, [displayDate]);

  const stats = useMemo(() => calculateDashboardStats(payload?.sessions || []), [payload]);

  const weekdayBars = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const rows = names.map((name) => ({ name, total: 0, count: 0, avg: 0 }));
    for (const [d, b] of Object.entries(byDay)) {
      const idx = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: WRITING_TZ, weekday: "short" });
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const rowIdx = map[idx] ?? 0;
      rows[rowIdx].total += b.minutes;
      rows[rowIdx].count += 1;
    }
    rows.forEach((r) => (r.avg = r.count ? Math.round(r.total / r.count) : 0));
    return rows;
  }, [byDay]);

  const hourly = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, h) => ({ hour: h, days: new Set<string>(), totalMinutes: 0, avgMinutes: 0, daysCount: 0 }));
    for (const s of payload?.sessions || []) {
      const st = new Date(s.start);
      const et = new Date(s.end);
      let cursor = new Date(st);
      while (cursor < et) {
        const h = getHourInWritingTz(cursor);
        const dayKey = getYmdInWritingTz(cursor);
        const [yy, mm, dd] = dayKey.split("-").map(Number);
        const nextHourUtc = zonedLocalToUtc(yy, mm, dd, h + 1, 0, 0);
        const end = nextHourUtc < et ? nextHourUtc : et;
        bins[h].days.add(dayKey);
        bins[h].totalMinutes += Math.max(1, Math.round((end.getTime() - cursor.getTime()) / 60000));
        cursor = end;
      }
    }
    bins.forEach((b) => {
      b.daysCount = b.days.size;
      b.avgMinutes = b.daysCount ? Math.round(b.totalMinutes / b.daysCount) : 0;
    });
    return bins;
  }, [payload]);

  const lineData = useMemo(() => {
    if (viewMode === "month") return monthDays.filter(Boolean).map((d) => ({ label: String((d as Date).getDate()), date: ymd(d as Date), minutes: byDay[ymd(d as Date)]?.minutes || 0 }));
    const start = new Date(displayDate.getFullYear(), 0, 1);
    const end = new Date(displayDate.getFullYear(), 11, 31);
    const rows: Array<{ label: string; date: string; minutes: number }> = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = ymd(d);
      rows.push({ label: key, date: key, minutes: byDay[key]?.minutes || 0 });
    }
    return rows;
  }, [viewMode, monthDays, byDay, displayDate]);

  const moveBack = () => viewMode === "year" ? setDisplayDate(new Date(displayDate.getFullYear() - 1, 0, 1)) : setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1));
  const moveNext = () => viewMode === "year" ? setDisplayDate(new Date(displayDate.getFullYear() + 1, 0, 1)) : setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1));

  const selected = selectedDay ? byDay[selectedDay] : null;
  const hovered = hover?.day ? byDay[hover.day] : null;
  const maxHour = Math.max(1, ...hourly.map((h) => h.daysCount));
  const maxLine = Math.max(1, ...lineData.map((d) => d.minutes));

  return (
    <main className="journalShell">
      <header className="hero"><h1>Writing Journal</h1><p>Calm insights for consistent creative practice.</p></header>

      <section className="panel calendarPanel">
        <div className="toolbar">
          <div className="navBlock"><button onClick={moveBack}>←</button><strong>{viewMode === "year" ? displayDate.getFullYear() : displayDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button onClick={moveNext}>→</button></div>
          <div className="modeSwitch">
            <button className="active" onClick={() => setViewMode(viewMode === "month" ? "year" : "month")}>{viewMode === "month" ? "Month View" : "Year View"}</button>
            <button className="active" onClick={() => setCalendarMode(calendarMode === "grid" ? "line" : "grid")}>{calendarMode === "grid" ? "Grid" : "Line"}</button>
          </div>
        </div>

        {calendarMode === "grid" && viewMode === "month" ? (
          <div className="monthGrid">
            {monthDays.map((d, i) => {
              if (!d) return <div key={i} className="day empty" />;
              const key = ymd(d);
              const min = byDay[key]?.minutes || 0;
              return <button key={key} className={`day ${level(min)} ${min === 0 && new Date(key) < new Date() ? "zeroPast" : ""}`} onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} onClick={() => setSelectedDay(key)}>{d.getDate()}</button>;
            })}
          </div>
        ) : calendarMode === "grid" ? (
          <div className="yearWrap">
            {months.map((m) => <div key={m.name} className="monthBlock"><button className="monthJump" onClick={() => { setDisplayDate(new Date(displayDate.getFullYear(), m.month, 1)); setViewMode("month"); }}>{m.name}</button><div className="monthMiniGrid">{m.days.map((d) => { const key = ymd(d); const min = byDay[key]?.minutes || 0; return <button key={key} className={`mini ${level(min)} ${min === 0 && new Date(key) < new Date() ? "zeroPast" : ""}`} onClick={() => setSelectedDay(key)} onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} />; })}</div></div>)}
          </div>
        ) : (
          <div className="lineWrap">
            <svg viewBox="0 0 100 42" className="lineChartAlt">
              <line x1="7" y1="2" x2="7" y2="38" stroke="#a9b8ad" strokeWidth="0.4" />
              <line x1="7" y1="38" x2="98" y2="38" stroke="#a9b8ad" strokeWidth="0.4" />
              <polyline fill="none" stroke="#2f7f61" strokeWidth="1.4" points={lineData.map((p, i) => `${7 + (i / Math.max(1, lineData.length - 1)) * 91},${38 - (p.minutes / maxLine) * 32}`).join(" ")} />
              {lineData.map((p, i) => <circle key={`${p.label}-${i}`} cx={7 + (i / Math.max(1, lineData.length - 1)) * 91} cy={38 - (p.minutes / maxLine) * 32} r={viewMode === "year" ? "0.6" : "1.1"} fill="#2f7f61" onMouseEnter={(e) => viewMode === "month" && setHover({ day: p.date, x: e.clientX, y: e.clientY })} onMouseMove={(e) => viewMode === "month" && setHover({ day: p.date, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} />)}
            </svg>
            <div className="lineAxis">{viewMode === "month" ? lineData.filter((_, i) => i % 5 === 0 || i === lineData.length - 1).map((p) => <span key={p.label}>{p.label.split("-")[2]}</span>) : Array.from({ length: 12 }, (_, i) => <span key={i}>{new Date(displayDate.getFullYear(), i, 1).toLocaleDateString(undefined, { month: "short" })}</span>)}</div>
            <p className="axisLabel">X-axis: {viewMode === "month" ? "day of month" : "day of year"} · Y-axis: writing time</p>
          </div>
        )}

        {hover && <div className="hoverTip" style={{ left: hover.x + 12, top: hover.y + 12 }}><strong>{dateFmt.format(new Date(`${hover.day}T12:00:00Z`))}</strong><span>{fmtMinutes(hovered?.minutes || 0)} written</span></div>}
      </section>

      <section className="stats">
        <article className="panel"><h3>Daily Average</h3><p>{fmtMinutes(stats.dailyAverage)}</p></article>
        <article className="panel"><h3>Monthly Total</h3><p>{fmtMinutes(stats.monthlyTotal)}</p></article>
        <article className="panel"><h3>Yearly Total</h3><p>{fmtMinutes(stats.yearlyTotal)}</p></article>
        <article className="panel"><h3>Best Day This Month</h3><p>{monthOrdinal(stats.bestDayThisMonth.date)}</p><small>{fmtMinutes(stats.bestDayThisMonth.minutes)}</small></article>
        <article className="panel"><h3>Best Day This Year</h3><p>{monthOrdinal(stats.bestDayThisYear.date)}</p><small>{fmtMinutes(stats.bestDayThisYear.minutes)}</small></article>
      </section>

      <section className="stats secondaryStats"><article className="panel clickableCard" onClick={() => setExpanded("trend")}><h3>Trend</h3><p>You’re writing {fmtMinutes(Math.abs(stats.trend.diff))} {stats.trend.diff >= 0 ? "more" : "less"} per day compared to the prior week{stats.trend.dailyPrev ? ` (${Math.abs(stats.trend.pct)}% ${stats.trend.diff >= 0 ? "more" : "less"})` : ""}.</p></article><article className="panel clickableCard" onClick={() => setExpanded("motivation")}><h3>Motivation</h3><p>If you start writing tomorrow at {timeFmt.format(new Date(Date.UTC(2026, 0, 1, Math.floor(stats.motivation.medianStart / 60), stats.motivation.medianStart % 60)))}, you’re likely to write for {stats.motivation.avgDuration} minutes.</p></article></section>

      <section className="panel chartPanel">
        <h3>Average writing time by weekday</h3>
        <div className="hBars">{weekdayBars.map((d) => { const max = Math.max(1, ...weekdayBars.map((x) => x.avg)); return <div key={d.name} className="hBarRow"><span>{d.name}</span><div className="hBarTrack"><div className="hBarFill" style={{ width: `${(d.avg / max) * 100}%` }} /></div><strong>{fmtMinutes(d.avg)}</strong></div>; })}</div>
        <h3>Writing activity across the day</h3>
        <div className="hourHist">{hourly.map((h) => <div key={h.hour} className="hourCol" onMouseEnter={(e) => setHourHover({ hour: h.hour, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHourHover({ hour: h.hour, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHourHover(null)}><div className="hourBar" style={{ height: `${Math.max(8, (h.daysCount / maxHour) * 100)}%` }} /></div>)}</div>
        <div className="hourTicks">{Array.from({ length: 24 }, (_, i) => <span key={i} className={i % 3 === 0 ? "major" : "minor"}>{String(i).padStart(2, "0")}</span>)}</div>
        <p className="axisLabel">Hours in day (America/Los_Angeles), showing patterns of when you write.</p>
        {hourHover && <div className="hourTooltip" style={{ left: hourHover.x + 12, top: hourHover.y + 12 }}><strong>{String(hourHover.hour).padStart(2, "0")}:00</strong><span>Days written during this hour: {hourly[hourHover.hour].daysCount}</span><span>Average time written during this hour: {fmtMinutes(hourly[hourHover.hour].avgMinutes)}</span></div>}
      </section>

      {selected && calendarMode === "grid" && <div className="modal" onClick={() => setSelectedDay(null)}><div className="modalCard" onClick={(e) => e.stopPropagation()}><h3>{dateFmt.format(new Date(`${selected.date}T12:00:00Z`))}</h3><p>Total writing: <strong>{fmtMinutes(selected.minutes)}</strong></p><p>Last 7 days: <strong>{fmtMinutes(rollingWeekMinutes(selected.date, byDay))}</strong></p><button className="modalCloseX" aria-label="Close" onClick={() => setSelectedDay(null)}>×</button><ul>{selected.sessions.map((s) => <li key={s.id}>{timeFmt.format(new Date(s.start))} – {timeFmt.format(new Date(s.end))}</li>)}</ul></div></div>}

      {expanded === "trend" && <div className="modal" onClick={() => setExpanded(null)}><div className="modalCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setExpanded(null)}>×</button><h3>Trend details</h3><p>Current 7-day average: <strong>{fmtMinutes(stats.trend.dailyNow)}</strong></p><p>Comparison 7-day average: <strong>{fmtMinutes(stats.trend.dailyPrev)}</strong></p><p>Current period: {stats.trend.currentPeriod[0]} to {stats.trend.currentPeriod.at(-1)}</p><p>Comparison period: {stats.trend.previousPeriod[0]} to {stats.trend.previousPeriod.at(-1)}</p><p>Difference = {fmtMinutes(stats.trend.dailyNow)} - {fmtMinutes(stats.trend.dailyPrev)} = <strong>{fmtMinutes(Math.abs(stats.trend.diff))} {stats.trend.diff >= 0 ? "more" : "less"} per day</strong>.</p></div></div>}

      {expanded === "motivation" && <div className="modal" onClick={() => setExpanded(null)}><div className="modalCard" onClick={(e) => e.stopPropagation()}><button className="modalCloseX" aria-label="Close" onClick={() => setExpanded(null)}>×</button><h3>Motivation details</h3><p>Day used: <strong>{stats.motivation.weekday}</strong></p><p>Data source: <strong>Historical sessions from your sheet for the same weekday.</strong></p><p>Data points used: <strong>{stats.motivation.dataPoints}</strong></p><p>Typical start time cluster: around <strong>{timeFmt.format(new Date(Date.UTC(2026,0,1,Math.floor(stats.motivation.medianStart/60),stats.motivation.medianStart%60)))}</strong></p><p>Average duration for similar starts: <strong>{fmtMinutes(stats.motivation.avgDuration)}</strong></p><p>Typical starts sampled: {stats.motivation.startExamples.join(", ") || "n/a"}</p><p>Sample durations (min): {stats.motivation.durations.join(", ") || "n/a"}</p><p>Method: We selected tomorrow’s weekday history and averaged durations from sessions that started near your typical time for that weekday.</p></div></div>}
    </main>
  );
}
