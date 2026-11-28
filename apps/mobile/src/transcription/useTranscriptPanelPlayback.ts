import { useState, useSyncExternalStore } from 'react';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import {
  idleSegmentPlayback,
  segmentPlaybackKey,
  type RecordingSegmentPlayback,
} from '../recording/useRecordingDetailPlayback';
import type { TranscriptEvidenceService } from './transcriptEvidenceService';
import type { TranscriptError } from './transcriptReviewPresentation';

const subscribeIdle = () => () => {};
const getIdle = () => idleSegmentPlayback;

/** Saved details share the route-owned player; other evidence panels retain their existing play-only behavior. */
export function useTranscriptPanelPlayback(
  owned: RecordingSegmentPlayback | undefined,
  fallback: TranscriptEvidenceService['play'],
  setError: (error: TranscriptError | null) => void,
) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const state = useSyncExternalStore(
    owned?.subscribe ?? subscribeIdle,
    owned?.getSnapshot ?? getIdle,
  );
  return {
    failed: state.failed,
    controls(segment: TranscriptEvidenceSegment) {
      const { request } = state;
      return {
        playing: owned
          ? state.key === segmentPlaybackKey(segment)
          : playingId === segment.id,
        playbackDisabled: owned?.active === false,
        async onPlay() {
          setError(null);
          if (owned) return owned.play(segment);
          setPlayingId(segment.id);
          try {
            await fallback(segment);
          } catch {
            setError('play');
          } finally {
            setPlayingId(null);
          }
        },
        onStop:
          owned?.stop && request
            ? () => owned.stop?.(segment, request)
            : undefined,
      };
    },
  };
}
