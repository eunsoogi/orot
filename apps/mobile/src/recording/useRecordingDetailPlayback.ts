import { useLayoutEffect, useMemo } from 'react';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordingPlaybackService } from './recordingTypes';

type SegmentPlaybackSnapshot = {
  readonly key?: string;
  readonly request?: object;
  readonly failed?: boolean;
};
type Listener = () => void;
export interface RecordingSegmentPlayback {
  readonly getSnapshot: () => SegmentPlaybackSnapshot;
  subscribe(listener: Listener): () => void;
  play(segment: TranscriptEvidenceSegment): Promise<void>;
  stop?(segment: TranscriptEvidenceSegment, request: object): Promise<void>;
  readonly active: boolean;
}

export const idleSegmentPlayback: SegmentPlaybackSnapshot = {};

export function segmentPlaybackKey(segment: TranscriptEvidenceSegment) {
  // The panel displays only the latest row per transcriptId. Preserve that
  // audio lineage across text corrections, but never alias distinct equal-time segments.
  return JSON.stringify([
    segment.recordingSourceId,
    segment.transcriptId,
    segment.audioRange.startMs,
    segment.audioRange.endMs,
  ]);
}

function createRecordingDetailPlayback(
  route: RecordingPlaybackService,
  sourceId: string | undefined,
  active: boolean,
) {
  let current = false;
  let operation: object | undefined;
  let snapshot = idleSegmentPlayback;
  const listeners = new Set<Listener>();
  const publish = (next: SegmentPlaybackSnapshot) => {
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const retireSegment = () => {
    operation = undefined;
    publish(idleSegmentPlayback);
  };
  const admits = (segment: TranscriptEvidenceSegment) =>
    current && segment.recordingSourceId === sourceId;
  const execute = async (
    next: SegmentPlaybackSnapshot,
    dispatch: () => Promise<unknown>,
  ) => {
    const owned = {};
    operation = owned;
    publish(next.key ? { ...next, request: owned } : next);
    if (!current || operation !== owned) return;
    try {
      await dispatch();
      if (operation === owned) retireSegment();
    } catch {
      if (operation === owned) {
        operation = undefined;
        publish({ failed: true });
      }
    }
  };
  const stop = route.stopPlayback;
  const segments: RecordingSegmentPlayback = {
    active,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async play(segment) {
      const key = segmentPlaybackKey(segment);
      if (!admits(segment) || snapshot.key === key) return;
      await execute({ key }, () =>
        route.playRange(
          segment.recordingSourceId,
          segment.audioRange.startMs,
          segment.audioRange.endMs,
        ),
      );
    },
    stop: stop
      ? async (segment, request) => {
          if (
            !admits(segment) ||
            operation !== request ||
            snapshot.key !== segmentPlaybackKey(segment)
          )
            return;
          await execute(idleSegmentPlayback, () => stop());
        }
      : undefined,
  };
  const whole: RecordingPlaybackService = {
    ...route,
    playRange(id, start, end) {
      if (current && id === sourceId) retireSegment();
      return route.playRange(id, start, end);
    },
    stopPlayback: stop
      ? async () => {
          if (!current) return;
          retireSegment();
          await stop();
        }
      : undefined,
  };
  return {
    enter() {
      current = active;
      return () => {
        current = false;
        retireSegment();
        // The underlying route lease owns native Stop on focus or source loss.
      };
    },
    whole,
    segments,
  };
}

/** Arbitrate both controls inside the existing exact route-owned native lease. */
export function useRecordingDetailPlayback(
  route: RecordingPlaybackService,
  sourceId: string | undefined,
  active: boolean,
) {
  const playback = useMemo(
    () => createRecordingDetailPlayback(route, sourceId, active),
    [route, sourceId, active],
  );
  useLayoutEffect(() => playback.enter(), [playback]);
  return playback;
}
