import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { readmitSettledRecentPair } from '../storage/settledRecentPublication';
import type { SettledRecentReceipt } from './recentSavedMaterialPageTypes';
import type { RecordsTabAuthority } from './useAppRootTab';

type ReceiptSlot = { receipt: SettledRecentReceipt; release: () => void };
type Paint<T> = { value: T; media: ReceiptSlot; material: ReceiptSlot };

export function useSettledRecentPaint<T>(
  eligible: boolean,
  ownership?: NavigationRouteOwnership,
  tab?: RecordsTabAuthority,
) {
  const latest = useRef<{ media?: ReceiptSlot; material?: ReceiptSlot }>({});
  const painted = useRef<Paint<T> | undefined>(undefined);
  const generation = useRef(0);
  const routeIdentity = useMemo(
    () => ({ eligible, ownership, tab }),
    [eligible, ownership, tab],
  );
  const lastPhase = useRef(AppState.currentState);
  const [warm, setWarm] = useState<{ value: T; route: object }>();
  const [blocked, setBlocked] = useState(false);
  const release = useCallback((slot?: ReceiptSlot) => {
    slot?.release();
    slot?.receipt.dispose();
  }, []);
  const dispose = useCallback(() => {
    generation.current++;
    const slots = new Set([
      latest.current.media,
      latest.current.material,
      painted.current?.media,
      painted.current?.material,
    ]);
    latest.current = {};
    painted.current = undefined;
    for (const slot of slots) release(slot);
  }, [release]);
  const clear = useCallback(() => {
    dispose();
    setWarm(undefined);
    setBlocked(false);
  }, [dispose]);
  const receive = useCallback(
    (role: 'media' | 'material', receipt?: SettledRecentReceipt) => {
      if (!receipt) {
        clear();
        return;
      }
      const releaseWatch = receipt.beforeRetire(clear);
      if (!releaseWatch || role !== receipt.role) {
        releaseWatch?.();
        receipt.dispose();
        clear();
        return;
      }
      const previous = latest.current[role];
      if (previous && previous !== painted.current?.[role]) release(previous);
      latest.current[role] = { receipt, release: releaseWatch };
    },
    [clear, release],
  );
  const publishMedia = useCallback(
    (r?: SettledRecentReceipt) => receive('media', r),
    [receive],
  );
  const publishMaterial = useCallback(
    (r?: SettledRecentReceipt) => receive('material', r),
    [receive],
  );

  useLayoutEffect(() => {
    if (!eligible) {
      clear();
      return;
    }
    lastPhase.current = AppState.currentState;
    setWarm(undefined);
    setBlocked(false);
    let mounted = true;
    const sameTab = tab?.capture();
    const native = conversationExecutionNative();
    const releaseNative = native?.bridgeAvailable
      ? native.subscribe(event => {
          if (event.kind === 'protectedData' && !event.available) clear();
          if (event.kind === 'phase') {
            const phase = native.currentPhase?.();
            if (phase === 'background' || phase === 'unknown' || !phase)
              clear();
            else if (phase === 'inactive') {
              generation.current++;
              setWarm(undefined);
              setBlocked(Boolean(painted.current));
            }
          }
        })
      : undefined;
    const route = ownership?.subscribe(() => {
      if (!ownership.isCurrent()) clear();
    });
    const tabEvents = tab?.subscribe(clear);
    const change = AppState.addEventListener('change', phase => {
      const previous = lastPhase.current;
      lastPhase.current = phase;
      if (
        phase === 'background' ||
        (phase !== 'inactive' && phase !== 'active')
      ) {
        clear();
        return;
      }
      if (phase === 'inactive' && previous === 'active') {
        generation.current++;
        setWarm(undefined);
        setBlocked(Boolean(painted.current));
      }
      if (phase !== 'active' || previous !== 'inactive') return;
      const exact = painted.current;
      const ticket = generation.current;
      if (!exact || !native?.bridgeAvailable) {
        clear();
        return;
      }
      const current = () =>
        mounted &&
        generation.current === ticket &&
        AppState.currentState === 'active' &&
        native.currentPhase?.() === 'active' &&
        (ownership?.isCurrent() ?? true) &&
        (sameTab?.() ?? true);
      const media = exact.media.receipt;
      const material = exact.material.receipt;
      readmitSettledRecentPair(
        {
          media: { receipt: media, frontier: media.frontier },
          material: { receipt: material, frontier: material.frontier },
          firstPageOnly: true,
          activeOwner: current,
          protectedReadable: () => native.protectedDataAvailable(),
        },
        () => {
          setWarm({ value: exact.value, route: routeIdentity });
          setBlocked(false);
        },
      ).then(ok => {
        if (!ok && mounted && generation.current === ticket) clear();
      });
    });
    return () => {
      mounted = false;
      change.remove();
      releaseNative?.();
      route?.();
      tabEvents?.();
      dispose();
    };
  }, [eligible, ownership, tab, clear, dispose, routeIdentity]);
  return {
    blocked,
    rejectWarm: clear,
    warm:
      AppState.currentState === 'active' &&
      warm?.route === routeIdentity &&
      (ownership?.isCurrent() ?? true) &&
      painted.current
        ? warm.value
        : undefined,
    publishMedia,
    publishMaterial,
    recordPaint(
      value: T,
      firstPage: boolean,
      mediaRows: readonly { key: string; createdAt: string }[],
      materialRows: readonly { key: string; createdAt: string }[],
    ) {
      if (!eligible || AppState.currentState !== 'active') return;
      if (!firstPage) {
        if (painted.current) clear();
        return;
      }
      const { media, material } = latest.current;
      const matches = (slot: ReceiptSlot, rows: typeof mediaRows) =>
        slot.receipt.frontier.positions.length === rows.length &&
        rows.every((row, index) => {
          const position = slot.receipt.frontier.positions[index];
          return (
            position?.key === row.key && position.createdAt === row.createdAt
          );
        });
      if (
        !media?.receipt.current() ||
        !material?.receipt.current() ||
        !matches(media, mediaRows) ||
        !matches(material, materialRows)
      )
        return;
      const old = painted.current;
      if (old?.media !== media) release(old?.media);
      if (old?.material !== material) release(old?.material);
      painted.current = { value, media, material };
      if (warm !== undefined) setWarm(undefined);
    },
  };
}
