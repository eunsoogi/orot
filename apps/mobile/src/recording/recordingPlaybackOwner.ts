import type { RecordingPlaybackService } from './recordingTypes';

type Playback = Pick<
  RecordingPlaybackService,
  'playRange' | 'stopPlayback' | 'seekPlayback'
>;

/** Native playback and stop share one serial recording queue. Retire only the
 * latest submitted request for this route, even while its native promise is held. */
export function createRecordingPlaybackOwner(native: Playback): Playback {
  let current: { owner?: symbol; id: string } | undefined;
  return {
    async playRange(id, start, end, owner) {
      const request = { owner, id };
      current = request;
      try {
        return await native.playRange(id, start, end);
      } finally {
        if (current === request) current = undefined;
      }
    },
    seekPlayback: native.seekPlayback
      ? async (id, seekID, position, owner) => {
          const request = current;
          if (!request || request.owner !== owner || request.id !== id)
            return false;
          const accepted = await native.seekPlayback?.(id, seekID, position);
          return current === request && accepted === true;
        }
      : undefined,
    async stopPlayback(owner) {
      if (owner !== undefined && current?.owner !== owner) return;
      current = undefined;
      await native.stopPlayback?.();
    },
  };
}
