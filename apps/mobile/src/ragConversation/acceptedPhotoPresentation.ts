import type { DirectPhotoPresentation } from './directPhotoPresentation';

type Entry = Readonly<{
  token: AbortController;
  photo: DirectPhotoPresentation;
}>;

/** Only an accepted and still-running outgoing photo can leave the mounted
 * route. The registry retains no completed images and never admits transport. */
const byOwner = new WeakMap<
  object,
  ReturnType<typeof createAcceptedPhotoPresentation>
>();
function createAcceptedPhotoPresentation() {
  let entry: Entry | null = null;
  let unleased: { sessionId: number; token: AbortController } | null = null;
  let interruption: number | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const retire = (token: AbortController) => {
    if (entry?.token !== token) return;
    entry = null;
    notify();
  };
  return {
    getInterruption: () => interruption,
    clearInterruption(sessionId: number) {
      if (interruption !== sessionId) return;
      interruption = null;
      notify();
    },
    interrupt(token: AbortController) {
      if (entry?.token !== token) return;
      interruption = entry.photo.sessionId;
      token.abort();
    },
    // Remember only the exact started unleased request identity. It never owns
    // a sending row or pixels outside its scene; a real interruption can explain its disappearance.
    observeUnleased(sessionId: number, token: AbortController) {
      unleased = { sessionId, token };
      return () => {
        if (unleased?.token === token) unleased = null;
      };
    },
    interruptUnleased(token: AbortController) {
      if (unleased?.token !== token || token.signal.aborted) return;
      interruption = unleased.sessionId;
      unleased = null;
      notify();
    },
    getSnapshot: () => entry?.photo ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    accept(photo: DirectPhotoPresentation, token: AbortController) {
      if (!photo.pending || entry || token.signal.aborted) return;
      const close = () => {
        token.signal.removeEventListener('abort', close);
        retire(token);
      };
      interruption = null;
      entry = { photo, token };
      token.signal.addEventListener('abort', close, { once: true });
      notify();
      return {
        current: () => entry?.token === token && !token.signal.aborted,
        close,
      };
    },
    stop(sessionId: number) {
      if (entry?.photo.sessionId !== sessionId) return false;
      const { token } = entry;
      token.abort();
      retire(token);
      return true;
    },
    stopAll() {
      const current = entry;
      const local = unleased?.token;
      unleased = null;
      interruption = null;
      local?.abort();
      if (current) current.token.abort();
      else notify();
    },
  };
}

export function acceptedPhotoPresentation(ownerKey: object) {
  const existing = byOwner.get(ownerKey);
  if (existing) return existing;
  const created = createAcceptedPhotoPresentation();
  byOwner.set(ownerKey, created);
  return created;
}

/** The policy facade and session store agree on this one app-owned identity. */
export function retireAcceptedPhotoPresentation(ownerKey: object) {
  byOwner.get(ownerKey)?.stopAll();
}
