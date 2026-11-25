import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { VoiceActivityIndicator } from '../VoiceActivityIndicator';
import {
  parseVoiceAudioLevel,
  type VoiceAudioLevel,
} from '../nativeVoiceAudioLevel';

jest.mock('../../layout/AppSymbol', () => ({
  AppSymbol: ({ name, size }: { name: string; size: number }) => {
    const { Text } = require('react-native');
    return <Text>{name + '/' + size}</Text>;
  },
}));
const hidden = { includeHiddenElements: true };
const bars = (view: Awaited<ReturnType<typeof render>>) =>
  view
    .queryAllByTestId('voice-activity-waveform-bar', hidden)
    .map(bar => Number(StyleSheet.flatten<ViewStyle>(bar.props.style)?.height));
const old = 'live-fixture-old';
const current = 'live-fixture';
const sample = (
  level: number,
  callId = current,
  direction: VoiceAudioLevel['direction'] = 'output',
) => ({ level, callId, direction });

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('connecting reuses all three Conversation dots with no audio subscription', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const subscribe = jest.fn();
  const view = await render(
    <VoiceActivityIndicator
      visible
      phase="authorizing"
      callId={current}
      subscribe={subscribe}
    />,
  );
  expect(
    view.getAllByTestId('rag-conversation-activity-dot', hidden),
  ).toHaveLength(3);
  expect(subscribe).not.toHaveBeenCalled();
});

test('only current rendered output moves, then stops for silence, expiry, owner change and mute', async () => {
  jest.useFakeTimers();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const retired = jest.fn();
  let emit!: (value: VoiceAudioLevel) => void;
  const subscribe = (listener: typeof emit) => {
    emit = listener;
    return retired;
  };
  const view = await render(
    <VoiceActivityIndicator
      visible
      phase="speaking"
      callId={current}
      subscribe={subscribe}
    />,
  );
  const idle = bars(view);
  const active = () => bars(view).some((height, i) => height > (idle[i] ?? 0));
  const emitNow = async (packet: VoiceAudioLevel) => {
    await act(() => emit(packet));
  };
  await emitNow(sample(1, old));
  await emitNow(sample(1, current, 'input'));
  expect(active()).toBe(false);
  await emitNow(sample(1));
  expect(active()).toBe(true);
  await emitNow(sample(0));
  expect(active()).toBe(false);
  await act(() => {
    jest.advanceTimersByTime(100);
  });
  await emitNow(sample(1));
  expect(active()).toBe(true);
  await act(() => {
    jest.advanceTimersByTime(241);
  });
  expect(active()).toBe(false);
  const stale = emit;
  await view.rerender(
    <VoiceActivityIndicator
      visible
      phase="speaking"
      callId={old}
      subscribe={subscribe}
    />,
  );
  await act(() => stale(sample(1)));
  expect(active()).toBe(false);
  await emitNow(sample(1, old));
  expect(active()).toBe(true);
  await view.rerender(
    <VoiceActivityIndicator
      visible
      phase="stopped"
      callId={old}
      subscribe={subscribe}
    />,
  );
  await emitNow(sample(1, old));
  expect(active()).toBe(false);
  expect(view.getByText('mic.slash/20', hidden)).toBeTruthy();
  expect(retired).toHaveBeenCalledTimes(2);
});

test('quiet current microphone samples visibly change bars', async () => {
  jest.useFakeTimers();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  let emit!: (value: VoiceAudioLevel) => void;
  const view = await render(
    <VoiceActivityIndicator
      visible
      phase="listening"
      callId={current}
      subscribe={listener => {
        emit = listener;
        return undefined;
      }}
    />,
  );
  const idle = bars(view);
  const center = () => bars(view)[2] ?? 0;
  const scale = () => {
    const style = StyleSheet.flatten<{
      transform?: readonly { scale?: number }[];
    }>(view.getByTestId('voice-activity-waveform', hidden).props.style);
    return style?.transform?.[0]?.scale ?? 1;
  };
  expect(idle).toHaveLength(5);
  expect(scale()).toBe(1);
  await act(() => emit(sample(0.03)));
  expect(bars(view)).toEqual(idle);
  await act(() => emit(sample(0.03, current, 'input')));
  const quiet = center();
  const quietScale = scale();
  expect(quietScale).toBeGreaterThanOrEqual(1.25);
  expect(quiet).toBeGreaterThan((idle[2] ?? 0) + 4);
  await act(() => {
    jest.advanceTimersByTime(100);
    emit(sample(0.08, current, 'input'));
  });
  expect(center()).toBeGreaterThan(quiet + 2);
  expect(scale()).toBeGreaterThan(quietScale);
  expect(scale()).toBeLessThanOrEqual(1.4);
  await act(() => {
    jest.advanceTimersByTime(241);
  });
  expect(bars(view)).toEqual(idle);
  expect(scale()).toBe(1);
});

test('reduced motion keeps a static mark and invalid or PCM-bearing input is never retained', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const subscribe = jest.fn();
  const view = await render(
    <VoiceActivityIndicator
      visible
      phase="listening"
      callId={current}
      subscribe={subscribe}
    />,
  );
  expect(bars(view)).toHaveLength(5);
  expect(subscribe).not.toHaveBeenCalled();
  for (const value of [NaN, Infinity, -1, 1.1])
    expect(parseVoiceAudioLevel(sample(value))).toBeUndefined();
  expect(
    parseVoiceAudioLevel({ ...sample(0.4), pcm: 'do not retain' }),
  ).toEqual(sample(0.4));
});
