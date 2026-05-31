import { addDaysToYmd, localTodayYmd } from "@/lib/writing";

export type ProjectStatus = "active" | "completed" | "archived";
export type MilestoneStatus = "active" | "completed" | "archived";
export type ProjectEventType =
  | "create_project"
  | "update_project"
  | "archive_project"
  | "add_milestone"
  | "update_milestone"
  | "complete_milestone"
  | "change_deadline";

export type ProjectEvent = {
  event_id: string;
  timestamp: string;
  event_type: ProjectEventType;
  project_id: string;
  milestone_id?: string;
  payload: Record<string, unknown>;
};

export type Project = {
  project_id: string;
  project_name: string;
  project_type: string;
  status: ProjectStatus;
  created_at: string;
  archived_at?: string;
  notes: string;
};

export type Milestone = {
  milestone_id: string;
  project_id: string;
  milestone_name: string;
  deadline_date: string;
  status: MilestoneStatus;
  completed_at?: string;
  created_at: string;
  notes: string;
  sort_order: number;
};

export type ProjectDeadline = {
  project: Project;
  milestone: Milestone;
  daysUntil: number;
  urgency: "overdue" | "today" | "soon" | "future";
};

export type ProjectState = {
  projects: Project[];
  milestones: Milestone[];
  activeDeadlines: ProjectDeadline[];
  completedMilestones: ProjectDeadline[];
  nextDeadline: ProjectDeadline | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function status(value: unknown, fallback: ProjectStatus = "active"): ProjectStatus {
  return value === "completed" || value === "archived" || value === "active" ? value : fallback;
}

function milestoneStatus(value: unknown, fallback: MilestoneStatus = "active"): MilestoneStatus {
  return value === "completed" || value === "archived" || value === "active" ? value : fallback;
}

export function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

export function createProjectEvent(
  event_type: ProjectEventType,
  project_id: string,
  milestone_id: string | undefined,
  payload: Record<string, unknown>,
  now = new Date()
): ProjectEvent {
  const cryptoObj = globalThis.crypto;
  const random = cryptoObj?.randomUUID ? cryptoObj.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    event_id: random,
    timestamp: now.toISOString(),
    event_type,
    project_id,
    milestone_id,
    payload
  };
}

export function reduceProjectEvents(events: ProjectEvent[], today = localTodayYmd()): ProjectState {
  const projects = new Map<string, Project>();
  const milestones = new Map<string, Milestone>();

  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const p = event.payload || {};
    if (event.event_type === "create_project") {
      projects.set(event.project_id, {
        project_id: event.project_id,
        project_name: str(p.project_name) || "Untitled project",
        project_type: str(p.project_type),
        status: status(p.status),
        created_at: str(p.created_at) || event.timestamp,
        notes: str(p.notes)
      });
    } else if (event.event_type === "update_project") {
      const project = projects.get(event.project_id);
      if (project) {
        projects.set(event.project_id, {
          ...project,
          project_name: str(p.project_name) || project.project_name,
          project_type: str(p.project_type) || project.project_type,
          notes: p.notes == null ? project.notes : str(p.notes),
          status: status(p.status, project.status)
        });
      }
    } else if (event.event_type === "archive_project") {
      const project = projects.get(event.project_id);
      if (project) projects.set(event.project_id, { ...project, status: "archived", archived_at: str(p.archived_at) || event.timestamp });
    } else if (event.event_type === "add_milestone" && event.milestone_id) {
      milestones.set(event.milestone_id, {
        milestone_id: event.milestone_id,
        project_id: event.project_id,
        milestone_name: str(p.milestone_name) || "Untitled milestone",
        deadline_date: str(p.deadline_date),
        status: milestoneStatus(p.status),
        completed_at: str(p.completed_at),
        created_at: str(p.created_at) || event.timestamp,
        notes: str(p.notes),
        sort_order: Number(p.sort_order ?? milestones.size)
      });
    } else if (event.event_type === "update_milestone" && event.milestone_id) {
      const milestone = milestones.get(event.milestone_id);
      if (milestone) {
        milestones.set(event.milestone_id, {
          ...milestone,
          milestone_name: str(p.milestone_name) || milestone.milestone_name,
          notes: p.notes == null ? milestone.notes : str(p.notes),
          sort_order: Number(p.sort_order ?? milestone.sort_order),
          status: milestoneStatus(p.status, milestone.status),
          completed_at: p.completed_at == null ? milestone.completed_at : str(p.completed_at) || undefined
        });
      }
    } else if (event.event_type === "change_deadline" && event.milestone_id) {
      const milestone = milestones.get(event.milestone_id);
      if (milestone && str(p.deadline_date)) milestones.set(event.milestone_id, { ...milestone, deadline_date: str(p.deadline_date) });
    } else if (event.event_type === "complete_milestone" && event.milestone_id) {
      const milestone = milestones.get(event.milestone_id);
      if (milestone) milestones.set(event.milestone_id, { ...milestone, status: "completed", completed_at: str(p.completed_at) || today });
    }
  }

  const projectList = [...projects.values()];
  const milestoneList = [...milestones.values()].sort((a, b) => a.deadline_date.localeCompare(b.deadline_date) || a.sort_order - b.sort_order);
  const projectById = new Map(projectList.map((p) => [p.project_id, p]));

  const activeDeadlines = milestoneList
    .filter((m) => m.status === "active" && m.deadline_date)
    .map((milestone) => {
      const project = projectById.get(milestone.project_id);
      if (!project || project.status === "archived" || project.status === "completed") return null;
      const daysUntil = daysBetweenYmd(milestone.deadline_date, today);
      const urgency = daysUntil < 0 ? "overdue" : daysUntil === 0 ? "today" : daysUntil <= 5 ? "soon" : "future";
      return { project, milestone, daysUntil, urgency } satisfies ProjectDeadline;
    })
    .filter(Boolean) as ProjectDeadline[];

  activeDeadlines.sort((a, b) => {
    if (a.daysUntil < 0 && b.daysUntil >= 0) return -1;
    if (b.daysUntil < 0 && a.daysUntil >= 0) return 1;
    return a.milestone.deadline_date.localeCompare(b.milestone.deadline_date);
  });

  const completedMilestones = milestoneList
    .filter((m) => m.status === "completed")
    .map((milestone) => {
      const project = projectById.get(milestone.project_id);
      if (!project) return null;
      return { project, milestone, daysUntil: daysBetweenYmd(milestone.deadline_date, today), urgency: "future" } satisfies ProjectDeadline;
    })
    .filter(Boolean)
    .sort((a, b) => (b!.milestone.completed_at || "").localeCompare(a!.milestone.completed_at || "")) as ProjectDeadline[];

  return {
    projects: projectList,
    milestones: milestoneList,
    activeDeadlines,
    completedMilestones,
    nextDeadline: activeDeadlines[0] || null
  };
}

export function offsetYmd(day: string, offset: number): string {
  return addDaysToYmd(day, offset);
}

export function localProjectToday(date = new Date()): string {
  return localTodayYmd(date);
}
