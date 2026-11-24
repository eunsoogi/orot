import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
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
  const active = () => view.queryByText('waveform/34', hidden);
  const emitNow = async (packet: VoiceAudioLevel) => {
    await act(() => emit(packet));
  };
  await emitNow(sample(1, old));
  await emitNow(sample(1, current, 'input'));
  expect(active()).toBeNull();
  await emitNow(sample(1));
  expect(active()).toBeTruthy();
  await emitNow(sample(0));
  expect(active()).toBeNull();
  await act(() => {
    jest.advanceTimersByTime(100);
  });
  await emitNow(sample(1));
  expect(active()).toBeTruthy();
  await act(() => {
    jest.advanceTimersByTime(241);
  });
  expect(active()).toBeNull();
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
  expect(active()).toBeNull();
  await emitNow(sample(1, old));
  expect(active()).toBeTruthy();
  await view.rerender(
    <VoiceActivityIndicator
      visible
      phase="stopped"
      callId={old}
      subscribe={subscribe}
    />,
  );
  await emitNow(sample(1, old));
  expect(active()).toBeNull();
  expect(view.getByText('mic.slash/20', hidden)).toBeTruthy();
  expect(retired).toHaveBeenCalledTimes(2);
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
  expect(view.getByText('waveform/20', hidden)).toBeTruthy();
  expect(subscribe).not.toHaveBeenCalled();
  for (const value of [NaN, Infinity, -1, 1.1])
    expect(parseVoiceAudioLevel(sample(value))).toBeUndefined();
  expect(
    parseVoiceAudioLevel({ ...sample(0.4), pcm: 'do not retain' }),
  ).toEqual(sample(0.4));
});
