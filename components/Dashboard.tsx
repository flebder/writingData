"use client";

import { useEffect, useMemo, useState } from "react";
import { aggregateDays, rollingWeekMinutes, WRITING_TZ, type WritingSession } from "@/lib/writing";

type ApiPayload = { sessions: WritingSession[]; source: string; fetchedAt: string; warning?: string };
type ViewMode = "month" | "year";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });

const level = (min: number) => (!min ? "none" : min < 30 ? "below" : min < 60 ? "baseline" : min < 120 ? "goal" : "superb");
const statusText = (min: number) => (min < 30 ? "below baseline" : min < 60 ? "baseline" : "goal achieved");
const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [displayDate, setDisplayDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then(setPayload).catch(() => setPayload({ sessions: [], source: "fallback", fetchedAt: new Date().toISOString() }));
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setSelectedDay(null);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  const byDay = useMemo(() => aggregateDays(payload?.sessions || []), [payload]);
  const sortedDays = useMemo(() => Object.keys(byDay).sort(), [byDay]);

  const monthDays = useMemo(() => {
    const y = displayDate.getFullYear();
    const m = displayDate.getMonth();
    const first = new Date(y, m, 1);
    const offset = first.getDay();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < offset; i += 1) cells.push(null);
    const total = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= total; d += 1) cells.push(new Date(y, m, d));
    return cells;
  }, [displayDate]);

  const months = useMemo(() => {
    const y = displayDate.getFullYear();
    return Array.from({ length: 12 }, (_, m) => {
      const first = new Date(y, m, 1);
      const total = new Date(y, m + 1, 0).getDate();
      return { name: first.toLocaleDateString(undefined, { month: "short" }), days: Array.from({ length: total }, (_, i) => new Date(y, m, i + 1)) };
    });
  }, [displayDate]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let month = 0;
    let year = 0;
    for (const [d, v] of Object.entries(byDay)) {
      if (d.startsWith(thisMonth)) month += v.minutes;
      if (d.startsWith(String(now.getFullYear()))) year += v.minutes;
    }
    const avg = sortedDays.length ? Math.round(year / sortedDays.length) : 0;
    const last14 = sortedDays.slice(-14).reduce((a, d) => a + byDay[d].minutes, 0);
    const prev14 = sortedDays.slice(-28, -14).reduce((a, d) => a + byDay[d].minutes, 0);
    const diff = last14 - prev14;
    const pct = prev14 ? Math.round((diff / prev14) * 100) : 0;
    return { month, year, avg, diff, pct, trendText: `${diff >= 0 ? "Up" : "Down"} ${fmtMinutes(Math.abs(diff))} (${Math.abs(pct)}%) vs prior 14 days` };
  }, [byDay, sortedDays]);

  const sessionsByWeekday = useMemo(() => {
    const arr = weekdayNames.map((name, i) => ({ name, minutes: 0, idx: i }));
    (payload?.sessions || []).forEach((s) => {
      const st = new Date(s.start);
      const et = new Date(s.end);
      const wk = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, weekday: "short" }).format(st);
      const d = weekdayNames.indexOf(wk);
      if (d >= 0) arr[d].minutes += Math.round((et.getTime() - st.getTime()) / 60000);
    });
    return arr;
  }, [payload]);

  const sessionsByHour = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    (payload?.sessions || []).forEach((s) => {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", hour12: false }).format(new Date(s.start)));
      bins[hour].count += 1;
    });
    return bins;
  }, [payload]);

  const selected = selectedDay ? byDay[selectedDay] : null;
  const hovered = hoveredDay ? byDay[hoveredDay] : null;

  return (
    <main className="journalShell">
      <header className="hero"><h1>Writing Journal</h1><p>Quiet analytics for steady writing practice.</p></header>

      <section className="panel calendarPanel">
        <div className="toolbar">
          <div>
            <button onClick={() => setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1))}>←</button>
            <strong>{displayDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button onClick={() => setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1))}>→</button>
          </div>
          <div>
            <button className={viewMode === "month" ? "active" : ""} onClick={() => setViewMode("month")}>Month</button>
            <button className={viewMode === "year" ? "active" : ""} onClick={() => setViewMode("year")}>Year</button>
          </div>
        </div>

        {viewMode === "month" ? (
          <div className="monthGrid">
            {monthDays.map((d, i) => {
              if (!d) return <div key={i} className="day empty" />;
              const key = ymd(d);
              const min = byDay[key]?.minutes || 0;
              return (
                <button key={key} className={`day ${level(min)}`} onMouseEnter={() => setHoveredDay(key)} onMouseLeave={() => setHoveredDay(null)} onClick={() => setSelectedDay(key)}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="yearWrap">
            {months.map((m) => (
              <div key={m.name} className="monthBlock">
                <h4>{m.name}</h4>
                <div className="monthMiniGrid">
                  {m.days.map((d) => {
                    const key = ymd(d);
                    const min = byDay[key]?.minutes || 0;
                    return <button key={key} className={`mini ${level(min)}`} onClick={() => setSelectedDay(key)} onMouseEnter={() => setHoveredDay(key)} onMouseLeave={() => setHoveredDay(null)} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {hoveredDay && (
          <div className="hoverTip">
            <strong>{dateFmt.format(new Date(`${hoveredDay}T12:00:00Z`))}</strong>
            <span>{fmtMinutes(hovered?.minutes || 0)} written</span>
            <em>{statusText(hovered?.minutes || 0)}</em>
          </div>
        )}
      </section>

      <section className="stats">
        <article className="panel"><h3>Average Daily</h3><p>{fmtMinutes(stats.avg)}</p></article>
        <article className="panel"><h3>This Month</h3><p>{fmtMinutes(stats.month)}</p></article>
        <article className="panel"><h3>This Year</h3><p>{fmtMinutes(stats.year)}</p></article>
        <article className="panel"><h3>Trend</h3><p>{stats.trendText}</p></article>
      </section>

      <section className="panel chartPanel">
        <h3>Writing by Day of Week (minutes)</h3>
        <div className="barChart">
          {sessionsByWeekday.map((d) => (
            <div key={d.name} className="barCol">
              <div className="bar" style={{ height: `${Math.max(8, d.minutes / 8)}px` }} title={`${d.name}: ${d.minutes} minutes`} />
              <label>{d.name}</label>
            </div>
          ))}
        </div>
        <h3>Writing Start Times (session count by hour)</h3>
        <div className="hourRow">
          {sessionsByHour.map((h) => <div key={h.hour} className="hourBin" title={`${h.hour}:00 • ${h.count} sessions`} style={{ opacity: h.count ? Math.min(1, 0.2 + h.count / 8) : 0.12 }} />)}
        </div>
        <p className="axisLabel">00:00 → 23:00 (America/Los_Angeles)</p>
      </section>

      {selected && (
        <div className="modal" onClick={() => setSelectedDay(null)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>{dateFmt.format(new Date(`${selected.date}T12:00:00Z`))}</h3>
            <p>Total writing: <strong>{fmtMinutes(selected.minutes)}</strong></p>
            <p>Last 7 days (incl. selected): <strong>{fmtMinutes(rollingWeekMinutes(selected.date, byDay))}</strong></p>
            <ul>
              {selected.sessions.map((s) => <li key={s.id}>{timeFmt.format(new Date(s.start))} – {timeFmt.format(new Date(s.end))}</li>)}
            </ul>
            <button onClick={() => setSelectedDay(null)}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}
