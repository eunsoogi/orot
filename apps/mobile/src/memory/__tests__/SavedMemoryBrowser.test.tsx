import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { AppState } from 'react-native';
import { useSavedMemories } from '../useSavedMemories';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

afterEach(() => jest.useRealTimers());

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const memory = {
  id: 'synthetic',
  text: '합성 예시 기억',
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: {
    sourceIds: ['synthetic-source'],
    reviewState: 'user_confirmed' as const,
  },
};

it('loads concise rows on entry and opens details by ID without refresh or close controls', async () => {
  const load = jest.fn().mockResolvedValue([memory]);
  const open = jest.fn();
  await render(<SavedMemoryBrowser load={load} onOpenMemory={open} />);
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('새로고침')).toBeNull();
  expect(screen.queryByRole('button', { name: '기억 닫기' })).toBeNull();
  expect(screen.queryByText('사용자 확인 · 출처 1개')).toBeNull();
  expect(screen.getByTestId(`saved-memory-entry-${memory.id}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`saved-memory-entry-${memory.id}`));
  expect(open).toHaveBeenCalledWith(memory.id);
  expect(load).toHaveBeenCalledTimes(1);
});

it('retries failure and renders a genuine empty state', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue([]);
  await render(<SavedMemoryBrowser load={load} />);
  expect(screen.queryByText('아직 저장된 기억이 없어요.')).toBeNull();
  await fireEvent.press(screen.getByText('다시 시도'));
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
});

it('discards results from a request closed before completion', async () => {
  let resolve!: (value: (typeof memory)[]) => void;
  const load = () =>
    new Promise<(typeof memory)[]>(done => {
      resolve = done;
    });
  await render(<SavedMemoryBrowser load={load} />);
  await act(async () =>
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]('background'),
  );
  await act(async () => resolve([memory]));
  expect(screen.queryByText(memory.text)).toBeNull();
});

it('clears private content on app backgrounding', async () => {
  const listener = jest.mocked(AppState.addEventListener);
  await render(<SavedMemoryBrowser load={async () => [memory]} />);
  await act(async () =>
    listener.mock.calls[listener.mock.calls.length - 1][1]('background'),
  );
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByText(memory.text)).toBeNull();
});

it('bounds rows and retains the expanded page after foreground reload', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    ...memory,
    id: String(index),
    text: `합성 ${index}`,
  }));
  await render(<SavedMemoryBrowser load={async () => rows} />);
  expect(screen.queryByText('합성 20')).toBeNull();
  await fireEvent.press(screen.getByText('더 보기'));
  expect(screen.getByText('합성 20')).toBeTruthy();
  const change = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => change('background'));
  await act(async () => change('active'));
  expect(screen.getByText('합성 20')).toBeTruthy();
});

const deletionEvents = [
  ['all data', () => notifyLocalDataCleared()],
  ['local source', () => notifyLocalSourceDeleted('local')],
  ['HealthKit source', () => notifyLocalSourceDeleted('healthkit')],
] as const;

it.each(deletionEvents)(
  'clears cached memory after %s deletion',
  async (_name, notify) => {
    await render(<SavedMemoryBrowser load={async () => [memory]} />);
    expect(screen.getByText(memory.text)).toBeTruthy();
    await act(async () => notify());
    expect(screen.queryByText(memory.text)).toBeNull();
    expect(screen.queryByText('새로고침')).toBeNull();
  },
);

it.each(deletionEvents)(
  'rejects late reads after %s deletion and permits a fresh open',
  async (_name, notify) => {
    let resolve!: (value: (typeof memory)[]) => void;
    const load = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(done => {
            resolve = done;
          }),
      )
      .mockResolvedValue([]);
    await render(<SavedMemoryBrowser load={load} />);
    await act(async () => notify());
    await act(async () =>
      jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]('active'),
    );
    await act(async () => resolve([memory]));
    expect(screen.queryByText(memory.text)).toBeNull();
    expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
  },
);

it('reloads automatically after returning active and rejects the interrupted read', async () => {
  let resolve!: (value: (typeof memory)[]) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    )
    .mockResolvedValue([]);
  await render(<SavedMemoryBrowser load={load} />);
  const listener = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => listener('background'));
  await act(async () => listener('active'));
  await act(async () => resolve([memory]));
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
});

it.each(['background', 'inactive', null] as const)(
  'waits for active state before reading when initially %s',
  async initialState => {
    AppState.currentState = initialState;
    const load = jest.fn().mockResolvedValue([memory]);
    await render(<SavedMemoryBrowser load={load} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByText(memory.text)).toBeNull();
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)![1];
    await act(async () => listener('active'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByText(memory.text)).toBeTruthy();
  },
);

it('bounds an interrupted read and ignores its late result after retry', async () => {
  jest.useFakeTimers();
  let resolve!: (value: (typeof memory)[]) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    )
    .mockResolvedValue([]);
  const view = await render(<SavedMemoryBrowser load={load} />);
  await act(async () => jest.advanceTimersByTime(10_000));
  expect(screen.getByText('다시 시도')).toBeTruthy();
  expect(screen.queryByText('아직 저장된 기억이 없어요.')).toBeNull();
  await fireEvent.press(screen.getByText('다시 시도'));
  await act(async () => resolve([memory]));
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
  await view.unmount();
  jest.useRealTimers();
});

it('does not read from a queued retry action while backgrounded', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue([memory]);
  let state!: ReturnType<typeof useSavedMemories>;
  function Probe() {
    state = useSavedMemories(load);
    return null;
  }
  await render(<Probe />);
  const retry = state.refresh;
  const listener = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => listener('background'));
  await act(async () => retry());
  expect(load).toHaveBeenCalledTimes(1);
  expect(state.rows).toEqual([]);
  await act(async () => listener('active'));
  expect(load).toHaveBeenCalledTimes(2);
  expect(state.rows).toEqual([memory]);
});

it('clears the read timer when unmounted without accepting late content', async () => {
  jest.useFakeTimers();
  const scheduled = jest.spyOn(globalThis, 'setTimeout');
  const cleared = jest.spyOn(globalThis, 'clearTimeout');
  let resolve!: (value: (typeof memory)[]) => void;
  const view = await render(
    <SavedMemoryBrowser
      load={() =>
        new Promise(done => {
          resolve = done;
        })
      }
    />,
  );
  const index = scheduled.mock.calls.findIndex(([, delay]) => delay === 10_000);
  expect(index).toBeGreaterThanOrEqual(0);
  const handle = scheduled.mock.results[index].value;
  await view.unmount();
  expect(cleared).toHaveBeenCalledWith(handle);
  await act(async () => resolve([memory]));
  scheduled.mockRestore();
  cleared.mockRestore();
  jest.useRealTimers();
});
