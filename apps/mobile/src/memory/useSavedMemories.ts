import { resumeStatementMemoryAfterRead } from './resumeStatementMemoryAfterRead';
import { reportSavedMemoryRead } from './savedMemoryReadDiagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  loadUnifiedLocalMemories,
  type SavedMemory,
} from './unifiedSavedMemories';
export type { SavedMemory } from './unifiedSavedMemories';
const READ_WAIT_MS = 10_000;
/** Shared protected read lifecycle for list and detail. Invalidations erase text before cleanup settles. */
export function useSavedMemories(
  load: () => Promise<SavedMemory[]> = loadUnifiedLocalMemories,
  enabled = true,
) {
  const [rows, setRows] = useState<SavedMemory[]>([]);
  const [state, setState] = useState<
    'idle' | 'loading' | 'ready' | 'failed' | 'invalidated'
  >('idle');
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
    setRows([]);
    setState('idle');
  }, [clearReadTimer]);

  const refresh = useCallback(async () => {
    // A queued press after backgrounding must not start a protected read.
    if (!enabled || !active.current) return;
    if (timer.current !== null)
      reportSavedMemoryRead('saved_memory_wait', 'cancelled');
    clearReadTimer();
    reportSavedMemoryRead('saved_memory_wait', 'started');
    const request = ++generation.current;
    setState('loading');
    setRows([]);
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
      const result = await load();
      if (generation.current !== request) return;
      reportSavedMemoryRead('saved_memory_wait', 'completed');
      setRows(result);
      setState('ready');
      if (load === loadUnifiedLocalMemories)
        resumeStatementMemoryAfterRead(
          () => generation.current === request && enabled && active.current,
        );
    } catch {
      if (generation.current === request) {
        reportSavedMemoryRead('saved_memory_wait', 'failed');
        setState('failed');
      }
    } finally {
      if (generation.current === request) clearReadTimer();
    }
  }, [load, clearReadTimer, enabled]);

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
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [refresh, close, clearReadTimer, enabled]);

  return { rows, state, refresh };
}
