import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Native from 'react-native';
import { VoiceTranscriptViewport } from '../VoiceTranscriptViewport';
import { useVoiceTranscript } from '../useVoiceTranscript';
import { useAssistantAppearance } from '../../assistantAppearance/AssistantAppearanceProvider';

jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: jest.fn(),
}));

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  jest.mocked(useAssistantAppearance).mockReset();
});

test('transcript keeps twenty bounded items, updates identity and clears without persistence', async () => {
  const hook = await renderHook(() => useVoiceTranscript());
  await act(() => {
    for (let i = 0; i < 25; i++)
      hook.result.current.append({
        id: String(i),
        role: 'user',
        text: 'x'.repeat(13000),
      });
  });
  expect(hook.result.current.lines).toHaveLength(20);
  expect(hook.result.current.lines[0]?.id).toBe('5');
  expect(
    hook.result.current.lines.every(line => line.text.length === 12000),
  ).toBe(true);
  await act(() =>
    hook.result.current.append({
      id: '24',
      role: 'assistant',
      text: 'updated',
    }),
  );
  expect(hook.result.current.lines).toHaveLength(20);
  expect(hook.result.current.lines.at(-1)?.text).toBe('updated');
  await act(() => hook.result.current.clear());
  expect(hook.result.current.lines).toEqual([]);
});

test('viewport scales five lines and its opaque fade does not receive touches or accessibility focus', async () => {
  jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 320, height: 500, scale: 2, fontScale: 2 });
  jest
    .spyOn(Native.AccessibilityInfo, 'isReduceTransparencyEnabled')
    .mockResolvedValue(true);
  await render(
    <VoiceTranscriptViewport
      lines={[{ id: 'one', role: 'user', text: 'synthetic' }]}
    />,
  );
  expect(
    Native.StyleSheet.flatten(
      screen.getByTestId('voice-transcript-viewport').props.style,
    ).height,
  ).toBe(272);
  const fade = screen.getByTestId('voice-transcript-fade', {
    includeHiddenElements: true,
  });
  expect(fade.props.pointerEvents).toBe('none');
  expect(fade.props.accessibilityElementsHidden).toBe(true);
  expect(
    screen.getByTestId('voice-transcript-fade-opaque', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    screen.getByTestId('voice-transcript-scroll').props.nestedScrollEnabled,
  ).toBe(true);
});

test('wide viewport fits five lines, reads the saved name and leaves a gap only between speakers', async () => {
  jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 760, height: 810, scale: 2, fontScale: 1 });
  jest.mocked(useAssistantAppearance).mockReturnValue({
    ready: true,
    value: { name: '합성 도우미', avatar: 'neutral' },
    canEnter: () => true,
    edit: jest.fn(),
  });
  await render(
    <VoiceTranscriptViewport
      lines={[
        { id: 'spoken-input', role: 'user', text: '합성 질문' },
        { id: 'spoken-more', role: 'user', text: '합성 질문 계속' },
        { id: 'spoken-output', role: 'assistant', text: '합성 응답' },
        { id: 'spoken-end', role: 'assistant', text: '합성 응답 계속' },
      ]}
    />,
  );
  expect(screen.getByText('나: 합성 질문')).toBeTruthy();
  expect(screen.getByText('합성 도우미: 합성 응답')).toBeTruthy();
  expect(screen.getByLabelText('합성 도우미: 합성 응답')).toBeTruthy();
  expect(
    screen
      .getAllByTestId('voice-transcript-line')
      .map(line => Native.StyleSheet.flatten(line.props.style).marginTop),
  ).toEqual([undefined, undefined, 24, undefined]);
  expect(
    Native.StyleSheet.flatten(
      screen.getByTestId('voice-transcript-viewport').props.style,
    ).height,
  ).toBe(152);
  expect(
    Native.StyleSheet.flatten(
      screen.getByTestId('voice-transcript-scroll').props.contentContainerStyle,
    ).paddingVertical,
  ).toBe(16);
  for (const id of ['voice-transcript-fade', 'voice-transcript-fade-bottom']) {
    const fade = screen.getByTestId(id, { includeHiddenElements: true });
    expect(fade.props.pointerEvents).toBe('none');
    expect(fade.props.accessibilityElementsHidden).toBe(true);
  }
});

test('only new graphemes fade in; previous speech and the visible accessibility label stay intact', async () => {
  jest.useFakeTimers();
  jest
    .spyOn(Native.AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const caption = (text: string) => (
    <VoiceTranscriptViewport
      lines={[{ id: 'known', role: 'assistant', text }]}
    />
  );
  const fading = () => screen.queryAllByTestId('voice-transcript-fading-text');
  const view = await render(caption('이미'));
  expect(fading()).toEqual([]);
  await view.rerender(caption('이미가나다'));
  expect(fading().map(run => run.props.children)).toEqual(['가나다']);
  expect(screen.getByLabelText('비서: 이미가나다')).toBeTruthy();
  await act(() => jest.advanceTimersByTimeAsync(70));
  const advanced = fading().map(run => run.props.children);
  expect(advanced).toEqual(['가', '나', '다']);
  await view.rerender(caption('이미가나다👩🏽‍🔬'));
  expect(fading().map(run => run.props.children)).toEqual([
    '가',
    '나',
    '다',
    '👩🏽‍🔬',
  ]);
  await act(() => jest.advanceTimersByTimeAsync(250));
  expect(fading()).toEqual([]);
  await view.rerender(caption('이미가나다👩🏽‍🔬'));
  expect(fading()).toEqual([]);
});

test('Reduce Motion renders all speech immediately and enabling motion later never replays it', async () => {
  jest
    .spyOn(Native.AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  let change!: (value: boolean) => void;
  jest
    .spyOn(Native.AccessibilityInfo, 'addEventListener')
    .mockImplementation((name, listener) => {
      if (name === 'reduceMotionChanged') change = listener as typeof change;
      return { remove: jest.fn() };
    });
  const caption = (text: string) => (
    <VoiceTranscriptViewport
      lines={[{ id: 'known', role: 'assistant', text }]}
    />
  );
  const view = await render(caption('이미'));
  await view.rerender(caption('이미 새 내용'));
  expect(screen.queryAllByTestId('voice-transcript-fading-text')).toEqual([]);
  await act(() => change(false));
  expect(screen.queryAllByTestId('voice-transcript-fading-text')).toEqual([]);
  await view.rerender(caption('이미 새 내용!'));
  await waitFor(() =>
    expect(
      screen.getByTestId('voice-transcript-fading-text'),
    ).toHaveTextContent('!'),
  );
  await act(() => change(true));
  expect(screen.queryAllByTestId('voice-transcript-fading-text')).toEqual([]);
  expect(screen.getByLabelText('비서: 이미 새 내용!')).toBeTruthy();
});
