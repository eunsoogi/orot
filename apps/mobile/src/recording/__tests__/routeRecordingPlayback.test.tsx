import { act, fireEvent, render } from '@testing-library/react-native';
import RecordingPlaybackControls from '../RecordingPlaybackControls';
import { createRecordingPlaybackOwner } from '../recordingPlaybackOwner';
import type {
  RecordingPlaybackRange,
  RecordingPlaybackService,
} from '../recordingTypes';
import { useRouteRecordingPlayback } from '../useRouteRecordingPlayback';

const range = { startMs: 0, actualStartMs: 0, endMs: 12000 };

test('an accepted route exit stops a pending native play, not a cancelled back', async () => {
  let finish!: (value: RecordingPlaybackRange) => void;
  const native = {
    playRange: jest.fn(
      () =>
        new Promise<RecordingPlaybackRange>(resolve => {
          finish = resolve;
        }),
    ),
    stopPlayback: jest.fn(async () => {
      finish({ ...range, completion: 'stopped', actualEndMs: 2500 });
    }),
  };
  const service = createRecordingPlaybackOwner(native);
  function Detail({ focused }: { focused: boolean }) {
    const playback = useRouteRecordingPlayback(service, 'fixture-a', focused);
    return (
      <RecordingPlaybackControls
        active={focused}
        durationMs={12000}
        playbackService={playback}
        recordingId="fixture-a"
      />
    );
  }

  const view = await render(<Detail focused />);
  await fireEvent.press(view.getByTestId('recording-playback-button'));
  expect(native.playRange).toHaveBeenCalledWith('fixture-a', 0, 12000);
  // A cancelled Back never relinquishes focus and must not submit a stop.
  await view.rerender(<Detail focused />);
  expect(native.stopPlayback).not.toHaveBeenCalled();
  await view.rerender(<Detail focused={false} />);
  expect(native.stopPlayback).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(native.stopPlayback).toHaveBeenCalledTimes(1);
});

test('a late retirement or completion cannot stop a replacement playing the same source', async () => {
  const settle: ((result: RecordingPlaybackRange) => void)[] = [];
  const native = {
    playRange: jest.fn(
      () =>
        new Promise<RecordingPlaybackRange>(resolve => {
          settle.push(resolve);
        }),
    ),
    stopPlayback: jest.fn(async () => undefined),
  } satisfies RecordingPlaybackService;
  const port = createRecordingPlaybackOwner(native);
  const first = Symbol();
  const replacement = Symbol();
  const old = port.playRange('fixture-a', 0, 12000, first);
  const next = port.playRange('fixture-a', 1000, 2000, replacement);
  await act(async () => {
    settle[0]?.(range);
    await old;
    await port.stopPlayback?.(first);
  });
  expect(native.stopPlayback).not.toHaveBeenCalled();
  await port.stopPlayback?.(replacement);
  expect(native.stopPlayback).toHaveBeenCalledTimes(1);
  settle[1]?.(range);
  await next;
});
