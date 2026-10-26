import { ACTIVITY_LABEL } from './agents/activities';
import type { Agent, AgentSignal } from './agents/agent';
import type { DayCycle } from './core/dayNight';
import type { CrewEntry, Presence, PresenceRole } from './office/presence';
import { type ActivityId, type RoomId, SPOTS } from './world/layout';

export interface AgentSnapshot {
  id: string;
  name: string;
  activity: ActivityId;
  activityLabel: string;
  state: 'walking' | 'settled';
  signal: AgentSignal | null;
  room: RoomId;
  spot: string;
}

/**
 * The scene side of the roster: adding or removing a person means building or
 * destroying meshes and HUD rows, which the API layer must not know about.
 */
export interface CrewFactory {
  add(entry: CrewEntry, index: number): Agent | null;
  remove(agent: Agent): void;
}

type BusyRole = Exclude<PresenceRole, 'idle'>;

/** Working agents take a desk; a delegation, from either side, takes the meeting table. */
const ROLE_ACTIVITY: Record<BusyRole, ActivityId> = {
  working: 'working',
  delegating: 'meeting',
  delegated: 'meeting',
};

const ROLE_SIGNAL: Record<BusyRole, AgentSignal> = {
  working: 'writing',
  delegating: 'tool',
  delegated: 'thinking',
};

/**
 * Small surface the OpenCode bridge calls. It is exposed on `window.virtOffice`
 * so a local script, browser extension or WebSocket shim can drive the agents
 * without touching the scene code.
 */
export interface VirtOfficeApi {
  readonly ready: true;
  agents(): AgentSnapshot[];
  setCrew(entries: CrewEntry[]): boolean;
  applyPresence(presence: Presence[]): void;
  setActivity(agentId: string, activity: ActivityId): boolean;
  setAgentSignal(agentId: string, signal: AgentSignal | null): boolean;
  release(agentId: string): boolean;
  setTimeOfDay(hours: number): void;
  setTimeScale(hoursPerSecond: number): void;
}

export function installApi(agents: Agent[], clock: DayCycle, crew?: CrewFactory): VirtOfficeApi {
  const find = (key: string): Agent | undefined =>
    agents.find((agent) => agent.id === key || agent.name.toLowerCase() === key.toLowerCase());

  const seat = (agent: Agent, activity: ActivityId): boolean => {
    const taken = new Set(agents.filter((other) => other !== agent).map((other) => other.spot.id));
    const target = SPOTS.find((candidate) => candidate.activity === activity && !taken.has(candidate.id));
    if (!target) return false;

    agent.pinned = true;
    agent.assign(target, Number.POSITIVE_INFINITY);
    return true;
  };

  const api: VirtOfficeApi = {
    ready: true,

    agents: () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        activity: agent.spot.activity,
        activityLabel: ACTIVITY_LABEL[agent.spot.activity],
        state: agent.mode,
        signal: agent.signal,
        room: agent.spot.room,
        spot: agent.spot.id,
      })),

    setCrew: (entries) => {
      if (!crew) return false;

      const wanted = new Set(entries.map((entry) => entry.id));
      for (const agent of [...agents]) {
        if (wanted.has(agent.id)) continue;
        crew.remove(agent);
        agents.splice(agents.indexOf(agent), 1);
      }

      entries.forEach((entry, index) => {
        if (find(entry.id)) return;
        const agent = crew.add(entry, index);
        if (agent) agents.push(agent);
      });

      return agents.length > 0;
    },

    applyPresence: (presence) => {
      for (const entry of presence) {
        const agent = find(entry.agent);
        if (!agent) continue;

        if (entry.role === 'idle') {
          agent.setSignal(null);
          agent.release();
          continue;
        }

        const activity = ROLE_ACTIVITY[entry.role];
        // Re-seating an agent that is already in the right room would restart its walk.
        if (!agent.pinned || agent.activity !== activity) seat(agent, activity);
        agent.setSignal(ROLE_SIGNAL[entry.role]);
      }
    },

    setActivity: (agentId, activity) => {
      const agent = find(agentId);
      if (!agent) return false;
      return seat(agent, activity);
    },

    setAgentSignal: (agentId, signal) => {
      const agent = find(agentId);
      if (!agent) return false;
      agent.setSignal(signal);
      return true;
    },

    release: (agentId) => {
      const agent = find(agentId);
      if (!agent) return false;
      agent.release();
      return true;
    },

    setTimeOfDay: (hours) => {
      clock.setTime(hours);
    },

    setTimeScale: (hoursPerSecond) => {
      clock.setSpeed(hoursPerSecond);
    },
  };

  (window as Window & { virtOffice?: VirtOfficeApi }).virtOffice = api;
  return api;
}
