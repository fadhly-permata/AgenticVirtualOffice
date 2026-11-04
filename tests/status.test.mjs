import { describe, expect, it, vi } from 'vitest';
import { withSessionOwners } from '../server/status.mjs';

const sessions = [
  { id: 'ses_parent', agent: 'build', parentID: null },
  { id: 'ses_child', agent: 'explore', parentID: 'ses_parent' },
];

describe('withSessionOwners', () => {
  it('names the owner of a busy status that only reports a type', async () => {
    const out = await withSessionOwners({ ses_child: { type: 'busy' } }, async () => sessions);
    expect(out.ses_child).toEqual({ type: 'busy', agent: 'explore', parentID: 'ses_parent' });
  });

  it('treats a retrying session as still holding a chair', async () => {
    const out = await withSessionOwners(
      { ses_parent: { type: 'retry', attempt: 4, message: 'Cannot connect to API' } },
      async () => sessions
    );
    expect(out.ses_parent.agent).toBe('build');
    expect(out.ses_parent.attempt).toBe(4);
  });

  it('asks no questions when the bridge already names every owner', async () => {
    const load = vi.fn(async () => sessions);
    const out = await withSessionOwners(
      { ses_child: { type: 'busy', agent: 'Explore', parentID: 'ses_parent' } },
      load
    );
    expect(load).not.toHaveBeenCalled();
    expect(out.ses_child.agent).toBe('Explore');
  });

  it('keeps the status when the session list fails or misses the id', async () => {
    expect(await withSessionOwners({ ses_x: { type: 'busy' } }, () => Promise.reject(new Error('down')))).toEqual({
      ses_x: { type: 'busy' },
    });
    expect(await withSessionOwners({ ses_x: { type: 'busy' } }, async () => sessions)).toEqual({
      ses_x: { type: 'busy' },
    });
  });

  it('leaves idle statuses alone', async () => {
    const load = vi.fn(async () => sessions);
    expect(await withSessionOwners({ ses_child: { type: 'idle' } }, load)).toEqual({ ses_child: { type: 'idle' } });
    expect(load).not.toHaveBeenCalled();
  });
});
