"use client";

import { useEffect, useMemo, useState } from "react";
import { createProjectEvent, localProjectToday, offsetYmd, reduceProjectEvents, daysBetweenYmd, type Milestone, type Project, type ProjectDeadline, type ProjectEvent } from "@/lib/projects";

type ProjectsApiPayload = {
  ok: boolean;
  configured: boolean;
  events: ProjectEvent[];
  warning?: string;
};

type EditMilestoneState = {
  milestone_name: string;
  deadline_date: string;
  notes: string;
};

type ManualAdjustState = {
  completing: ProjectDeadline;
  dates: Record<string, string>;
};

function newId(prefix: string) {
  const cryptoObj = globalThis.crypto;
  const random = cryptoObj?.randomUUID ? cryptoObj.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

function formatDeadline(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function dueCopy(deadline: ProjectDeadline) {
  if (deadline.daysUntil < 0) return `${Math.abs(deadline.daysUntil)} ${Math.abs(deadline.daysUntil) === 1 ? "day" : "days"} ago`;
  if (deadline.daysUntil === 0) return "due today";
  return `${deadline.daysUntil} ${deadline.daysUntil === 1 ? "day" : "days"} left`;
}

function laterMilestones(deadline: ProjectDeadline, milestones: Milestone[]) {
  return milestones.filter((m) => m.project_id === deadline.project.project_id && m.status === "active" && m.milestone_id !== deadline.milestone.milestone_id && m.deadline_date >= deadline.milestone.deadline_date);
}

export default function ProjectsClient() {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditMilestoneState>({ milestone_name: "", deadline_date: "", notes: "" });
  const [manualAdjust, setManualAdjust] = useState<ManualAdjustState | null>(null);
  const [newProject, setNewProject] = useState({ project_name: "", project_type: "", notes: "", milestone_name: "", deadline_date: localProjectToday() });
  const [newMilestone, setNewMilestone] = useState({ project_id: "", milestone_name: "", deadline_date: localProjectToday(), notes: "" });

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
    fetch("/api/projects", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: ProjectsApiPayload) => {
        setEvents(data.events || []);
        setConfigured(data.configured);
        setWarning(data.warning || null);
      })
      .catch(() => setWarning("Project deadlines could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const state = useMemo(() => reduceProjectEvents(events), [events]);
  const activeProjects = state.projects.filter((project) => project.status === "active");

  async function appendEvents(nextEvents: ProjectEvent[]) {
    setSaving(true);
    setWarning(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: nextEvents })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.warning || "Project changes could not be saved.");
      setEvents((current) => [...current, ...nextEvents]);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Project changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(deadline: ProjectDeadline) {
    setEditingId(deadline.milestone.milestone_id);
    setEdit({ milestone_name: deadline.milestone.milestone_name, deadline_date: deadline.milestone.deadline_date, notes: deadline.milestone.notes });
  }

  async function saveEdit(deadline: ProjectDeadline) {
    const nextEvents: ProjectEvent[] = [];
    if (edit.milestone_name !== deadline.milestone.milestone_name || edit.notes !== deadline.milestone.notes) {
      nextEvents.push(createProjectEvent("update_milestone", deadline.project.project_id, deadline.milestone.milestone_id, { milestone_name: edit.milestone_name, notes: edit.notes }));
    }
    if (edit.deadline_date !== deadline.milestone.deadline_date) {
      nextEvents.push(createProjectEvent("change_deadline", deadline.project.project_id, deadline.milestone.milestone_id, { previous_deadline_date: deadline.milestone.deadline_date, deadline_date: edit.deadline_date }));
    }
    if (nextEvents.length) await appendEvents(nextEvents);
    setEditingId(null);
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProject.project_name.trim() || !newProject.milestone_name.trim() || !newProject.deadline_date) return;
    const projectId = newId("project");
    const milestoneId = newId("milestone");
    await appendEvents([
      createProjectEvent("create_project", projectId, undefined, { project_name: newProject.project_name.trim(), project_type: newProject.project_type.trim(), notes: newProject.notes.trim(), status: "active", created_at: localProjectToday() }),
      createProjectEvent("add_milestone", projectId, milestoneId, { milestone_name: newProject.milestone_name.trim(), deadline_date: newProject.deadline_date, notes: "", status: "active", created_at: localProjectToday(), sort_order: 0 })
    ]);
    setNewProject({ project_name: "", project_type: "", notes: "", milestone_name: "", deadline_date: localProjectToday() });
  }

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!newMilestone.project_id || !newMilestone.milestone_name.trim() || !newMilestone.deadline_date) return;
    const sortOrder = state.milestones.filter((m) => m.project_id === newMilestone.project_id).length;
    await appendEvents([
      createProjectEvent("add_milestone", newMilestone.project_id, newId("milestone"), { milestone_name: newMilestone.milestone_name.trim(), deadline_date: newMilestone.deadline_date, notes: newMilestone.notes.trim(), status: "active", created_at: localProjectToday(), sort_order: sortOrder })
    ]);
    setNewMilestone({ project_id: newMilestone.project_id, milestone_name: "", deadline_date: localProjectToday(), notes: "" });
  }

  function completionEvents(deadline: ProjectDeadline, adjustment: "none" | "auto", manualDates?: Record<string, string>) {
    const today = localProjectToday();
    const later = laterMilestones(deadline, state.milestones);
    const nextEvents: ProjectEvent[] = [createProjectEvent("complete_milestone", deadline.project.project_id, deadline.milestone.milestone_id, { completed_at: today })];
    const remainingAfterComplete = state.milestones.filter((m) => m.project_id === deadline.project.project_id && m.status === "active" && m.milestone_id !== deadline.milestone.milestone_id);
    if (!remainingAfterComplete.length) nextEvents.push(createProjectEvent("update_project", deadline.project.project_id, undefined, { status: "completed" }));
    if (adjustment === "auto") {
      const offset = daysBetweenYmd(today, deadline.milestone.deadline_date);
      for (const milestone of later) {
        nextEvents.push(createProjectEvent("change_deadline", deadline.project.project_id, milestone.milestone_id, { previous_deadline_date: milestone.deadline_date, deadline_date: offsetYmd(milestone.deadline_date, offset), adjustment: "auto_after_completion" }));
      }
    } else if (manualDates) {
      for (const milestone of later) {
        const nextDate = manualDates[milestone.milestone_id];
        if (nextDate && nextDate !== milestone.deadline_date) nextEvents.push(createProjectEvent("change_deadline", deadline.project.project_id, milestone.milestone_id, { previous_deadline_date: milestone.deadline_date, deadline_date: nextDate, adjustment: "manual_after_completion" }));
      }
    }
    return nextEvents;
  }

  async function complete(deadline: ProjectDeadline, adjustment: "none" | "auto", manualDates?: Record<string, string>) {
    await appendEvents(completionEvents(deadline, adjustment, manualDates));
    setManualAdjust(null);
  }

  return (
    <main className="journalShell projectsShell">
      <header className="projectsHeader">
        <a className="backLink" href="/">← Writing Journal</a>
        <div className="projectsHeaderRow">
          <div>
            <p className="eyebrow">Projects / Deadlines</p>
            <h1>Deadline compass</h1>
            <p className="projectsIntro">A quiet place for the next few writing promises, kept separate from your writing-session data.</p>
          </div>
          <button className="themeToggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle theme">{theme === "light" ? "☀️" : "🌙"}</button>
        </div>
      </header>

      {warning && <section className="panel projectNotice"><strong>Note:</strong> {warning}</section>}
      {!configured && <section className="panel projectNotice">Project storage is not configured yet. Add the Google Sheets/App Script environment variables to save project events.</section>}

      <section className="panel projectFormPanel">
        <h2>Add a project deadline</h2>
        <form className="projectForm" onSubmit={addProject}>
          <label>Project name<input value={newProject.project_name} onChange={(e) => setNewProject({ ...newProject, project_name: e.target.value })} placeholder="Pilot Script" /></label>
          <label>Type<input value={newProject.project_type} onChange={(e) => setNewProject({ ...newProject, project_type: e.target.value })} placeholder="optional" /></label>
          <label>First milestone<input value={newProject.milestone_name} onChange={(e) => setNewProject({ ...newProject, milestone_name: e.target.value })} placeholder="Finish outline" /></label>
          <label>Due date<input type="date" value={newProject.deadline_date} onChange={(e) => setNewProject({ ...newProject, deadline_date: e.target.value })} /></label>
          <label className="wide">Notes<textarea value={newProject.notes} onChange={(e) => setNewProject({ ...newProject, notes: e.target.value })} placeholder="Optional context" /></label>
          <button className="wide" disabled={saving}>{saving ? "Saving…" : "Add project"}</button>
        </form>
      </section>

      <section className="panel projectFormPanel">
        <h2>Add a milestone</h2>
        <form className="projectForm" onSubmit={addMilestone}>
          <label>Project<select value={newMilestone.project_id} onChange={(e) => setNewMilestone({ ...newMilestone, project_id: e.target.value })}><option value="">Choose project</option>{activeProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_name}</option>)}</select></label>
          <label>Milestone<input value={newMilestone.milestone_name} onChange={(e) => setNewMilestone({ ...newMilestone, milestone_name: e.target.value })} placeholder="Polish draft" /></label>
          <label>Due date<input type="date" value={newMilestone.deadline_date} onChange={(e) => setNewMilestone({ ...newMilestone, deadline_date: e.target.value })} /></label>
          <label>Notes<input value={newMilestone.notes} onChange={(e) => setNewMilestone({ ...newMilestone, notes: e.target.value })} placeholder="optional" /></label>
          <button className="wide" disabled={saving || !activeProjects.length}>{saving ? "Saving…" : "Add milestone"}</button>
        </form>
      </section>

      <section className="projectsList">
        <h2>Active deadlines</h2>
        {loading ? <article className="panel projectCard">Loading project deadlines…</article> : state.activeDeadlines.length ? state.activeDeadlines.map((deadline) => {
          const later = laterMilestones(deadline, state.milestones);
          const isEditing = editingId === deadline.milestone.milestone_id;
          return <article key={deadline.milestone.milestone_id} className={`panel projectCard ${deadline.urgency}`}>
            <div className="projectCardTop"><div><p className="eyebrow">{deadline.project.project_name}{deadline.project.project_type ? ` · ${deadline.project.project_type}` : ""}</p>{isEditing ? <input className="projectTitleInput" value={edit.milestone_name} onChange={(e) => setEdit({ ...edit, milestone_name: e.target.value })} /> : <h3>{deadline.milestone.milestone_name}</h3>}</div><strong>{dueCopy(deadline)}</strong></div>
            <div className="projectMeta">Due {isEditing ? <input type="date" value={edit.deadline_date} onChange={(e) => setEdit({ ...edit, deadline_date: e.target.value })} /> : formatDeadline(deadline.milestone.deadline_date)}</div>
            {isEditing ? <textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Notes" /> : deadline.milestone.notes ? <p>{deadline.milestone.notes}</p> : null}
            {manualAdjust?.completing.milestone.milestone_id === deadline.milestone.milestone_id && <div className="rolloverBox"><p>Adjust upcoming deadlines?</p><button onClick={() => complete(deadline, "auto")} disabled={saving}>Auto-adjust by completion offset</button><button onClick={() => complete(deadline, "none")} disabled={saving}>Do not adjust</button>{later.map((milestone) => <label key={milestone.milestone_id}>{milestone.milestone_name}<input type="date" value={manualAdjust.dates[milestone.milestone_id]} onChange={(e) => setManualAdjust({ completing: deadline, dates: { ...manualAdjust.dates, [milestone.milestone_id]: e.target.value } })} /></label>)}<button onClick={() => complete(deadline, "none", manualAdjust.dates)} disabled={saving}>Save manual dates</button></div>}
            <div className="projectActions">{isEditing ? <><button onClick={() => saveEdit(deadline)} disabled={saving}>Save changes</button><button onClick={() => setEditingId(null)}>Cancel</button></> : <><button onClick={() => startEdit(deadline)}>Edit</button><button onClick={() => later.length ? setManualAdjust({ completing: deadline, dates: Object.fromEntries(later.map((m) => [m.milestone_id, m.deadline_date])) }) : complete(deadline, "none")} disabled={saving}>Mark complete</button></>}</div>
          </article>;
        }) : <article className="panel projectCard emptyProject">No active project deadline</article>}
      </section>

      <section className="projectsList completedProjects">
        <h2>Completed / archive</h2>
        {state.completedMilestones.length ? state.completedMilestones.map((deadline) => <article key={deadline.milestone.milestone_id} className="panel projectCard completed"><div><p className="eyebrow">{deadline.project.project_name}</p><h3>{deadline.milestone.milestone_name}</h3></div><p>Completed {deadline.milestone.completed_at || "recently"} · due {formatDeadline(deadline.milestone.deadline_date)}</p></article>) : <article className="panel projectCard emptyProject">Completed milestones will collect here.</article>}
      </section>
    </main>
  );
}
