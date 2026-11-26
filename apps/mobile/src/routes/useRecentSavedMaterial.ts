import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useGeneratedReportAccess } from '../generatedReports/useGeneratedReportAccess';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { subscribeConversationVisibility } from '../storage/conversationVisibilityEvents';

import type { RecordsTabAuthority } from './useAppRootTab';
import {
  openRecentSavedRow,
  type RecentRowSelection,
} from './openRecentSavedRow';
import type { SettledRecentReceipt } from './recentSavedMaterialPageTypes';
import type { RecentPageRefresh } from './recentPageRefresh';
import {
  requestRecentSavedMaterialPage,
  type LoadRecentPage,
  type RecentPageRow,
  type RecentPageState,
  type RecentPageWitness,
} from './requestRecentSavedMaterialPage';

/** Each metadata stream owns its bounded cursor and enters the same route and privacy fences independently. */
export function useRecentSavedMaterial<Row extends RecentPageRow>(
  active: boolean,
  ownership: NavigationRouteOwnership | undefined,
  load: LoadRecentPage<Row>,
  keepPages = false,
  enabled = true,
  tabAuthority?: RecordsTabAuthority,
  subscribeChanges = subscribeConversationVisibility,
  requireBridge = false,
  subscribeOwnedChanges?: (
    current: () => boolean,
    invalidate: () => void,
  ) => () => void,
  warm?: Readonly<{
    blocked: boolean;
    publish(receipt?: SettledRecentReceipt): void;
  }>,
) {
  const route = useRef({ active, ownership });
  route.current = { active, ownership };
  const mounted = useRef(false);
  const visibilityRevision = useRef(0);
  const witnesses = useRef(new Map<Row, RecentPageWitness>());
  const pending = useRef<AbortController | null>(null);
  const forgetWitnesses = useCallback(() => {
    for (const witness of new Set(witnesses.current.values()))
      witness.dispose?.();
    witnesses.current.clear();
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      // Root tabs share a stack key; unmount is their independent liveness fence.
      mounted.current = false;
      pending.current?.abort();
      forgetWitnesses();
    };
  }, [forgetWitnesses]);
  const isMountedOwner = useCallback(
    () =>
      mounted.current &&
      route.current.active &&
      (route.current.ownership?.isCurrent() ?? true),
    [],
  );
  const captureCurrent = useCallback(() => {
    const isTabCurrent = tabAuthority?.capture();
    return () => isMountedOwner() && (isTabCurrent?.() ?? true);
  }, [isMountedOwner, tabAuthority]);
  const isRouteCurrent = captureCurrent();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [state, setState] = useState<RecentPageState>('idle');
  const [more, setMore] = useState(true);
  const [pageEpoch, setPageEpoch] = useState(0);
  const generation = useRef(0);
  const published = useRef<readonly Row[]>([]);
  const abort = useCallback(() => {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
    // A rejected pagination read must not replace the retained page on Back.
    setState(previous =>
      previous === 'loading'
        ? published.current.length
          ? 'ready'
          : 'idle'
        : previous,
    );
  }, []);
  const reset = useCallback(() => {
    visibilityRevision.current++;
    abort();
    published.current = [];
    forgetWitnesses();
    setRows([]);
    setMore(true);
    setState('idle');
    setPageEpoch(version => version + 1);
  }, [abort, forgetWitnesses]);
  const warmPublish = warm?.publish;
  const invalidate = useCallback(() => {
    warmPublish?.();
    reset();
  }, [reset, warmPublish]);
  const refuse = useCallback(() => {
    invalidate();
    setState('refused');
  }, [invalidate]);
  const { accessVersion, canAccess } = useGeneratedReportAccess(
    active && enabled,
    ownership,
    invalidate,
    abort,
    keepPages,
    warmPublish ? reset : undefined,
  );
  const previousScopedLoader = useRef(subscribeOwnedChanges ? load : undefined);
  useLayoutEffect(() => {
    const next = subscribeOwnedChanges ? load : undefined;
    if (next === previousScopedLoader.current) return;
    previousScopedLoader.current = next;
    invalidate();
  }, [load, subscribeOwnedChanges, invalidate]);
  useLayoutEffect(() => {
    if (!active || !enabled || !subscribeOwnedChanges) return;
    const current = captureCurrent();
    const revision = visibilityRevision.current;
    return subscribeOwnedChanges(
      () => revision === visibilityRevision.current && current() && canAccess(),
      invalidate,
    );
  }, [
    active,
    enabled,
    captureCurrent,
    canAccess,
    invalidate,
    pageEpoch,
    subscribeOwnedChanges,
  ]);
  // Commits can finish after the user changes tabs or before the route focuses again.
  useEffect(
    () => (enabled ? subscribeChanges(invalidate) : undefined),
    [enabled, invalidate, subscribeChanges],
  );
  useLayoutEffect(
    () => tabAuthority?.subscribe(invalidate),
    [invalidate, tabAuthority],
  );
  useEffect(() => {
    if (!enabled) return;
    const protection = conversationExecutionNative();
    if (!protection?.bridgeAvailable) return;
    return protection.subscribe(event => {
      // A warm SQLCipher handle is not evidence of the current lock state.
      if (event.kind !== 'protectedData') return;
      if (event.available) invalidate();
      else refuse();
    });
  }, [enabled, invalidate, refuse]);
  const request = useCallback(
    (before?: Row, epoch?: RecentPageRefresh) =>
      requestRecentSavedMaterialPage(
        {
          publishSettled: warmPublish,
          captureCurrent,
          canAccess,
          requireBridge,
          load,
          refuse,
          forgetWitnesses,
          pending,
          generation,
          witnesses,
          published,
          setRows,
          setMore,
          setState,
        },
        before,
        epoch,
      ),
    [
      canAccess,
      captureCurrent,
      forgetWitnesses,
      load,
      refuse,
      requireBridge,
      warmPublish,
    ],
  );
  useEffect(() => {
    if (active && enabled && !warm?.blocked && state === 'idle') request();
  }, [
    accessVersion,
    active,
    enabled,
    pageEpoch,
    request,
    state,
    warm?.blocked,
  ]);

  async function open(row: Row, select: RecentRowSelection<Row>) {
    const initial = generation.current;
    const current = () =>
      generation.current === initial && isRouteCurrent() && canAccess();
    if (!current() || !published.current.includes(row)) return;
    return openRecentSavedRow(
      row,
      select,
      current,
      () => witnesses.current.get(row),
      refuse,
    );
  }
  const pageGeneration = generation.current;
  const tail = rows[rows.length - 1];
  return {
    rows,
    pageEpoch,
    state: state === 'idle' && active && enabled ? ('loading' as const) : state,
    more,
    open,
    isRouteCurrent,
    prepareRefresh: (epoch: RecentPageRefresh) => {
      if (epoch.signal.aborted || !isRouteCurrent() || !canAccess())
        return Promise.resolve(false);
      abort();
      setPageEpoch(version => version + 1);
      return request(undefined, epoch);
    },
    loadMore: () =>
      isRouteCurrent() &&
      generation.current === pageGeneration &&
      tail === published.current[published.current.length - 1]
        ? request(tail)
        : Promise.resolve(false),
  };
}
