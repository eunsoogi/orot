import { useLayoutEffect, useMemo } from 'react';
import type { RecordingPlaybackService } from './recordingTypes';

export function useRouteRecordingPlayback(
  service: RecordingPlaybackService,
  sourceId: string | undefined,
  active: boolean,
): RecordingPlaybackService {
  const lease = useMemo(() => {
    const owner = Symbol('saved-recording-detail');
    let current = false;
    let dispatched = false;
    const playback: RecordingPlaybackService = {
      readDuration: service.readDuration,
      subscribePlayback: service.subscribePlayback,
      playRange(id, start, end) {
        if (!current || id !== sourceId)
          return Promise.reject(new Error('Inactive recording detail.'));
        dispatched = true;
        return service.playRange(id, start, end, owner);
      },
      seekPlayback: service.seekPlayback
        ? async (id, seekID, position) =>
            current &&
            dispatched &&
            id === sourceId &&
            (await service.seekPlayback?.(id, seekID, position, owner)) === true
        : undefined,
      stopPlayback: service.stopPlayback
        ? async () => {
            if (!dispatched) return;
            dispatched = false;
            await service.stopPlayback?.(owner);
          }
        : undefined,
    };
    return {
      enter() {
        current = active;
        return () => {
          current = false;
          playback.stopPlayback?.().catch(() => undefined);
        };
      },
      playback,
    };
  }, [active, service, sourceId]);
  useLayoutEffect(() => lease.enter(), [lease]);
  return lease.playback;
}
