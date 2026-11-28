import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Dimensions,
  ScrollView,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { RealtimeVoiceSurface } from '../RealtimeVoiceSurface';
import { t } from '../../i18n';
import { liveModel } from '../../voiceSettings/liveVoicePreferences';
import type { RealtimeTranscript } from '../nativeRealtimeVoiceTypes';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({
    ready: true,
    value: { avatar: 'neutral', name: 'Synthetic assistant' },
  }),
}));

const callId = 'synthetic-call';
const lines: RealtimeTranscript[] = Array.from({ length: 9 }, (_, index) => ({
  callId,
  itemId: String(index),
  role: index % 2 ? 'user' : 'assistant',
  text: 'Synthetic speech ' + index,
}));
const priorWindow = Dimensions.get('window');
const priorScreen = Dimensions.get('screen');
beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
});
afterEach(async () => {
  await act(() => Dimensions.set({ window: priorWindow, screen: priorScreen }));
  jest.restoreAllMocks();
});
async function windowSize(width: number, height: number, fontScale: number) {
  const size = { width, height, fontScale, scale: 2 };
  await act(() => Dimensions.set({ window: size, screen: size }));
}
const insetLayout = (width: number, height: number) =>
  fireEvent(screen.getByTestId('voice-call-screen'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });

function expectHeroStack(status: string) {
  const identity = screen.getByTestId('voice-call-identity');
  const focus = identity.parent?.parent;
  const activity = screen.getByTestId('voice-activity-symbol', {
    includeHiddenElements: true,
  });
  const statusLabel = screen.getByText(status);
  expect(identity).toHaveStyle({
    flexDirection: 'column',
    alignItems: 'center',
  });
  expect(focus).toHaveStyle({ flexDirection: 'column', alignItems: 'center' });
  expect(focus?.children.slice(0, 3)).toEqual([
    identity.parent,
    activity.parent,
    statusLabel,
  ]);
  expect(identity.children[1]).toHaveProp('accessibilityRole', 'header');
  expect(statusLabel).toHaveProp('accessibilityLiveRegion', 'polite');
}

test.each([
  { width: 466, height: 678, safeWidth: 382, safeHeight: 590, fontScale: 2 },
  { width: 760, height: 520, safeWidth: 686, safeHeight: 466, fontScale: 1 },
  { width: 951, height: 669, safeWidth: 867, safeHeight: 600, fontScale: 1 },
])(
  'only transcript scrolls; the call controls remain usable ($width × $height)',
  async ({ width, height, safeWidth, safeHeight, fontScale }) => {
    await windowSize(width, height, fontScale);
    const stop = jest.fn();
    const mute = jest.fn();
    const resume = jest.fn();
    const call = (phase: 'listening' | 'stopped', transcripts = lines) => (
      <RealtimeVoiceSurface
        visible
        state={{
          phase,
          identity: { sessionId: 1, providerId: 'fixture', turnId: callId },
        }}
        status="Synthetic listening"
        model={liveModel}
        transcripts={transcripts}
        disabled={false}
        statusExternallyRendered={false}
        start={jest.fn()}
        stop={stop}
        mute={mute}
        resume={resume}
        onDismiss={jest.fn()}
      />
    );
    const view = await render(call('listening'));
    const transcript = screen.getByTestId('voice-transcript-scroll');
    const scrolls = view.container.queryAll(
      item => item.type === transcript.type,
    );
    expect(scrolls.map(item => item.props.testID)).toEqual([
      'voice-transcript-scroll',
    ]);
    const shell = screen.getByTestId('voice-call-screen');
    expect(shell.type).not.toBe(transcript.type);
    await insetLayout(safeWidth, safeHeight);
    expectHeroStack('Synthetic listening');
    expect(screen.getByTestId('voice-transcript-viewport')).toHaveStyle({
      flexShrink: 1,
    });
    for (const id of ['voice-transcript-fade', 'voice-transcript-fade-bottom'])
      expect(
        screen.getByTestId(id, { includeHiddenElements: true }).props
          .pointerEvents,
      ).toBe('none');
    expect(
      StyleSheet.flatten(
        screen.getByTestId('voice-transcript-viewport').props.style,
      ).height,
    ).toBe(5 * 24 * fontScale + 32);
    expect(screen.getAllByTestId('voice-transcript-line')).toHaveLength(9);
    for (const id of ['voice-call-mute', 'voice-call-end']) {
      const control = screen.getByTestId(id);
      expect(control.props.accessibilityRole).toBe('button');
      expect(
        transcript.queryAll(item => item.props.testID === id),
      ).toHaveLength(0);
      expect(
        StyleSheet.flatten(control.props.style).minWidth,
      ).toBeGreaterThanOrEqual(44);
      expect(
        control.queryAll(item => {
          const targetHeight = StyleSheet.flatten<ViewStyle>(
            item.props.style,
          )?.height;
          return typeof targetHeight === 'number' && targetHeight >= 44;
        }),
      ).not.toHaveLength(0);
    }
    await fireEvent.press(screen.getByTestId('voice-call-mute'));
    expect(mute).toHaveBeenCalledTimes(1);
    await view.rerender(call('stopped', []));
    expectHeroStack(t('ragConversation.voice.muted'));
    expect(screen.queryAllByTestId('voice-transcript-line')).toHaveLength(0);
    expect(screen.getByTestId('voice-transcript-scroll')).toBe(transcript);
    await fireEvent.press(screen.getByTestId('voice-call-resume'));
    await fireEvent.press(screen.getByTestId('voice-call-end'));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  },
);

test('Live transcript keeps reader scroll-back over a safe-area reflow and still follows at the bottom', async () => {
  await windowSize(466, 678, 1);
  const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const call = (transcripts: RealtimeTranscript[]) => (
    <RealtimeVoiceSurface
      visible
      state={{
        phase: 'listening',
        identity: { sessionId: 1, providerId: 'fixture', turnId: callId },
      }}
      status="Synthetic"
      model={liveModel}
      transcripts={transcripts}
      disabled={false}
      statusExternallyRendered={false}
      start={jest.fn()}
      stop={jest.fn()}
      mute={jest.fn()}
      resume={jest.fn()}
      onDismiss={jest.fn()}
    />
  );
  const view = await render(call(lines));
  const viewport = () => screen.getByTestId('voice-transcript-scroll');
  const scroll = (offset: number) =>
    fireEvent.scroll(viewport(), {
      nativeEvent: {
        contentOffset: { x: 0, y: offset },
        contentSize: { width: 340, height: 500 },
        layoutMeasurement: { width: 340, height: 152 },
      },
    });
  await insetLayout(382, 590);
  await scroll(348);
  await fireEvent(viewport(), 'scrollBeginDrag');
  await scroll(40);
  await fireEvent(viewport(), 'scrollEndDrag');
  end.mockClear();
  expect(
    StyleSheet.flatten(screen.getByTestId('voice-call-screen').props.style)
      .padding,
  ).toBe(12);
  await windowSize(669, 951, 1);
  await insetLayout(635, 850);
  expectHeroStack('Synthetic');
  expect(
    StyleSheet.flatten(screen.getByTestId('voice-call-screen').props.style)
      .padding,
  ).toBe(24);
  await view.rerender(call([...lines, { ...lines[0]!, itemId: 'next' }]));
  await fireEvent(viewport(), 'contentSizeChange', 600, 500);
  expect(end).not.toHaveBeenCalled();
  await scroll(348);
  await fireEvent(viewport(), 'contentSizeChange', 600, 560);
  expect(end).toHaveBeenCalledWith({ animated: false });
});
