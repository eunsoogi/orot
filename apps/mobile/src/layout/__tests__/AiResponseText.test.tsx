import { act, render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { AiResponseText } from '../AiResponseText';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';

let completions: Array<(result: { finished: boolean }) => void>;
let timing: jest.SpyInstance;
beforeEach(() => {
  completions = [];
  timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: callback => {
      if (callback) completions.push(callback);
    },
    stop: jest.fn(),
    reset: jest.fn(),
  }));
});
afterEach(() => jest.restoreAllMocks());

test('commits intermediate glyph opacity for iOS virtual text instead of requiring a native view', async () => {
  await render(<AiResponseText>새 내용</AiResponseText>);
  expect(timing.mock.calls[0]![1].useNativeDriver).toBe(false);
  const value = timing.mock.calls[0]![0] as Animated.Value;
  expect(screen.getByTestId('ai-response-fragment').props.style.opacity).toBe(
    0,
  );
  await act(() => value.setValue(0.45));
  expect(screen.getByTestId('ai-response-fragment').props.style.opacity).toBe(
    0.45,
  );
});

test('fades only new suffixes, retains selectable text and coalesces completed fragments', async () => {
  const view = await render(
    <AiResponseText selectable testID="answer">
      첫 문장
    </AiResponseText>,
  );
  expect(timing).toHaveBeenCalledTimes(1);
  await act(() => completions[0]!({ finished: true }));
  await view.rerender(
    <AiResponseText selectable testID="answer">
      첫 문장 다음
    </AiResponseText>,
  );
  expect(timing).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('answer')).toHaveTextContent('첫 문장 다음');
  expect(screen.getByTestId('answer').props.selectable).toBe(true);
  await view.rerender(
    <AiResponseText selectable testID="answer">
      첫 문장 다음
    </AiResponseText>,
  );
  expect(timing).toHaveBeenCalledTimes(2);
  await act(() => completions[1]!({ finished: true }));
  expect(screen.getByTestId('answer').props.children).toEqual([
    '첫 문장 다음',
    [],
  ]);
  expect(timing).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      duration: 320,
      useNativeDriver: false,
      isInteraction: false,
    }),
  );
});

test('a replacement discards obsolete draft fragments and ignores their late completion', async () => {
  const view = await render(
    <AiResponseText testID="answer">이전 초안</AiResponseText>,
  );
  await view.rerender(
    <AiResponseText testID="answer">검증된 새 내용</AiResponseText>,
  );
  await act(() => completions[0]!({ finished: true }));
  expect(screen.getByTestId('answer')).toHaveTextContent('검증된 새 내용');
  expect(screen.getByTestId('answer')).not.toHaveTextContent('이전 초안');
  expect(timing).toHaveBeenCalledTimes(2);
});

test('Reduce Motion shows all content immediately and stops an in-progress fade', async () => {
  const content = (reduced: boolean) => (
    <NavigationMotionContext.Provider value={reduced}>
      <AiResponseText testID="answer">전체 내용</AiResponseText>
    </NavigationMotionContext.Provider>
  );
  const view = await render(content(true));
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByTestId('answer')).toHaveTextContent('전체 내용');
  await view.unmount();
  const active = await render(content(false));
  const animation = timing.mock.results[0]!.value;
  await active.rerender(content(true));
  expect(animation.stop).toHaveBeenCalled();
  expect(screen.getByTestId('answer')).toHaveTextContent('전체 내용');
});
