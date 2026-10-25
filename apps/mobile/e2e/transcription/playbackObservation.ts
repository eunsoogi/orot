import type {
  RecordingPlaybackRange,
  RecordingPlaybackService,
} from '../../src/recording/recordingTypes';

export interface PlaybackObservation {
  readonly generation: number;
  readonly phase: 'ready' | 'requested' | 'completed' | 'stopped' | 'failed';
  readonly nativePlaying: boolean;
  readonly maximumPositionMs: number;
  readonly range?: RecordingPlaybackRange;
  readonly error?: string;
}

/** Retains real native events and terminal promises for a slow observer; it never synthesizes playback or success. */
export function observedPlaybackService(
  native: RecordingPlaybackService,
  publish: (observation: PlaybackObservation) => void,
): RecordingPlaybackService {
  let activeRecordingId: string | null = null;
  let observation: PlaybackObservation = {
    generation: 0,
    phase: 'ready',
    nativePlaying: false,
    maximumPositionMs: 0,
  };
  const update = (value: Partial<PlaybackObservation>) => {
    observation = { ...observation, ...value };
    publish(observation);
  };
  return {
    ...native,
    subscribePlayback(listener) {
      if (!native.subscribePlayback)
        throw new Error('Native playback observations are unavailable');
      return native.subscribePlayback(state => {
        if (
          state.status === 'playing' &&
          state.recordingId === activeRecordingId &&
          observation.phase === 'requested'
        ) {
          update({
            nativePlaying: true,
            maximumPositionMs: Math.max(
              observation.maximumPositionMs,
              state.positionMs,
            ),
          });
        }
        listener(state);
      });
    },
    async playRange(recordingId, startMs, endMs) {
      activeRecordingId = recordingId;
      observation = {
        generation: observation.generation + 1,
        phase: 'requested',
        nativePlaying: false,
        maximumPositionMs: 0,
      };
      publish(observation);
      const generation = observation.generation;
      try {
        const range = await native.playRange(recordingId, startMs, endMs);
        if (generation !== observation.generation)
          throw new Error('Playback observation was superseded');
        if (
          !observation.nativePlaying ||
          (range.completion !== 'completed' &&
            range.completion !== 'stopped') ||
          !Number.isFinite(range.actualEndMs)
        ) {
          throw new Error('Native playback completion evidence is missing');
        }
        update({ phase: range.completion, range });
        return range;
      } catch (failure) {
        if (generation === observation.generation)
          update({ phase: 'failed', error: String(failure) });
        throw failure;
      }
    },
  };
}
