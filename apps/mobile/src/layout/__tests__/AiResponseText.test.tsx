import { act, render, screen } from '@testing-library/react-native';
import { AiResponseText } from '../AiResponseText';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';

let interval: jest.SpyInstance;
let clear: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ now: 1000 });
  interval = jest.spyOn(globalThis, 'setInterval');
  clear = jest.spyOn(globalThis, 'clearInterval');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('paints intermediate glyph opacity and settles into selectable text', async () => {
  await render(
    <AiResponseText selectable testID="answer">
      새 내용
    </AiResponseText>,
  );
  expect(screen.getByTestId('ai-response-fragment').props.style.opacity).toBe(
    0,
  );
  await act(() => jest.advanceTimersByTime(160));
  expect(screen.getByTestId('ai-response-fragment').props.style.opacity).toBe(
    0.5,
  );
  await act(() => jest.advanceTimersByTime(160));
  expect(screen.getByTestId('answer').props.children).toEqual(['새 내용', []]);
  expect(screen.getByTestId('answer').props.selectable).toBe(true);
  expect(clear.mock.calls.map(call => call[0])).toEqual(
    interval.mock.results.map(result => result.value),
  );
});

test('keeps prior text opaque while appended suffix fades independently', async () => {
  const view = await render(
    <AiResponseText testID="answer">첫 문장</AiResponseText>,
  );
  await act(() => jest.advanceTimersByTime(320));
  await view.rerender(
    <AiResponseText testID="answer">첫 문장 다음</AiResponseText>,
  );
  expect(screen.getByTestId('answer').props.children[0]).toBe('첫 문장');
  expect(screen.getByTestId('ai-response-fragment').props.style.opacity).toBe(
    0,
  );
  await act(() => jest.advanceTimersByTime(320));
  expect(screen.getByTestId('answer')).toHaveTextContent('첫 문장 다음');
});

test('replacement discards obsolete ranges and unmount cancels frame work', async () => {
  const view = await render(
    <AiResponseText testID="answer">이전 초안</AiResponseText>,
  );
  await act(() => jest.advanceTimersByTime(160));
  await view.rerender(
    <AiResponseText testID="answer">검증된 새 내용</AiResponseText>,
  );
  await act(() => jest.advanceTimersByTime(320));
  expect(screen.getByTestId('answer')).toHaveTextContent('검증된 새 내용');
  expect(screen.getByTestId('answer')).not.toHaveTextContent('이전 초안');
  await view.rerender(<AiResponseText>다시 시작</AiResponseText>);
  await view.unmount();
  expect(clear.mock.calls.map(call => call[0])).toEqual(
    interval.mock.results.map(result => result.value),
  );
});

test('Reduce Motion exposes all text immediately and stops an active clock', async () => {
  const content = (reduced: boolean) => (
    <NavigationMotionContext.Provider value={reduced}>
      <AiResponseText testID="answer">전체 내용</AiResponseText>
    </NavigationMotionContext.Provider>
  );
  const view = await render(content(true));
  expect(clear.mock.calls.map(call => call[0])).toEqual(
    interval.mock.results.map(result => result.value),
  );
  expect(screen.getByTestId('answer')).toHaveTextContent('전체 내용');
  await view.unmount();
  const active = await render(content(false));
  expect(interval.mock.calls.length - clear.mock.calls.length).toBe(1);
  await active.rerender(content(true));
  expect(clear.mock.calls.map(call => call[0])).toEqual(
    interval.mock.results.map(result => result.value),
  );
  expect(screen.getByTestId('answer')).toHaveTextContent('전체 내용');
});

test('twenty overlapping suffixes share one frame callback and preserve every character', async () => {
  const view = await render(<AiResponseText testID="answer">x</AiResponseText>);
  for (let i = 2; i <= 20; i++) {
    await act(() => jest.advanceTimersByTime(16));
    await view.rerender(
      <AiResponseText testID="answer">{'x'.repeat(i)}</AiResponseText>,
    );
  }
  expect(screen.getAllByTestId('ai-response-fragment')).toHaveLength(20);
  expect(interval).toHaveBeenCalledTimes(1);
  expect(interval.mock.calls.length - clear.mock.calls.length).toBe(1);
  await act(() => jest.advanceTimersByTime(320));
  expect(screen.getByTestId('answer').props.children).toEqual([
    'x'.repeat(20),
    [],
  ]);
  expect(clear.mock.calls.map(call => call[0])).toEqual(
    interval.mock.results.map(result => result.value),
  );
});
