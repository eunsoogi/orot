import { act, fireEvent, render } from '@testing-library/react-native';
import RecordingPlaybackControls from '../RecordingPlaybackControls';
import type {
  RecordingPlaybackRange,
  RecordingPlaybackService,
  RecordingPlaybackState,
} from '../recordingTypes';

test('shows native playback progress and can stop the active player', async () => {
  let publishPlayback: ((state: RecordingPlaybackState) => void) | undefined;
  let finishPlayback: (() => void) | undefined;
  const playback: RecordingPlaybackService = {
    playRange: jest.fn(
      () =>
        new Promise<RecordingPlaybackRange>(resolve => {
          finishPlayback = () =>
            resolve({ startMs: 0, endMs: 372000, actualStartMs: 0 });
        }),
    ),
    subscribePlayback: jest.fn(
      (listener: (state: RecordingPlaybackState) => void) => {
        publishPlayback = listener;
        return () => {
          publishPlayback = undefined;
        };
      },
    ),
    stopPlayback: jest.fn(async () => {
      finishPlayback?.();
    }),
  };

  const view = await render(
    <RecordingPlaybackControls
      durationMs={372000}
      playbackService={playback}
      recordingId="recording-playback-test"
    />,
  );

  await fireEvent.press(view.getByTestId('recording-playback-button'));
  await act(async () => {
    // Drive the same progress event the native player publishes from AVAudioPlayer.currentTime.
    publishPlayback?.({
      status: 'playing',
      recordingId: 'recording-playback-test',
      positionMs: 1350,
      durationMs: 369500,
    });
  });

  expect(view.getByTestId('recording-playback-position')).toHaveTextContent(
    '00:01',
  );
  expect(
    view.getByTestId('recording-playback-progress').props.accessibilityValue,
  ).toEqual({ min: 0, max: 369500, now: 1350 });

  await fireEvent.press(view.getByTestId('recording-playback-stop'));
  expect(playback.stopPlayback).toHaveBeenCalledTimes(1);
});

test('explains a missing saved audio file while leaving retry available', async () => {
  const missingFile = Object.assign(new Error('Missing file'), {
    code: 'RECORDING_FILE_MISSING',
  });
  const playback: RecordingPlaybackService = {
    playRange: jest.fn(async () => {
      throw missingFile;
    }),
  };

  const view = await render(
    <RecordingPlaybackControls
      durationMs={372000}
      playbackService={playback}
      recordingId="recording-playback-test"
    />,
  );

  await fireEvent.press(view.getByTestId('recording-playback-button'));

  const error = await view.findByTestId('recording-playback-error');
  expect(error).toHaveTextContent(/백업/);
  expect(
    view.getByTestId('recording-playback-button').props.accessibilityState
      .disabled,
  ).toBe(false);
});

test('plays an older saved recording without duration metadata using the actual file duration', async () => {
  const playback = {
    readDuration: jest.fn(async () => 12_340),
    playRange: jest.fn(async () => ({
      startMs: 0,
      endMs: 12_340,
      actualStartMs: 0,
    })),
  };
  const view = await render(
    <RecordingPlaybackControls
      durationMs={null}
      playbackService={playback}
      recordingId="legacy-recording"
    />,
  );
  expect(view.getByTestId('recording-playback-button')).toBeEnabled();
  await fireEvent.press(view.getByTestId('recording-playback-button'));
  expect(playback.readDuration).toHaveBeenCalledWith('legacy-recording');
  expect(playback.playRange).toHaveBeenCalledWith(
    'legacy-recording',
    0,
    12_340,
  );
});

test('stopping while file metadata is loading prevents later playback dispatch', async () => {
  let finishDuration!: (duration: number) => void;
  const playback = {
    readDuration: jest.fn(
      () =>
        new Promise<number>(resolve => {
          finishDuration = resolve;
        }),
    ),
    playRange: jest.fn(async () => ({
      startMs: 0,
      endMs: 12000,
      actualStartMs: 0,
    })),
    stopPlayback: jest.fn(async () => {}),
  };
  const view = await render(
    <RecordingPlaybackControls
      durationMs={null}
      playbackService={playback}
      recordingId="legacy-recording"
    />,
  );
  await fireEvent.press(view.getByTestId('recording-playback-button'));
  await fireEvent.press(view.getByTestId('recording-playback-stop'));
  await act(async () => {
    finishDuration(12000);
  });
  expect(playback.playRange).not.toHaveBeenCalled();
  expect(view.getByTestId('recording-playback-button')).toBeEnabled();
});

test('a new source remains playable after the previous source pending read is invalidated', async () => {
  let finishDuration!: (duration: number) => void;
  const playback = {
    readDuration: jest.fn(
      () =>
        new Promise<number>(resolve => {
          finishDuration = resolve;
        }),
    ),
    playRange: jest.fn(),
  };
  const view = await render(
    <RecordingPlaybackControls
      durationMs={null}
      playbackService={playback}
      recordingId="A"
    />,
  );
  await fireEvent.press(view.getByTestId('recording-playback-button'));
  await view.rerender(
    <RecordingPlaybackControls
      durationMs={null}
      playbackService={playback}
      recordingId="B"
    />,
  );
  await act(async () => {
    finishDuration(12000);
  });
  expect(playback.playRange).not.toHaveBeenCalled();
  expect(view.getByTestId('recording-playback-button')).toBeEnabled();
});

test('a retained route losing focus cancels pending metadata playback', async () => {
  let finishDuration!: (duration: number) => void;
  const playback = {
    readDuration: jest.fn(
      () =>
        new Promise<number>(resolve => {
          finishDuration = resolve;
        }),
    ),
    playRange: jest.fn(),
  };
  const view = await render(
    <RecordingPlaybackControls
      durationMs={null}
      playbackService={playback}
      recordingId="A"
    />,
  );
  await fireEvent.press(view.getByTestId('recording-playback-button'));
  await view.rerender(
    <RecordingPlaybackControls
      active={false}
      durationMs={null}
      playbackService={playback}
      recordingId="A"
    />,
  );
  await act(async () => {
    finishDuration(12000);
  });
  expect(playback.playRange).not.toHaveBeenCalled();
  await view.rerender(
    <RecordingPlaybackControls
      active
      durationMs={null}
      playbackService={playback}
      recordingId="A"
    />,
  );
  expect(view.getByTestId('recording-playback-button')).toBeEnabled();
});
