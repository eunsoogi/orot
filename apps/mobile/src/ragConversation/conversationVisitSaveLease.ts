/** One in-flight write per message survives presentation unmounts without retaining completed data. */
const pending = new WeakMap<object, Set<string>>();

export async function withConversationVisitSave<T>(
  owner: object,
  key: string,
  work: () => Promise<T>,
): Promise<{ status: 'busy' } | { status: 'finished'; value: T }> {
  let active = pending.get(owner);
  if (!active) {
    active = new Set();
    pending.set(owner, active);
  }
  if (active.has(key)) return { status: 'busy' };
  active.add(key);
  try {
    return { status: 'finished', value: await work() };
  } finally {
    active.delete(key);
  }
}
