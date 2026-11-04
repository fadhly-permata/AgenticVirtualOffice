const BUSY = new Set(['busy', 'retry']);

/**
 * Bridge yang tidak menyebut pemilik sesi di `/session/status` (OpenCode) membuat
 * kursi bergantung pada event stream, yang bisa hilang. Daftar sesi menutup lobangnya.
 */
export async function withSessionOwners(statuses, loadSessions) {
  const ownerless = Object.entries(statuses ?? {}).filter(
    ([, status]) => BUSY.has(status?.type) && !status?.agent
  );
  if (!ownerless.length) return statuses ?? {};

  const sessions = await loadSessions().catch(() => []);
  const owners = new Map(
    (Array.isArray(sessions) ? sessions : [])
      .filter((session) => session && typeof session.id === 'string')
      .map((session) => [session.id, session])
  );

  const next = { ...statuses };
  for (const [id] of ownerless) {
    const session = owners.get(id);
    if (!session) continue;
    next[id] = { ...next[id], agent: session.agent ?? null, parentID: session.parentID ?? null };
  }
  return next;
}
