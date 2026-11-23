import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { readSelectedRecentRecording } from './recentSourceReader';

export type RecentRecordingMetadata =
  | { status: 'ready'; durationMs: number | null }
  | { status: 'unavailable' | 'protected' | 'missing' };

/** The route can refresh presentation only. It cannot start playback, re-index or transcribe. */
export function RecentRecordingMetadataRefresh({
  id,
  active,
  enabled,
  owner,
  publish,
}: {
  id: string;
  active: boolean;
  enabled: boolean;
  owner: NavigationRouteOwnership;
  publish: (value: RecentRecordingMetadata) => void;
}) {
  const current = useRef<{
    cancelled: boolean;
    stopRead?: () => void;
  } | null>(null);
  const latest = useRef({ enabled, publish });
  latest.current = { enabled, publish };
  useLayoutEffect(() => {
    if (!enabled) current.current?.stopRead?.();
  }, [enabled]);
  useLayoutEffect(() => {
    if (!active) return;
    const lease = { cancelled: false } as NonNullable<typeof current.current>;
    current.current = lease;
    const stopRead = () => lease.stopRead?.();
    const invalidate = (status: 'protected' | 'missing') => {
      stopRead();
      if (current.current === lease && owner.isCurrent())
        latest.current.publish({ status });
    };
    const changed = owner.subscribe(() => {
      if (!owner.isCurrent()) stopRead();
    });
    const app = AppState.addEventListener('change', phase => {
      if (phase !== 'active') stopRead();
    });
    const deletion = subscribeLocalSourceDeletion((_origin, ids) => {
      if (!ids || ids.has(id)) invalidate('missing');
    }, 'local');
    const clear = subscribeLocalDataClear(() => invalidate('missing'));
    const protection = conversationExecutionNative()?.subscribe(event => {
      if (event.kind === 'protectedData' && !event.available)
        invalidate('protected');
    });
    return () => {
      lease.cancelled = true;
      stopRead();
      if (current.current === lease) current.current = null;
      changed();
      protection?.();
      app.remove();
      deletion();
      clear();
    };
  }, [active, id, owner]);
  useNavigationRouteRefresh(active && enabled, async () => {
    const lease = current.current;
    const owns = () =>
      Boolean(
        lease &&
        !lease.cancelled &&
        latest.current.enabled &&
        current.current === lease &&
        owner.isCurrent() &&
        AppState.currentState === 'active',
      );
    if (!lease || !owns() || lease.stopRead) return;
    const retired = Symbol('retired');
    let ended = false;
    let stop: () => void = () => {};
    const cancellation = new Promise<typeof retired>(resolve => {
      stop = () => {
        ended = true;
        resolve(retired);
      };
    });
    lease.stopRead = stop;
    const still = () => owns() && lease.stopRead === stop && !ended;
    const read = async (): Promise<RecentRecordingMetadata> => {
      const native = conversationExecutionNative();
      if (!native?.bridgeAvailable) return { status: 'unavailable' };
      if ((await native.protectedDataAvailable()) !== true)
        return { status: 'protected' };
      if (!still()) return { status: 'unavailable' };
      const source = await readSelectedRecentRecording(id);
      if ((await native.protectedDataAvailable()) !== true)
        return { status: 'protected' };
      if (!still()) return { status: 'unavailable' };
      return source?.id === id && source.sourceKind === 'audio_recording'
        ? { status: 'ready', durationMs: source.recordingDurationMs ?? null }
        : { status: 'missing' };
    };
    try {
      const value = await Promise.race([read(), cancellation]);
      if (value !== retired && still()) latest.current.publish(value);
    } catch {
      if (still()) latest.current.publish({ status: 'unavailable' });
    } finally {
      ended = true;
      if (lease.stopRead === stop) lease.stopRead = undefined;
    }
  });
  return null;
}
