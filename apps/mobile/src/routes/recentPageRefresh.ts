export interface PreparedRecentPage {
  readonly isCurrent: () => boolean;
  readonly verify: () => Promise<boolean>;
  readonly publish: () => void;
  readonly release: () => void;
}

export interface RecentPageRefresh {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
  readonly fail: () => void;
  readonly stage: (page: PreparedRecentPage) => void;
}

export type RefreshRecentStream = (
  epoch: RecentPageRefresh,
) => Promise<boolean>;

/** All required streams must settle before a new first-page frontier is exposed. */
export async function refreshRecentPages(
  starts: readonly RefreshRecentStream[],
  didPublish: () => void,
  didFail: () => void,
) {
  const prepared: PreparedRecentPage[] = [];
  const owner = new AbortController();
  const epoch: RecentPageRefresh = {
    signal: owner.signal,
    cancel: () => owner.abort(),
    fail: () => {
      didFail();
      owner.abort();
    },
    stage: page => prepared.push(page),
  };
  const stopped = new Promise<false>(resolve =>
    owner.signal.addEventListener('abort', () => resolve(false), {
      once: true,
    }),
  );
  try {
    const loaded = await Promise.race([
      Promise.all(starts.map(start => start(epoch))),
      stopped,
    ]);
    if (!loaded || !loaded.every(Boolean)) return;
    const verified = await Promise.race([
      Promise.all(prepared.map(page => page.verify())),
      stopped,
    ]);
    if (
      !verified ||
      !verified.every(Boolean) ||
      epoch.signal.aborted ||
      !prepared.every(page => page.isCurrent())
    )
      return;
    // No await between the final ownership check, both publications and the new depth.
    for (const page of prepared) page.publish();
    didPublish();
  } finally {
    for (const page of prepared) page.release();
    epoch.cancel();
  }
}

export function linkRecentRefresh(
  epoch: RecentPageRefresh,
  operation: AbortController,
  release: () => void,
) {
  // Each cursor retains its native signal. One retirement cancels only the sibling reads in this epoch.
  const cancel = () => {
    operation.abort();
    release();
  };
  epoch.signal.addEventListener('abort', cancel, { once: true });
  operation.signal.addEventListener('abort', epoch.cancel, { once: true });
  return () => {
    epoch.signal.removeEventListener('abort', cancel);
    operation.signal.removeEventListener('abort', epoch.cancel);
  };
}
