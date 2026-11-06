type StructuralValue = string | boolean | null | readonly (string | null)[];
type Observation = Readonly<Record<string, StructuralValue | number>>;
let observer: ((observation: Observation) => void) | undefined;
type CurrentRouteState = {
  readonly generation?: number;
  readonly logicalKeys: readonly string[];
  readonly currentRouteKey: string;
  readonly currentRouteName: string;
  readonly ready: boolean;
  readonly nativeKeys: readonly (string | null)[] | null;
};
const readers = new Map<string, () => CurrentRouteState>();
let readerSequence = 0;

/** The test entry alone installs this sink; production never loads the native test bridge. */
export function registerNavigationTestObserver(
  next: (observation: Observation) => void,
) {
  observer = next;
  return () => {
    if (observer === next) {
      observer = undefined;
      readers.clear();
    }
  };
}

/** Test entries read live stack state; absent observers never register readers. */
export function registerNavigationTestStateReader(
  read: () => CurrentRouteState,
) {
  if (!observer) return { stackID: null, unregister: () => {} };
  const stackID = `stack-${++readerSequence}`;
  readers.set(stackID, read);
  return {
    stackID,
    unregister: () => {
      if (readers.get(stackID) === read) readers.delete(stackID);
    },
  };
}

export function readNavigationTestState() {
  if (!observer || readers.size === 0)
    return { status: 'unavailable' as const };
  if (readers.size !== 1) return { status: 'ambiguous' as const };
  const [stackID, read] = [...readers.entries()][0]!;
  try {
    return { status: 'single' as const, stackID, state: read() };
  } catch {
    return { status: 'unavailable' as const };
  }
}

/** Keep native and JS samples separate when navigation changes across the asynchronous bridge. */
export async function captureNavigationTestSnapshot(
  readNative: () => Promise<unknown>,
) {
  const startedAtMs = Date.now();
  const before = readNavigationTestState();
  const native = await readNative();
  const after = readNavigationTestState();
  const endedAtMs = Date.now();
  const status =
    before.status !== 'single'
      ? before.status
      : after.status !== 'single'
        ? after.status
        : JSON.stringify(before) === JSON.stringify(after)
          ? 'consistent'
          : 'changed';
  return {
    ...(native !== null && typeof native === 'object' ? native : {}),
    routeState: { status, before, after, startedAtMs, endedAtMs },
  };
}

/** Structural keys and fixed event names only: no route content or user data. */
export function observeNavigationTest(
  event: string,
  fields: Readonly<Record<string, StructuralValue>>,
) {
  if (!observer) return;
  try {
    observer({ event, ...fields, atMs: Date.now() });
  } catch {
    // A diagnostic must never alter the route's permission or transition result.
  }
}
