import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import RecordingPlaybackControls from '../RecordingPlaybackControls';
import { createRecordingPlaybackOwner } from '../recordingPlaybackOwner';
import { useRouteRecordingPlayback } from '../useRouteRecordingPlayback';
import type {
  RecordingPlaybackRange,
  RecordingPlaybackState,
} from '../recordingTypes';

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: object) =>
      React.createElement(require('react-native').View, props),
  };
});

test('one playback control and owned whole-source seek survive native clock updates without restarting', async () => {
  let publish: ((state: RecordingPlaybackState) => void) | undefined;
  let finish: ((range: RecordingPlaybackRange) => void) | undefined;
  const native = {
    playRange: jest.fn(
      () =>
        new Promise<RecordingPlaybackRange>(resolve => {
          finish = resolve;
        }),
    ),
    stopPlayback: jest.fn(async () => {
      publish?.({
        status: 'idle',
        recordingId: null,
        positionMs: 0,
        durationMs: 0,
      });
      finish?.({ startMs: 0, endMs: 30_000, actualStartMs: 0 });
    }),
    seekPlayback: jest.fn(async () => true),
  };
  const service = {
    ...createRecordingPlaybackOwner(native),
    subscribePlayback: (listener: (state: RecordingPlaybackState) => void) => {
      publish = listener;
      return () => {
        publish = undefined;
      };
    },
  };
  function Route({ active }: { active: boolean }) {
    const playback = useRouteRecordingPlayback(
      service,
      'synthetic-record',
      active,
    );
    return (
      <View>
        <RecordingPlaybackControls
          active={active}
          playbackService={playback}
          durationMs={30_000}
          recordingId="synthetic-record"
        />
      </View>
    );
  }
  const view = await render(<Route active />);
  const slider = () => screen.getByTestId('recording-playback-progress');
  const thumb = () =>
    screen.queryByTestId('recording-playback-thumb', {
      includeHiddenElements: true,
    }) ?? slider();
  const reading = (positionMs: number, seekID?: string) => ({
    status: 'playing' as const,
    recordingId: 'synthetic-record',
    positionMs,
    durationMs: 30_000,
    seekEndMs: 30_000,
    seekID,
  });
  try {
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent(slider(), 'slidingComplete', 15_000);
    expect(native.playRange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('recording-playback-button'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId('recording-playback-button')).toBeNull();
    expect(screen.getByTestId('recording-playback-stop')).toHaveAccessibleName(
      '재생 중지',
    );

    await act(async () => publish?.(reading(5_000)));
    expect(slider().props.accessibilityRole).toBe('progressbar'); // Range-only/legacy.
    await act(async () => publish?.(reading(5_000, 'exact-player')));
    expect(slider().props.accessibilityRole).toBe('adjustable');
    // v5.2.2 on iOS produces its first ValueChange before SlidingStart.
    // Keep that order so the old app's early native seek is a real failure.
    await fireEvent(thumb(), 'valueChange', 6_000);
    expect(native.seekPlayback).not.toHaveBeenCalled();
    await fireEvent(thumb(), 'slidingStart', 6_000);
    for (const next of [13_000, 18_000, 15_000]) {
      await fireEvent(thumb(), 'valueChange', next);
      expect(thumb().props.value).toBe(5_000);
    }
    expect(native.seekPlayback).not.toHaveBeenCalled();
    expect(thumb().props.commitOnRelease).toBe(true);
    expect(thumb().props.onSlidingStart).toBeUndefined();
    expect(thumb().props.onValueChange).toBeUndefined();
    expect(screen.getByTestId('recording-playback-position')).toHaveTextContent(
      '00:05',
    );
    await fireEvent(thumb(), 'slidingComplete', 13_000);
    expect(native.seekPlayback).toHaveBeenCalledWith(
      'synthetic-record',
      'exact-player',
      13_000,
    );
    expect(screen.getByTestId('recording-playback-position')).toHaveTextContent(
      '00:05',
    );
    await act(async () => publish?.(reading(13_000, 'exact-player')));
    expect(screen.getByTestId('recording-playback-position')).toHaveTextContent(
      '00:13',
    );
    await fireEvent(slider(), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    await fireEvent(slider(), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(native.seekPlayback.mock.calls).toEqual([
      ['synthetic-record', 'exact-player', 13_000],
      ['synthetic-record', 'exact-player', 18_000],
      ['synthetic-record', 'exact-player', 8_000],
    ]);
    // The native tap emits the same positive completion without a start event.
    await fireEvent(thumb(), 'slidingComplete', 11_000);
    expect(native.seekPlayback).toHaveBeenNthCalledWith(
      4,
      'synthetic-record',
      'exact-player',
      11_000,
    );
    const staleComplete = thumb().props.onSlidingComplete;
    await fireEvent.press(screen.getByTestId('recording-playback-stop'));
    expect(native.stopPlayback).toHaveBeenCalledTimes(1);
    staleComplete(29_000);
    await view.rerender(<Route active={false} />);
    staleComplete(26_000);
    expect(native.seekPlayback).toHaveBeenCalledTimes(4);
    expect(native.playRange).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
  }
});
