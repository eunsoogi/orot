import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useRealtimeToolConfirmation } from '../useRealtimeToolConfirmation';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
let controller: ReturnType<typeof useRealtimeToolConfirmation>;
function Harness() {
  controller = useRealtimeToolConfirmation();
  return controller.node;
}
let stateChanged: (state: AppStateStatus) => void;
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      stateChanged = listener;
      return { remove: jest.fn() };
    });
});
afterEach(() => jest.restoreAllMocks());
const input = () => ({
  text: '  합성 요청을 그대로 실행해 주세요.  ',
  recipient: 'Synthetic provider',
  model: 'synthetic-model',
  signal: new AbortController().signal,
});

it('shows exact text, recipient, cost/storage and separate-result boundaries before explicit approval', async () => {
  await render(<Harness />);
  let decision!: Promise<boolean>;
  await act(() => {
    decision = controller.confirm(input());
  });
  expect(
    screen.getByTestId('realtime-tool-confirmation-text').props.children,
  ).toBe(input().text);
  expect(screen.getByText('처리할 제공자: Synthetic provider')).toBeTruthy();
  expect(screen.getByText('선택한 모델: synthetic-model')).toBeTruthy();
  expect(screen.getByText(/앱 대화에 저장해요/)).toBeTruthy();
  expect(screen.getByText(/추가 사용료/)).toBeTruthy();
  expect(screen.getByText(/자동으로 고치지 않아요/)).toBeTruthy();
  expect(screen.getByText(/다시 승인해야 해요/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('realtime-tool-confirmation-allow'));
  expect(await decision).toBe(true);
  expect(screen.queryByTestId('realtime-tool-confirmation-modal')).toBeNull();
});

it('rejects overlapping requests and ignores an old modal decision after cancellation', async () => {
  await render(<Harness />);
  let first!: Promise<boolean>;
  await act(() => {
    first = controller.confirm(input());
  });
  const staleAllow = screen.getByTestId('realtime-tool-confirmation-modal')
    .props.onRequestClose;
  expect(await controller.confirm(input())).toBe(false);
  await fireEvent.press(
    screen.getByTestId('realtime-tool-confirmation-cancel'),
  );
  expect(await first).toBe(false);
  let next!: Promise<boolean>;
  await act(() => {
    next = controller.confirm(input());
  });
  await act(() => staleAllow());
  expect(screen.getByTestId('realtime-tool-confirmation-modal')).toBeTruthy();
  await fireEvent(
    screen.getByTestId('realtime-tool-confirmation-modal'),
    'requestClose',
  );
  expect(await next).toBe(false);
});

it.each(['abort', 'background', 'inactive', 'unmount'] as const)(
  'fails closed and closes on %s',
  async cause => {
    const rendered = await render(<Harness />);
    const abort = new AbortController();
    let decision!: Promise<boolean>;
    await act(() => {
      decision = controller.confirm({ ...input(), signal: abort.signal });
    });
    if (cause === 'unmount') await rendered.unmount();
    else
      await act(() => {
        if (cause === 'abort') abort.abort();
        else stateChanged(cause);
      });
    expect(await decision).toBe(false);
    if (cause !== 'unmount')
      expect(
        screen.queryByTestId('realtime-tool-confirmation-modal'),
      ).toBeNull();
  },
);

it('rejects background, aborted, empty and unmounted requests without showing UI', async () => {
  const rendered = await render(<Harness />);
  const abort = new AbortController();
  abort.abort();
  expect(await controller.confirm({ ...input(), signal: abort.signal })).toBe(
    false,
  );
  expect(await controller.confirm({ ...input(), text: ' ' })).toBe(false);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  expect(await controller.confirm(input())).toBe(false);
  await rendered.unmount();
  expect(await controller.confirm(input())).toBe(false);
});

it('snapshots the displayed request and rejects an approval after foreground is lost', async () => {
  await render(<Harness />);
  const original = input();
  let decision!: Promise<boolean>;
  await act(() => {
    decision = controller.confirm(original);
  });
  original.text = 'Changed after showing the prompt';
  expect(
    screen.getByTestId('realtime-tool-confirmation-text').props.children,
  ).toBe(input().text);
  // A foreground read at the final decision also covers a delayed AppState event.
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  await fireEvent.press(screen.getByTestId('realtime-tool-confirmation-allow'));
  expect(await decision).toBe(false);
});
