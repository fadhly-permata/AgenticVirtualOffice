import { ACTIVITY_LABEL } from './agents/activities';
import type { Agent } from './agents/agent';
import type { DayCycle } from './core/dayNight';
import { type ActivityId, type RoomId, SPOTS } from './world/layout';

export interface AgentSnapshot {
  id: string;
  name: string;
  activity: ActivityId;
  activityLabel: string;
  state: 'walking' | 'settled';
  room: RoomId;
  spot: string;
}

/**
 * Small surface the future OpenCode bridge can call. For now it is exposed on
 * `window.virtOffice` so a local script, browser extension or WebSocket shim
 * can drive the agents without touching the scene code.
 */
export interface VirtOfficeApi {
  readonly ready: true;
  agents(): AgentSnapshot[];
  setActivity(agentId: string, activity: ActivityId): boolean;
  release(agentId: string): boolean;
  setTimeOfDay(hours: number): void;
  setTimeScale(hoursPerSecond: number): void;
}

export function installApi(agents: Agent[], clock: DayCycle): VirtOfficeApi {
  const find = (key: string): Agent | undefined =>
    agents.find((agent) => agent.id === key || agent.name.toLowerCase() === key.toLowerCase());

  const api: VirtOfficeApi = {
    ready: true,

    agents: () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        activity: agent.spot.activity,
        activityLabel: ACTIVITY_LABEL[agent.spot.activity],
        state: agent.mode,
        room: agent.spot.room,
        spot: agent.spot.id,
      })),

    setActivity: (agentId, activity) => {
      const agent = find(agentId);
      if (!agent) return false;

      const taken = new Set(agents.filter((other) => other !== agent).map((other) => other.spot.id));
      const target = SPOTS.find((candidate) => candidate.activity === activity && !taken.has(candidate.id));
      if (!target) return false;

      agent.pinned = true;
      agent.assign(target, Number.POSITIVE_INFINITY);
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
