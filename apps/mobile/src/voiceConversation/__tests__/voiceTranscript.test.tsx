import { act, render, renderHook, screen } from '@testing-library/react-native';
import * as Native from 'react-native';
import { VoiceTranscriptViewport } from '../VoiceTranscriptViewport';
import { useVoiceTranscript } from '../useVoiceTranscript';

afterEach(() => jest.restoreAllMocks());

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

test('viewport scales three lines and its opaque fade does not receive touches or accessibility focus', async () => {
  jest
    .spyOn(Native, 'useWindowDimensions')
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
  ).toBe(176);
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
