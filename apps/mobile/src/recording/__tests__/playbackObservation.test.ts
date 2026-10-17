import {
  observedPlaybackService,
  type PlaybackObservation,
} from '../../../e2e/transcription/playbackObservation';
import type {
  RecordingPlaybackRange,
  RecordingPlaybackState,
} from '../recordingTypes';

function fixture() {
  let event: ((state: RecordingPlaybackState) => void) | undefined;
  let complete: (value: RecordingPlaybackRange) => void = () => {};
  const completions: Array<(value: RecordingPlaybackRange) => void> = [];
  let fail: (error: Error) => void = () => {};
  let latest: PlaybackObservation | undefined;
  const service = observedPlaybackService(
    {
      subscribePlayback(listener) {
        event = listener;
        return () => {
          event = undefined;
        };
      },
      playRange: () =>
        new Promise((resolve, reject) => {
          complete = resolve;
          completions.push(resolve);
          fail = reject;
        }),
    },
    value => {
      latest = value;
    },
  );
  service.subscribePlayback?.(() => {});
  return {
    service,
    complete: (value: RecordingPlaybackRange) => complete(value),
    completeGeneration(index: number, value: RecordingPlaybackRange) {
      const resolve = completions[index];
      if (!resolve) throw new Error('Missing pending native playback');
      resolve(value);
    },
    fail: (error: Error) => fail(error),
    latest: () => latest,
    event: (positionMs: number, recordingId = 'saved') =>
      event?.({
        status: 'playing',
        recordingId,
        positionMs,
        durationMs: 2585,
      }),
  };
}

test('late UI consumption retains real progress and distinguishes explicit stop from natural end', async () => {
  const value = fixture();
  for (const completion of ['stopped', 'completed'] as const) {
    const playing = value.service.playRange('saved', 0, 2585);
    value.event(1100);
    // Subsequent loop/reset events cannot erase an already observed real player position.
    value.event(0);
    value.complete({
      startMs: 0,
      endMs: 2585,
      actualStartMs: 0,
      actualEndMs: 2585,
      completion,
    });
    await playing;
    expect(value.latest()).toMatchObject({
      phase: completion,
      nativePlaying: true,
      maximumPositionMs: 1100,
    });
    // Reading long after completion retains the same terminal evidence; no live one-second UI window is required.
    await Promise.resolve();
    expect(value.latest()?.phase).toBe(completion);
  }
});

test('a pending native operation is not reported as completed and errors remain failed', async () => {
  const value = fixture();
  const playing = value.service.playRange('saved', 0, 2585);
  await Promise.resolve();
  expect(value.latest()?.phase).toBe('requested');
  const error = new Error('Actual native decode failure');
  value.fail(error);
  await expect(playing).rejects.toBe(error);
  expect(value.latest()?.phase).toBe('failed');
});

test('a resolved promise without real native start and completion evidence is a failure', async () => {
  const value = fixture();
  const playing = value.service.playRange('saved', 0, 2585);
  value.complete({ startMs: 0, endMs: 2585, actualStartMs: 0 });
  await expect(playing).rejects.toThrow(
    'Native playback completion evidence is missing',
  );
  expect(value.latest()?.phase).toBe('failed');
});

test('another source cannot supply the native start evidence for a completed promise', async () => {
  const value = fixture();
  const playing = value.service.playRange('saved', 0, 2585);
  value.event(1100, 'another-recording');
  expect(value.latest()).toMatchObject({
    phase: 'requested',
    nativePlaying: false,
    maximumPositionMs: 0,
  });
  value.complete({
    startMs: 0,
    endMs: 2585,
    actualStartMs: 0,
    actualEndMs: 2585,
    completion: 'completed',
  });
  await expect(playing).rejects.toThrow(
    'Native playback completion evidence is missing',
  );
  expect(value.latest()?.phase).toBe('failed');
});

test('a superseded generation cannot settle or fail the active observation', async () => {
  const value = fixture();
  const previous = value.service.playRange('saved', 0, 2585);
  const active = value.service.playRange('saved', 0, 2585);
  value.event(1100);
  // The previous real native promise may settle late, after the next request starts.
  value.completeGeneration(0, {
    startMs: 0,
    endMs: 2585,
    actualStartMs: 0,
    actualEndMs: 2585,
    completion: 'completed',
  });
  await expect(previous).rejects.toThrow('Playback observation was superseded');
  expect(value.latest()).toMatchObject({
    generation: 2,
    phase: 'requested',
    nativePlaying: true,
    maximumPositionMs: 1100,
  });
  value.complete({
    startMs: 0,
    endMs: 2585,
    actualStartMs: 0,
    actualEndMs: 1200,
    completion: 'stopped',
  });
  await active;
  expect(value.latest()).toMatchObject({ generation: 2, phase: 'stopped' });
});
