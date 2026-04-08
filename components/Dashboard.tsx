"use client";

import { useEffect, useMemo, useState } from "react";
import { Cell, ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { aggregateDays, rollingWeekMinutes, type WritingSession } from "@/lib/writing";

type ApiPayload = {
  sessions: WritingSession[];
  source: string;
  fetchedAt: string;
};

type ViewMode = "month" | "year";

const palette = {
  none: "#1f2947",
  baseline: "#2f6f6f",
  goal: "#3ea57d",
  superb: "#83f29b"
};

function toDate(s: string) {
  return new Date(s);
}

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function blockColor(min: number) {
  if (!min) return palette.none;
  if (min < 60) return palette.baseline;
  if (min < 120) return palette.goal;
  return palette.superb;
}

export default function Dashboard() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [displayDate, setDisplayDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "failed");
        return res.json();
      })
      .then(setPayload)
      .catch((err: Error) => setError(err.message));
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

  const yearlyCells = useMemo(() => {
    const y = displayDate.getFullYear();
    const start = new Date(y, 0, 1);
    const end = new Date(y, 11, 31);
    const cells: Date[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) cells.push(new Date(t));
    return cells;
  }, [displayDate]);

  const stats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let month = 0;
    let year = 0;
    for (const [d, v] of Object.entries(byDay)) {
      if (d.startsWith(ym)) month += v.minutes;
      if (d.startsWith(String(now.getFullYear()))) year += v.minutes;
    }

    const activeDays = sortedDays.length || 1;
    const avg = Math.round(year / activeDays);

    const last28 = sortedDays.slice(-28);
    const first14 = last28.slice(0, 14).reduce((acc, d) => acc + byDay[d].minutes, 0);
    const last14 = last28.slice(14).reduce((acc, d) => acc + byDay[d].minutes, 0);
    const trend = last14 >= first14 ? "Increasing" : "Decreasing";

    const sessionStarts = (payload?.sessions || []).map((s) => toDate(s.start));
    const currentHour = now.getHours();
    const closeSessions = (payload?.sessions || []).filter((s) => {
      const sh = toDate(s.start).getHours();
      return Math.abs(sh - currentHour) <= 1;
    });
    const pool = closeSessions.length ? closeSessions : payload?.sessions || [];
    const predicted = pool.length
      ? Math.round(
          pool.reduce((acc, s) => acc + (toDate(s.end).getTime() - toDate(s.start).getTime()) / 60000, 0) /
            pool.length
        )
      : 45;

    const medStart = sessionStarts.length
      ? sessionStarts
          .sort((a, b) => a.getHours() * 60 + a.getMinutes() - (b.getHours() * 60 + b.getMinutes()))[
          Math.floor(sessionStarts.length / 2)
        ]
      : now;

    return { month, year, avg, trend, predicted, medStart };
  }, [byDay, payload, sortedDays]);

  const patternData = useMemo(() => {
    const cells: Record<string, number> = {};
    for (const s of payload?.sessions || []) {
      const start = toDate(s.start);
      const day = start.toLocaleDateString(undefined, { weekday: "short" });
      const hour = start.getHours();
      const key = `${day}-${hour}`;
      cells[key] = (cells[key] || 0) + 1;
    }
    return Object.entries(cells).map(([name, size]) => ({ name, size }));
  }, [payload]);

  const selected = selectedDay ? byDay[selectedDay] : null;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: 28 }}>
      <h1>Writing Analytics</h1>
      <p style={{ color: "var(--muted)" }}>Transforming raw sessions into deep writing momentum insights.</p>

      {error && <p style={{ color: "#ff9aa2" }}>{error}</p>}

      <section className="panel">
        <div className="toolbar">
          <div>
            <button onClick={() => setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1))}>←</button>
            <strong style={{ margin: "0 8px" }}>
              {displayDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </strong>
            <button onClick={() => setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1))}>→</button>
          </div>
          <div>
            <button onClick={() => setViewMode("month")} className={viewMode === "month" ? "active" : ""}>Month</button>
            <button onClick={() => setViewMode("year")} className={viewMode === "year" ? "active" : ""}>Year</button>
          </div>
        </div>

        {viewMode === "month" ? (
          <div className="grid month">
            {monthDays.map((d, idx) => {
              if (!d) return <div key={`empty-${idx}`} className="cell empty" />;
              const k = ymd(d);
              const min = byDay[k]?.minutes || 0;
              return (
                <button
                  key={k}
                  className="cell"
                  style={{ background: blockColor(min) }}
                  title={`${k}: ${min} minutes`}
                  onClick={() => setSelectedDay(k)}
                >
                  <span>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid year">
            {yearlyCells.map((d) => {
              const k = ymd(d);
              const min = byDay[k]?.minutes || 0;
              return (
                <button
                  key={k}
                  className="cell yearcell"
                  title={`${k}: ${min} minutes`}
                  style={{ background: blockColor(min) }}
                  onClick={() => setSelectedDay(k)}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="stats">
        <article className="panel"><h3>Avg Daily</h3><p>{fmtMinutes(stats.avg)}</p></article>
        <article className="panel"><h3>This Month</h3><p>{fmtMinutes(stats.month)}</p></article>
        <article className="panel"><h3>This Year</h3><p>{fmtMinutes(stats.year)}</p></article>
        <article className="panel"><h3>Trend</h3><p>{stats.trend}</p></article>
      </section>

      <section className="panel" style={{ height: 260 }}>
        <h3>Writing Pattern (Day × Hour)</h3>
        <ResponsiveContainer width="100%" height="85%">
          <Treemap data={patternData} dataKey="size" stroke="#0f142b" content={<></>}>
            {patternData.map((entry, idx) => (
              <Cell key={`${entry.name}-${idx}`} fill={["#2a355f", "#35508d", "#4a78c2", "#69c3c4"][idx % 4]} />
            ))}
            <Tooltip formatter={(value: number, _name, item) => [`${value} sessions`, item.payload.name]} />
          </Treemap>
        </ResponsiveContainer>
      </section>

      <section className="panel prediction">
        If you start writing around <strong>{stats.medStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>{" "}
        tomorrow, you’ll likely write for <strong>~{stats.predicted} minutes</strong>.
      </section>

      {selected && (
        <dialog open className="modal" onClick={() => setSelectedDay(null)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.date}</h3>
            <p>Total: {fmtMinutes(selected.minutes)}</p>
            <p>Last 7 days: {fmtMinutes(rollingWeekMinutes(selected.date, byDay))}</p>
            <ul>
              {selected.sessions.map((s) => (
                <li key={s.id}>
                  {toDate(s.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} -{" "}
                  {toDate(s.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </li>
              ))}
            </ul>
            <button onClick={() => setSelectedDay(null)}>Close</button>
          </div>
        </dialog>
      )}

      <p style={{ color: "var(--muted)", marginTop: 14, fontSize: 12 }}>
        Data source: {payload?.source || "(loading...)"} • Updated {payload?.fetchedAt ? new Date(payload.fetchedAt).toLocaleString() : "--"}
      </p>
    </main>
  );
}
