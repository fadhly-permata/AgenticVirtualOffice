import { describe, expect, it } from 'vitest';
import { type Presence, type SessionActivity, buildPresence } from '../src/office/presence';

const roster = [
  { name: 'build', mode: 'primary' as const },
  { name: 'plan', mode: 'primary' as const },
  { name: 'qa-engineer', mode: 'subagent' as const },
];

function session(id: string, agent: string | null, parentID: string | null, busy: boolean): SessionActivity {
  return { id, agent, parentID, busy };
}

function roleOf(presence: Presence[], agent: string): Presence | undefined {
  return presence.find((entry) => entry.agent === agent);
}

describe('presence engine', () => {
  it('marks every roster agent idle when no session runs', () => {
    const presence = buildPresence(roster, [session('a', 'build', null, false)]);
    expect(presence).toHaveLength(3);
    expect(presence.every((entry) => entry.role === 'idle' && entry.sessionID === null)).toBe(true);
  });

  it('seats a root session that has no busy child as working', () => {
    const presence = buildPresence(roster, [session('a', 'build', null, true)]);
    expect(roleOf(presence, 'build')).toEqual({ agent: 'build', role: 'working', sessionID: 'a' });
  });

  it('calls the parent delegating and the child delegated', () => {
    const presence = buildPresence(roster, [
      session('parent', 'build', null, true),
      session('child', 'qa-engineer', 'parent', true),
    ]);
    expect(roleOf(presence, 'build')?.role).toBe('delegating');
    expect(roleOf(presence, 'qa-engineer')?.role).toBe('delegated');
    expect(roleOf(presence, 'qa-engineer')?.sessionID).toBe('child');
  });

  it('treats a busy child of an idle parent as working on its own', () => {
    const presence = buildPresence(roster, [
      session('parent', 'build', null, false),
      session('child', 'qa-engineer', 'parent', true),
    ]);
    expect(roleOf(presence, 'build')?.role).toBe('idle');
    expect(roleOf(presence, 'qa-engineer')?.role).toBe('working');
  });

  it('keeps the busiest role when one agent runs several sessions', () => {
    const presence = buildPresence(roster, [
      session('plain', 'build', null, true),
      session('parent', 'build', null, true),
      session('child', 'qa-engineer', 'parent', true),
    ]);
    expect(roleOf(presence, 'build')?.role).toBe('delegating');
    expect(roleOf(presence, 'build')?.sessionID).toBe('parent');
  });

  it('ignores sessions that do not name an agent', () => {
    const presence = buildPresence(roster, [session('ghost', null, null, true)]);
    expect(presence.every((entry) => entry.role === 'idle')).toBe(true);
  });
});
