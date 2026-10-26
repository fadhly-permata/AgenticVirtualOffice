export type PresenceRole = 'working' | 'delegating' | 'delegated' | 'idle';

export interface RosterAgent {
  name: string;
  mode: 'primary' | 'subagent';
  description?: string;
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

    const hasBusyChild = sessions.some((child) => child.busy && child.parentID === session.id);
    const underBusyParent = session.parentID !== null && busyIDs.has(session.parentID);

    const role: PresenceRole = hasBusyChild ? 'delegating' : underBusyParent ? 'delegated' : 'working';
    const current = roleByAgent.get(session.agent);
    if (!current || RANK[role] > RANK[current.role]) {
      roleByAgent.set(session.agent, { agent: session.agent, role, sessionID: session.id });
    }
  }

  return agents.map((agent) => roleByAgent.get(agent.name) ?? { agent: agent.name, role: 'idle', sessionID: null });
}
