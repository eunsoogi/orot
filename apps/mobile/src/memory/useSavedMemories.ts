import { resumeStatementMemoryAfterRead } from './resumeStatementMemoryAfterRead';
import { reportSavedMemoryRead } from './savedMemoryReadDiagnostics';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SavedMemoryLoaderContext } from './SavedMemoryLoaderContext';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  loadUnifiedLocalMemories,
  type SavedMemory,
} from './unifiedSavedMemories';
export type { SavedMemory } from './unifiedSavedMemories';
type ReadyRead = {
  readonly rows: SavedMemory[];
  readonly request: number;
  readonly historicalDetailId?: string;
  readonly load: () => Promise<SavedMemory[]>;
  readonly isCurrent: () => boolean;
};
const READ_WAIT_MS = 10_000;
/** Shared protected read lifecycle for list and detail. Invalidations erase text before cleanup settles. */
export function useSavedMemories(
  suppliedLoad?: () => Promise<SavedMemory[]>,
  enabled = true,
  ownership?: NavigationRouteOwnership,
  historicalDetailId?: string,
) {
  const contextLoad = useContext(SavedMemoryLoaderContext);
  const load = suppliedLoad ?? contextLoad;
  const [loadedSnapshot, setRead] = useState<ReadyRead | null>(null);
  const [state, setState] = useState<
    'idle' | 'loading' | 'ready' | 'failed' | 'invalidated'
  >('idle');
  const [readOnlyRequest, setReadOnlyRequest] = useState<{
    readonly load: typeof load;
    readonly ownership: NavigationRouteOwnership | undefined;
    readonly detailId: string | undefined;
  } | null>(null);
  const generation = useRef(0);
  const active = useRef(AppState.currentState === 'active');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(() => {
    if (timer.current !== null)
      reportSavedMemoryRead('saved_memory_wait', 'cancelled');
    clearReadTimer();
    generation.current += 1;
    setRead(null);
    setState('idle');
  }, [clearReadTimer]);

  const canRead = useCallback(
    () => enabled && active.current && (ownership?.isCurrent() ?? true),
    [enabled, ownership],
  );
  const read = useCallback(
    async (resumeMaintenance: boolean) => {
      // Refuse ownership loss even before the retained route's React focus changes.
      if (!canRead()) return;
      if (timer.current !== null)
        reportSavedMemoryRead('saved_memory_wait', 'cancelled');
      clearReadTimer();
      reportSavedMemoryRead('saved_memory_wait', 'started');
      const request = ++generation.current;
      setReadOnlyRequest(
        resumeMaintenance
          ? null
          : { load, ownership, detailId: historicalDetailId },
      );
      setState('loading');
      setRead(null);
      // Bound the UI wait, not the database transaction. Never close a shared connection
      // or treat a timeout as empty storage; discard its late result and offer a fresh read.
      timer.current = setTimeout(() => {
        if (generation.current !== request) return;
        generation.current += 1;
        timer.current = null;
        reportSavedMemoryRead('saved_memory_wait', 'timeout');
        setState('failed');
      }, READ_WAIT_MS);
      try {
        const rows = await load();
        const isCurrent = () => generation.current === request && canRead();
        if (!isCurrent()) return;
        // Historical read-only access is a selected-detail capability, never a list,
        // evidence, export, or injected fixture loader capability.
        const missingCurrentSource =
          load === loadUnifiedLocalMemories &&
          historicalDetailId &&
          rows.find(
            row =>
              row.id === historicalDetailId &&
              'unavailableReason' in row &&
              row.unavailableReason,
          );
        let result = rows;
        if (missingCurrentSource) {
          const { readHistoricalSavedMemory } =
            await import('../storage/readHistoricalSavedMemory');
          if (!isCurrent()) return;
          const snapshot = await readHistoricalSavedMemory(
            missingCurrentSource.id,
            isCurrent,
          );
          if (snapshot) {
            result = rows.map(row =>
              row === missingCurrentSource
                ? { ...row, ...snapshot, historicalSnapshot: true as const }
                : row,
            );
          }
        }
        if (!isCurrent()) return;
        reportSavedMemoryRead('saved_memory_wait', 'completed');
        setRead({ rows: result, request, load, isCurrent, historicalDetailId });
        setState('ready');
        if (
          resumeMaintenance &&
          load === loadUnifiedLocalMemories &&
          !missingCurrentSource
        )
          resumeStatementMemoryAfterRead(isCurrent);
      } catch {
        if (generation.current === request && canRead()) {
          reportSavedMemoryRead('saved_memory_wait', 'failed');
          setState('failed');
        }
      } finally {
        if (generation.current === request) clearReadTimer();
      }
    },
    [load, clearReadTimer, canRead, historicalDetailId, ownership],
  );
  const refresh = useCallback(() => read(true), [read]);
  // A detail pull only reopens the saved record; it must not process queued memory.
  const refreshReadOnly = useCallback(() => read(false), [read]);

  useEffect(() => {
    // Deletion fences invalidate cached text and pending reads, even if later cleanup fails.
    // Deletion notifications do not start reads: cleanup may have failed after invalidation.
    // Clear immediately; allow explicit recovery or the existing foreground/focus reload.
    const invalidate = () => {
      close();
      if (active.current && enabled) setState('invalidated');
    };
    const unsubscribeClear = subscribeLocalDataClear(invalidate);
    const unsubscribeSource = subscribeLocalSourceDeletion(invalidate);
    let owned = ownership?.isCurrent();
    const unsubscribeOwner = ownership?.subscribe(() => {
      const next = ownership.isCurrent();
      if (next === owned) return;
      owned = next;
      // A route transition immediately revokes an issued read or row action.
      if (!next) close();
      else refresh();
    });
    // A lock can arrive while React Native still reports active and the keyed
    // connection is warm. Revoke rendered or pending local historical text.
    const protection =
      historicalDetailId && load === loadUnifiedLocalMemories
        ? conversationExecutionNative()
        : null;
    const unsubscribeProtection = protection?.bridgeAvailable
      ? protection.subscribe(event => {
          if (event.kind === 'protectedData' && !event.available) invalidate();
        })
      : undefined;
    const subscription = AppState.addEventListener('change', next => {
      active.current = enabled && next === 'active';
      if (!active.current) close();
      else refresh();
    });
    // Wait for confirmed foreground state; an unknown initial state is not permission to expose local text.
    active.current = enabled && AppState.currentState === 'active';
    if (active.current) {
      refresh();
    } else close();
    return () => {
      if (timer.current !== null)
        reportSavedMemoryRead('saved_memory_wait', 'cancelled');
      clearReadTimer();
      generation.current += 1;
      subscription.remove();
      unsubscribeOwner?.();
      unsubscribeProtection?.();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [
    refresh,
    close,
    clearReadTimer,
    enabled,
    ownership,
    historicalDetailId,
    load,
  ]);

  // The route and loader can change before passive cleanup runs. Never hand
  // their previous snapshot (or its detail capability) to the next render.
  const readyRead =
    enabled &&
    loadedSnapshot?.load === load &&
    loadedSnapshot.historicalDetailId === historicalDetailId &&
    loadedSnapshot.isCurrent()
      ? loadedSnapshot
      : null;
  return {
    rows: readyRead?.rows ?? [],
    state: state === 'ready' && !readyRead ? 'idle' : state,
    refresh,
    refreshReadOnly,
    readOnlyRefreshing:
      state === 'loading' &&
      enabled &&
      readOnlyRequest?.load === load &&
      readOnlyRequest.ownership === ownership &&
      readOnlyRequest.detailId === historicalDetailId &&
      canRead(),
    readyRead,
  };
}
