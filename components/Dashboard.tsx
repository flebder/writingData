"use client";

import { useEffect, useMemo, useState } from "react";
import { aggregateDays, rollingWeekMinutes, WRITING_TZ, type WritingSession } from "@/lib/writing";

type ApiPayload = { sessions: WritingSession[]; source: string; fetchedAt: string; warning?: string };
type ViewMode = "month" | "year";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });

const level = (min: number) => (!min ? "none" : min < 30 ? "below" : min < 60 ? "baseline" : min < 120 ? "goal" : "super");
const statusText = (min: number) => (!min ? "no writing" : min < 30 ? "below baseline" : min < 60 ? "baseline" : min < 120 ? "goal" : "super goal");
const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [displayDate, setDisplayDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);

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
      return {
        month: m,
        name: first.toLocaleDateString(undefined, { month: "long" }),
        days: Array.from({ length: total }, (_, i) => new Date(y, m, i + 1))
      };
    });
  }, [displayDate]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let month = 0;
    let year = 0;
    let best = { date: "-", minutes: 0 };

    for (const [d, v] of Object.entries(byDay)) {
      if (d.startsWith(thisMonth)) {
        month += v.minutes;
        if (v.minutes > best.minutes) best = { date: d, minutes: v.minutes };
      }
      if (d.startsWith(String(now.getFullYear()))) year += v.minutes;
    }

    const avg = sortedDays.length ? Math.round(year / sortedDays.length) : 0;
    const last14 = sortedDays.slice(-14).reduce((a, d) => a + byDay[d].minutes, 0);
    const prev14 = sortedDays.slice(-28, -14).reduce((a, d) => a + byDay[d].minutes, 0);
    const diff = last14 - prev14;
    const pct = prev14 ? Math.round((diff / prev14) * 100) : 0;

    const sessions = payload?.sessions || [];
    const suggestedHour = sessions.length
      ? Math.round(
          sessions
            .map((s) => Number(new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", hour12: false }).format(new Date(s.start))))
            .reduce((a, b) => a + b, 0) / sessions.length
        )
      : 9;

    const nearHour = sessions.filter((s) => Number(new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", hour12: false }).format(new Date(s.start))) === suggestedHour);
    const predicted = nearHour.length
      ? Math.round(nearHour.reduce((a, s) => a + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000, 0) / nearHour.length)
      : 45;

    return {
      avg,
      month,
      year,
      best,
      trendText: `${diff >= 0 ? "Up" : "Down"} ${fmtMinutes(Math.abs(diff))} (${Math.abs(pct)}%) vs prior 14 days`,
      motivation: `If you write around ${String(suggestedHour).padStart(2, "0")}:00 tomorrow, you’ll likely write for ~${predicted} minutes.`
    };
  }, [byDay, payload, sortedDays]);

  const dayAvgBars = useMemo(() => {
    const totals = weekdayNames.map((name) => ({ name, total: 0, count: 0, avg: 0 }));
    for (const [d, bucket] of Object.entries(byDay)) {
      const idx = new Date(`${d}T12:00:00Z`).getUTCDay();
      totals[idx].total += bucket.minutes;
      totals[idx].count += 1;
    }
    totals.forEach((r) => {
      r.avg = r.count ? Math.round(r.total / r.count) : 0;
    });
    return totals;
  }, [byDay]);

  const hourly = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const s of payload?.sessions || []) {
      const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", hour12: false }).format(new Date(s.start)));
      bins[h].count += 1;
    }
    return bins;
  }, [payload]);

  const maxHour = Math.max(1, ...hourly.map((h) => h.count));
  const points = hourly.map((h, i) => `${(i / 23) * 100},${100 - (h.count / maxHour) * 90}`).join(" ");

  const selected = selectedDay ? byDay[selectedDay] : null;
  const hovered = hover?.day ? byDay[hover.day] : null;

  const moveBack = () => {
    if (viewMode === "year") setDisplayDate(new Date(displayDate.getFullYear() - 1, 0, 1));
    else setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1));
  };
  const moveNext = () => {
    if (viewMode === "year") setDisplayDate(new Date(displayDate.getFullYear() + 1, 0, 1));
    else setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1));
  };

  return (
    <main className="journalShell">
      <header className="hero"><h1>Writing Journal</h1><p>Calm insights for consistent creative practice.</p></header>

      <section className="panel calendarPanel">
        <div className="toolbar">
          <div className="navBlock">
            <button onClick={moveBack}>←</button>
            <strong>{viewMode === "year" ? displayDate.getFullYear() : displayDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button onClick={moveNext}>→</button>
          </div>
          <div className="modeSwitch">
            <button className={viewMode === "month" ? "active" : ""} onClick={() => setViewMode("month")}>Month View</button>
            <button className={viewMode === "year" ? "active" : ""} onClick={() => setViewMode("year")}>Year View</button>
          </div>
        </div>

        {viewMode === "month" ? (
          <div className="monthGrid">
            {monthDays.map((d, i) => {
              if (!d) return <div key={i} className="day empty" />;
              const key = ymd(d);
              const min = byDay[key]?.minutes || 0;
              return (
                <button
                  key={key}
                  className={`day ${level(min)}`}
                  onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSelectedDay(key)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="yearWrap">
            {months.map((m) => (
              <div key={m.name} className="monthBlock">
                <button
                  className="monthJump"
                  onClick={() => {
                    setDisplayDate(new Date(displayDate.getFullYear(), m.month, 1));
                    setViewMode("month");
                  }}
                >
                  {m.name}
                </button>
                <div className="monthMiniGrid">
                  {m.days.map((d) => {
                    const key = ymd(d);
                    const min = byDay[key]?.minutes || 0;
                    return (
                      <button
                        key={key}
                        className={`mini ${level(min)}`}
                        onClick={() => setSelectedDay(key)}
                        onMouseEnter={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover({ day: key, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {hover && (
          <div className="hoverTip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <strong>{dateFmt.format(new Date(`${hover.day}T12:00:00Z`))}</strong>
            <span>{fmtMinutes(hovered?.minutes || 0)} written</span>
            <em>{statusText(hovered?.minutes || 0)}</em>
          </div>
        )}
      </section>

      <section className="stats">
        <article className="panel"><h3>Daily Average</h3><p>{fmtMinutes(stats.avg)}</p></article>
        <article className="panel"><h3>Monthly Total</h3><p>{fmtMinutes(stats.month)}</p></article>
        <article className="panel"><h3>Yearly Total</h3><p>{fmtMinutes(stats.year)}</p></article>
        <article className="panel"><h3>Best Day This Month</h3><p>{fmtMinutes(stats.best.minutes)}</p><small>{stats.best.date}</small></article>
      </section>

      <section className="stats secondaryStats">
        <article className="panel"><h3>Trend</h3><p>{stats.trendText}</p></article>
        <article className="panel"><h3>Motivation</h3><p>{stats.motivation}</p></article>
      </section>

      <section className="panel chartPanel">
        <h3>Average writing time by weekday</h3>
        <div className="hBars">
          {dayAvgBars.map((d) => {
            const max = Math.max(1, ...dayAvgBars.map((x) => x.avg));
            return (
              <div key={d.name} className="hBarRow">
                <span>{d.name}</span>
                <div className="hBarTrack"><div className="hBarFill" style={{ width: `${(d.avg / max) * 100}%` }} /></div>
                <strong>{fmtMinutes(d.avg)}</strong>
              </div>
            );
          })}
        </div>

        <h3>Writing activity across the day</h3>
        <svg viewBox="0 0 100 100" className="lineChart" aria-label="Writing activity by hour">
          <polyline fill="none" stroke="#2f7f61" strokeWidth="2" points={points} />
          {hourly.map((h, i) => (
            <circle key={h.hour} cx={(i / 23) * 100} cy={100 - (h.count / maxHour) * 90} r="1.3" fill="#2f7f61" />
          ))}
        </svg>
        <div className="hourTicks">
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i}>{i % 3 === 0 ? String(i).padStart(2, "0") : "·"}</span>
          ))}
        </div>
        <p className="axisLabel">Hours in day (America/Los_Angeles), showing peaks and dips in writing starts.</p>
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
