/** Retains ownership of failed protected-file deletions until they can be retried. */
export function createConversationPhotoCleanup<T>(
  remove: (photo: T) => Promise<void>,
  notify: () => void,
) {
  const active = new Map<T, Promise<void>>();
  const retired = new Map<number, Map<T, boolean>>();
  // Replacement and session removal may refer to the same original concurrently.
  const discard = (photo: T) => {
    const pending = active.get(photo);
    if (pending) return pending;
    const result = remove(photo).finally(() => active.delete(photo));
    active.set(photo, result);
    return result;
  };
  const retire = async (id: number, photo: T) => {
    let pending = retired.get(id);
    if (!pending) {
      pending = new Map<T, boolean>();
      retired.set(id, pending);
    }
    if (!pending.has(photo)) pending.set(photo, false);
    try {
      await discard(photo);
    } catch (error) {
      pending.set(photo, true);
      notify();
      throw error;
    }
    pending.delete(photo);
    if (!pending.size) retired.delete(id);
    notify();
  };
  const retireAll = async (id: number, photos: readonly T[]) => {
    const results = await Promise.allSettled(
      photos.map(photo => retire(id, photo)),
    );
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  };
  const hasFailure = (id: number) =>
    [...(retired.get(id)?.values() ?? [])].some(Boolean);
  return {
    discard,
    retire,
    retireAll,
    retry: (id: number) => retireAll(id, [...(retired.get(id)?.keys() ?? [])]),
    pendingIds: () => [...retired.keys()],
    hasFailure,
    failedIds: () => [...retired.keys()].filter(hasFailure),
  };
}
