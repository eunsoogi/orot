import type { RecordingPlaybackService } from './recordingTypes';

type Playback = Pick<RecordingPlaybackService, 'playRange' | 'stopPlayback'>;

/** Native playback and stop share one serial recording queue. Retire only the
 * latest submitted request for this route, even while its native promise is held. */
export function createRecordingPlaybackOwner(native: Playback): Playback {
  let current: { owner?: symbol } | undefined;
  return {
    async playRange(id, start, end, owner) {
      const request = { owner };
      current = request;
      try {
        return await native.playRange(id, start, end);
      } finally {
        if (current === request) current = undefined;
      }
    },
    async stopPlayback(owner) {
      if (owner !== undefined && current?.owner !== owner) return;
      current = undefined;
      await native.stopPlayback?.();
    },
  };
}
