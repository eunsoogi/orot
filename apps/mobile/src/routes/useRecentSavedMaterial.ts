import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { RecentMaterialRow } from '../generatedReports/catalog';
import { loadRecentMaterial } from '../generatedReports/recentMaterialReader';
import { useGeneratedReportAccess } from '../generatedReports/useGeneratedReportAccess';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { subscribeConversationVisibility } from '../storage/conversationVisibilityEvents';
import type { ConversationExecutionAdapter } from '../ragConversation/conversationExecutionLease';

import type { RecordsTabAuthority } from './useAppRootTab';
import { recentPageSize } from './RecordsRecentTimeline';

async function isProtectedDataReadable(
  protection: ConversationExecutionAdapter,
) {
  try {
    return (await protection.protectedDataAvailable()) === true;
  } catch {
    return false;
  }
}

/** Reads bounded saved-output metadata independently from the existing document/audio feed. */
export function useRecentSavedMaterial(
  active: boolean,
  ownership: NavigationRouteOwnership | undefined,
  load = loadRecentMaterial,
  keepPages = false,
  enabled = true,
  tabAuthority?: RecordsTabAuthority,
) {
  const route = useRef({ active, ownership });
  route.current = { active, ownership };
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      // Root tabs share a stack key; unmount is their independent liveness fence.
      mounted.current = false;
    };
  }, []);
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
  const [rows, setRows] = useState<readonly RecentMaterialRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  );
  const [more, setMore] = useState(true);
  const [tabVersion, setTabVersion] = useState(0);
  const generation = useRef(0);
  const published = useRef<readonly RecentMaterialRow[]>([]);
  const pending = useRef<AbortController | null>(null);
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
  const invalidate = useCallback(() => {
    abort();
    published.current = [];
    setRows([]);
    setMore(true);
    setState('idle');
  }, [abort]);
  const refuse = useCallback(() => {
    invalidate();
    setState('failed');
  }, [invalidate]);
  const { accessVersion, canAccess } = useGeneratedReportAccess(
    active && enabled,
    ownership,
    invalidate,
    abort,
    keepPages,
  );

  // Session hides can commit after a tab switch, without a source-deletion event.
  useEffect(() => subscribeConversationVisibility(invalidate), [invalidate]);
  useLayoutEffect(
    () =>
      tabAuthority?.subscribe(() => {
        invalidate();
        setTabVersion(version => version + 1);
      }),
    [invalidate, tabAuthority],
  );

  useEffect(() => {
    const protection = conversationExecutionNative();
    if (!protection?.bridgeAvailable) return;
    return protection.subscribe(event => {
      // A warm SQLCipher handle is not evidence of the current lock state.
      if (event.kind !== 'protectedData') return;
      if (event.available) invalidate();
      else refuse();
    });
  }, [invalidate, refuse]);

  const request = useCallback(
    async (before?: RecentMaterialRow) => {
      const inTab = captureCurrent();
      if (!inTab() || !canAccess() || pending.current) return false;
      const operation = new AbortController();
      pending.current = operation;
      const current = () => inTab() && canAccess() && !operation.signal.aborted;
      const protection = conversationExecutionNative();
      try {
        setState('loading');
        if (!protection?.bridgeAvailable) {
          setMore(false);
          setState('ready');
          return false;
        }
        const admitted = await isProtectedDataReadable(protection);
        if (!current()) return false;
        if (!admitted) {
          refuse();
          return false;
        }
        const page = await load(
          before && { createdAt: before.createdAt, key: before.key },
        );
        if (!current()) return false;
        const remaining = await isProtectedDataReadable(protection);
        if (!current()) return false;
        if (!remaining) {
          refuse();
          return false;
        }
        published.current = before ? [...published.current, ...page] : page;
        setRows(published.current);
        setMore(page.length === recentPageSize);
        setState('ready');
        return true;
      } catch {
        if (current()) setState('failed');
        return false;
      } finally {
        if (pending.current === operation) pending.current = null;
      }
    },
    [canAccess, captureCurrent, load, refuse],
  );

  useEffect(() => {
    if (active && enabled && state === 'idle') request();
  }, [accessVersion, active, enabled, request, state, tabVersion]);

  /** A press already queued before a deletion or native lock cannot open its old selection. */
  async function open(
    row: RecentMaterialRow,
    select: (value: RecentMaterialRow) => void,
  ) {
    const initial = generation.current;
    const current = () =>
      generation.current === initial && isRouteCurrent() && canAccess();
    if (!current() || !published.current.includes(row)) return;
    const protection = conversationExecutionNative();
    const admitted = Boolean(
      protection?.bridgeAvailable &&
      (await isProtectedDataReadable(protection)),
    );
    if (!current()) return;
    if (admitted) select(row);
    else refuse();
  }

  return {
    rows,
    state,
    more,
    open,
    isRouteCurrent,
    loadMore: () =>
      isRouteCurrent()
        ? request(rows[rows.length - 1])
        : Promise.resolve(false),
  };
}
