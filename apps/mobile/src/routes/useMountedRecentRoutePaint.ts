import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { RecordsTabAuthority } from './useAppRootTab';

type Depths = Readonly<{ media: number; material: number }>;
type Epochs = Readonly<{ media: number; material: number }>;
type Paint<T> = Readonly<{
  value: T;
  identity: object;
  database: object;
  depths: Depths;
  epochs: Epochs;
}>;

/** Owns mounted presentation only, never permission to read or open a row. */
export function useMountedRecentRoutePaint<T>(
  enabled: boolean,
  ownership?: NavigationRouteOwnership,
  tab?: RecordsTabAuthority,
  database?: object,
) {
  const identity = useMemo(
    () => ({ enabled, ownership, tab }),
    [enabled, ownership, tab],
  );
  const locked = useRef(false);
  const committed = useRef<Paint<T> | undefined>(undefined);
  const [held, setHeld] = useState<Paint<T>>();
  const clear = useCallback(() => {
    committed.current = undefined;
    setHeld(undefined);
  }, []);
  useLayoutEffect(() => {
    if (!enabled) {
      clear();
      return;
    }
    const currentTab = tab?.capture();
    const current = () =>
      (ownership?.isCurrent() ?? true) && (currentTab?.() ?? true);
    const app = AppState.addEventListener('change', phase => {
      const snapshot = committed.current;
      if (phase === 'inactive' || phase === 'background') {
        if (snapshot && current()) setHeld(snapshot);
      } else if (phase !== 'active') clear();
    });
    const native = conversationExecutionNative();
    const protection = native?.bridgeAvailable
      ? native.subscribe(event => {
          if (event.kind !== 'protectedData') return;
          locked.current = !event.available;
          if (locked.current) clear();
        })
      : undefined;
    const leaving = ownership?.subscribe(() => {
      if (!current()) clear();
    });
    const switchTab = tab?.subscribe(clear);
    const deletion = subscribeLocalSourceDeletion(clear);
    const deletionAll = subscribeLocalDataClear(clear);
    return () => {
      committed.current = undefined;
      app.remove();
      protection?.();
      leaving?.();
      switchTab?.();
      deletion();
      deletionAll();
    };
  }, [enabled, ownership, tab, clear]);
  useLayoutEffect(() => {
    if (
      database &&
      committed.current &&
      committed.current.database !== database
    )
      clear();
  }, [clear, database]);
  // The native phase can retire the read lease before RN emits its AppState
  // event. Only the same attached route may keep the last protected paint.
  const snapshot =
    held ??
    (!database ||
    AppState.currentState === 'inactive' ||
    AppState.currentState === 'background'
      ? committed.current
      : undefined);
  const retained =
    enabled &&
    !locked.current &&
    snapshot?.identity === identity &&
    (!database || snapshot.database === database) &&
    (ownership?.isCurrent() ?? true)
      ? snapshot
      : undefined;

  return {
    retained,
    clear,
    commit(value: T, media: Stream, material: Stream) {
      if (
        !enabled ||
        !database ||
        locked.current ||
        AppState.currentState !== 'active' ||
        ownership?.isCurrent() === false
      )
        return;
      committed.current = {
        value,
        identity,
        database,
        depths: { media: media.rows.length, material: material.rows.length },
        epochs: { media: media.pageEpoch, material: material.pageEpoch },
      };
      if (retained) setHeld(undefined);
    },
  };
}

type Stream = Readonly<{
  pageEpoch: number;
  more: boolean;
  rows: readonly unknown[];
}>;
export function resolveMountedRecentPaint<T>(
  retained: Paint<T> | undefined,
  warmCandidate: T | undefined,
  isFresh: boolean,
  loadFailed: boolean,
  media: Stream,
  material: Stream,
) {
  const complete = (stream: Stream, role: keyof Depths) =>
    !retained ||
    (stream.pageEpoch > retained.epochs[role] &&
      (!stream.more || stream.rows.length >= retained.depths[role]));
  const rebuilt =
    isFresh && complete(media, 'media') && complete(material, 'material');
  const suspended =
    AppState.currentState === 'inactive' ||
    AppState.currentState === 'background';
  if (retained && suspended) {
    return {
      rebuilt: false,
      holding: true,
      revision: undefined,
      warm: undefined,
      snapshot: retained.value,
    };
  }
  const warm = loadFailed ? undefined : warmCandidate;
  const holding = Boolean(retained && !warm && !rebuilt && !loadFailed);
  const revision =
    !holding && (warm !== undefined || rebuilt)
      ? [media.pageEpoch, material.pageEpoch].join(':')
      : loadFailed
        ? ['neutral', media.pageEpoch, material.pageEpoch].join(':')
        : undefined;
  return {
    rebuilt,
    holding,
    revision,
    warm,
    snapshot: warm ?? (holding ? retained?.value : undefined),
  };
}
