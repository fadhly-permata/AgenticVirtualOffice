export type PresenceRole = 'working' | 'delegating' | 'delegated' | 'idle';

export interface RosterAgent {
  name: string;
  mode: 'primary' | 'subagent';
  description?: string;
}

/** One employee on the office floor, named after the agent it represents. */
export interface CrewEntry {
  id: string;
  label: string;
}

/** Normalised run state for one session, from whichever agentic tool is attached. */
export interface SessionActivity {
  id: string;
  agent: string | null;
  parentID: string | null;
  busy: boolean;
}

export interface Presence {
  agent: string;
  role: PresenceRole;
  /** The busy session behind this role, so the caller can attach live reasoning to it. */
  sessionID: string | null;
}

const RANK: Record<PresenceRole, number> = {
  delegating: 3,
  delegated: 2,
  working: 1,
  idle: 0,
};

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Turns an agent catalogue into the people standing on the office floor.
 * Order is kept because the first entries get the desks; entries past the
 * seat plan are reported by the office API as overflow.
 */
export function crewFromRoster(agents: { name: string }[]): CrewEntry[] {
  const crew: CrewEntry[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    const id = slugify(agent.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    crew.push({ id, label: agent.name });
  }

  return crew;
}

export interface SessionRecord {
  id: string;
  agent: string | null;
  parentID: string | null;
}

/** A session in retry is still holding a chair: it is working, just badly. */
export function isBusyStatus(type: string | undefined): boolean {
  return type === 'busy' || type === 'retry';
}

export function sessionActivities(
  sessions: SessionRecord[],
  statuses: Record<string, { type?: string }>,
): SessionActivity[] {
  return sessions.map((session) => ({
    id: session.id,
    agent: session.agent ? slugify(session.agent) : null,
    parentID: session.parentID,
    busy: isBusyStatus(statuses[session.id]?.type),
  }));
}

/**
 * Turns a tool's session table into "what is each agent doing right now".
 * A session with a busy child is delegating; a busy session whose parent is
 * still busy is the one being delegated to.
 */
export function buildPresence(agents: RosterAgent[], sessions: SessionActivity[]): Presence[] {
  const busy = sessions.filter((session) => session.busy);
  const busyIDs = new Set(busy.map((session) => session.id));
  const roleByAgent = new Map<string, Presence>();

  for (const session of busy) {
    if (!session.agent) continue;
    const id = slugify(session.agent);

    const hasBusyChild = sessions.some((child) => child.busy && child.parentID === session.id);
    const underBusyParent = session.parentID !== null && busyIDs.has(session.parentID);

    const role: PresenceRole = hasBusyChild ? 'delegating' : underBusyParent ? 'delegated' : 'working';
    const current = roleByAgent.get(id);
    if (!current || RANK[role] > RANK[current.role]) {
      roleByAgent.set(id, { agent: id, role, sessionID: session.id });
    }
  }

  return agents.map((agent) => {
    const id = slugify(agent.name);
    return roleByAgent.get(id) ?? { agent: id, role: 'idle', sessionID: null };
  });
}
