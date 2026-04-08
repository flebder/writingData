"use client";

import { useEffect, useMemo, useState } from "react";
import { aggregateDays, rollingWeekMinutes, WRITING_TZ, type WritingSession } from "@/lib/writing";

type ApiPayload = { sessions: WritingSession[]; source: string; fetchedAt: string; warning?: string };
type ViewMode = "month" | "year";
type CalendarMode = "grid" | "line";

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const level = (min: number) => (!min ? "none" : min < 30 ? "below" : min < 60 ? "baseline" : min < 120 ? "goal" : "super");

const ymd = (d: Date) => d.toISOString().slice(0, 10);
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
    const cells: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
    const total = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= total; d += 1) cells.push(new Date(y, m, d));
    return cells;
  }, [displayDate]);

  const months = useMemo(() => {
    const y = displayDate.getFullYear();
    return Array.from({ length: 12 }, (_, m) => ({ month: m, name: new Date(y, m, 1).toLocaleDateString(undefined, { month: "long" }), days: Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => new Date(y, m, i + 1)) }));
  }, [displayDate]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let month = 0;
    let year = 0;
    let bestMonth = { date: "-", minutes: 0 };
    let bestYear = { date: "-", minutes: 0 };
    for (const [d, v] of Object.entries(byDay)) {
      if (d.startsWith(thisMonth)) {
        month += v.minutes;
        if (v.minutes > bestMonth.minutes) bestMonth = { date: d, minutes: v.minutes };
      }
      if (d.startsWith(String(now.getFullYear()))) {
        year += v.minutes;
        if (v.minutes > bestYear.minutes) bestYear = { date: d, minutes: v.minutes };
      }
    }
    const avg = sortedDays.length ? Math.round(year / sortedDays.length) : 0;

    const weekNow = sortedDays.slice(-7).reduce((a, d) => a + byDay[d].minutes, 0);
    const weekPrev = sortedDays.slice(-14, -7).reduce((a, d) => a + byDay[d].minutes, 0);
    const dailyNow = Math.round(weekNow / 7);
    const dailyPrev = Math.round(weekPrev / 7);
    const diff = dailyNow - dailyPrev;
    const pct = dailyPrev ? Math.round((diff / dailyPrev) * 100) : 0;

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const dow = tomorrow.getDay();
    const sameDaySessions = (payload?.sessions || []).filter((s) => new Date(s.start).getDay() === dow);
    const starts = sameDaySessions.map((s) => {
      const d = new Date(s.start);
      return d.getHours() * 60 + d.getMinutes();
    }).sort((a, b) => a - b);
    const medianStart = starts.length ? starts[Math.floor(starts.length / 2)] : 9 * 60;
    const similar = sameDaySessions.filter((s) => {
      const d = new Date(s.start);
      const m = d.getHours() * 60 + d.getMinutes();
      return Math.abs(m - medianStart) <= 90;
    });
    const sample = similar.length >= 3 ? similar : sameDaySessions;
    const predicted = sample.length ? Math.round(sample.reduce((a, s) => a + (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000, 0) / sample.length) : 45;
    const humanStart = timeFmt.format(new Date(Date.UTC(2026, 0, 1, Math.floor(medianStart / 60), medianStart % 60)));

    return {
      avg,
      month,
      year,
      bestMonth,
      bestYear,
      trendText: `You’re writing ${fmtMinutes(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} per day compared to two weeks ago${dailyPrev ? ` (${Math.abs(pct)}%)` : ""}.`,
      motivation: `If you start writing at ${humanStart}, you’re likely to write for ${predicted} minutes.`
    };
  }, [byDay, payload, sortedDays]);

  const weekdayBars = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const rows = names.map((name) => ({ name, total: 0, count: 0, avg: 0 }));
    for (const [d, b] of Object.entries(byDay)) {
      const idx = new Date(`${d}T12:00:00Z`).getUTCDay();
      rows[idx].total += b.minutes;
      rows[idx].count += 1;
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
        const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: WRITING_TZ, hour: "numeric", hour12: false }).format(cursor));
        const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: WRITING_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(cursor);
        const nextHour = new Date(cursor);
        nextHour.setMinutes(60, 0, 0);
        const end = nextHour < et ? nextHour : et;
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
    if (viewMode === "month") {
      return monthDays.filter(Boolean).map((d) => ({ label: String((d as Date).getDate()), date: ymd(d as Date), minutes: byDay[ymd(d as Date)]?.minutes || 0 }));
    }
    return Array.from({ length: 12 }, (_, i) => ({
      label: new Date(displayDate.getFullYear(), i, 1).toLocaleDateString(undefined, { month: "short" }),
      date: `${displayDate.getFullYear()}-${String(i + 1).padStart(2, "0")}-01`,
      minutes: Object.entries(byDay).filter(([d]) => d.startsWith(`${displayDate.getFullYear()}-${String(i + 1).padStart(2, "0")}`)).reduce((a, [, v]) => a + v.minutes, 0)
    }));
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
            <button className={viewMode === "month" ? "active" : ""} onClick={() => setViewMode("month")}>Month View</button>
            <button className={viewMode === "year" ? "active" : ""} onClick={() => setViewMode("year")}>Year View</button>
            <button className={calendarMode === "grid" ? "active" : ""} onClick={() => setCalendarMode("grid")}>Grid</button>
            <button className={calendarMode === "line" ? "active" : ""} onClick={() => setCalendarMode("line")}>Line</button>
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
            <svg viewBox="0 0 100 40" className="lineChartAlt">
              <polyline fill="none" stroke="#2f7f61" strokeWidth="1.6" points={lineData.map((p, i) => `${(i / Math.max(1, lineData.length - 1)) * 100},${38 - (p.minutes / maxLine) * 32}`).join(" ")} />
              {lineData.map((p, i) => <circle key={`${p.label}-${i}`} cx={(i / Math.max(1, lineData.length - 1)) * 100} cy={38 - (p.minutes / maxLine) * 32} r="1.2" fill="#2f7f61" onMouseEnter={(e) => setHover({ day: p.date, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ day: p.date, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)} />)}
            </svg>
            <div className="lineAxis">{lineData.map((p) => <span key={p.label}>{p.label}</span>)}</div>
          </div>
        )}

        {hover && <div className="hoverTip" style={{ left: hover.x + 12, top: hover.y + 12 }}><strong>{dateFmt.format(new Date(`${hover.day}T12:00:00Z`))}</strong><span>{fmtMinutes(hovered?.minutes || 0)} written</span></div>}
      </section>

      <section className="stats">
        <article className="panel"><h3>Daily Average</h3><p>{fmtMinutes(stats.avg)}</p></article>
        <article className="panel"><h3>Monthly Total</h3><p>{fmtMinutes(stats.month)}</p></article>
        <article className="panel"><h3>Yearly Total</h3><p>{fmtMinutes(stats.year)}</p></article>
        <article className="panel"><h3>Best Day This Month</h3><p>({monthOrdinal(stats.bestMonth.date)}) <small>{fmtMinutes(stats.bestMonth.minutes)}</small></p></article>
        <article className="panel"><h3>Best Day This Year</h3><p>({monthOrdinal(stats.bestYear.date)}) <small>{fmtMinutes(stats.bestYear.minutes)}</small></p></article>
      </section>

      <section className="stats secondaryStats"><article className="panel"><h3>Trend</h3><p>{stats.trendText}</p></article><article className="panel"><h3>Motivation</h3><p>{stats.motivation}</p></article></section>

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
    </main>
  );
}
