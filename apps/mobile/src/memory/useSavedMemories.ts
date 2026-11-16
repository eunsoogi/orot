import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AgentMemoryHit } from '@orot/agent-memory';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { loadSavedLocalMemories } from './savedLocalMemories';
export type SavedMemory = Omit<AgentMemoryHit, 'score'>;
const READ_WAIT_MS = 10_000;
/** Shared protected read lifecycle for list and detail. Invalidations erase text before cleanup settles. */
export function useSavedMemories(
  load: () => Promise<SavedMemory[]> = loadSavedLocalMemories,
  enabled = true,
) {
  const [rows, setRows] = useState<SavedMemory[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  );
  const generation = useRef(0);
  const active = useRef(AppState.currentState === 'active');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(() => {
    clearReadTimer();
    generation.current += 1;
    setRows([]);
    setState('idle');
  }, [clearReadTimer]);

  const refresh = useCallback(async () => {
    // A queued press after backgrounding must not start a protected read.
    if (!enabled || !active.current) return;
    clearReadTimer();
    const request = ++generation.current;
    setState('loading');
    setRows([]);
    // Bound the UI wait, not the database transaction. Never close a shared connection
    // or treat a timeout as empty storage; discard its late result and offer a fresh read.
    timer.current = setTimeout(() => {
      if (generation.current !== request) return;
      generation.current += 1;
      timer.current = null;
      setState('failed');
    }, READ_WAIT_MS);
    try {
      const result = await load();
      if (generation.current !== request) return;
      setRows(result);
      setState('ready');
    } catch {
      if (generation.current === request) setState('failed');
    } finally {
      if (generation.current === request) clearReadTimer();
    }
  }, [load, clearReadTimer, enabled]);

  useEffect(() => {
    // Deletion fences invalidate cached text and pending reads, even if later cleanup fails.
    const unsubscribeClear = subscribeLocalDataClear(close);
    const unsubscribeSource = subscribeLocalSourceDeletion(close);
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
      clearReadTimer();
      generation.current += 1;
      subscription.remove();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [refresh, close, clearReadTimer, enabled]);

  return { rows, state, refresh };
}
