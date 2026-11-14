import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';

beforeEach(() => {
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

const memory = {
  id: 'synthetic',
  text: '합성 예시 메모리',
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: {
    sourceIds: ['synthetic-source'],
    reviewState: 'user_confirmed' as const,
  },
};

it('waits for an explicit open, displays persisted text and supports close/reopen', async () => {
  const load = jest.fn().mockResolvedValue([memory]);
  await render(<SavedMemoryBrowser load={load} />);
  expect(load).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  expect(screen.getByText(memory.text)).toBeTruthy();
  expect(screen.getByText('사용자 확인 · 출처 1개')).toBeTruthy();
  await fireEvent.press(screen.getByText('메모리 닫기'));
  expect(screen.queryByText(memory.text)).toBeNull();
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  expect(load).toHaveBeenCalledTimes(2);
});

it('retries failure and renders a genuine empty state', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue([]);
  await render(<SavedMemoryBrowser load={load} />);
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  expect(screen.queryByText('아직 저장된 메모리가 없어요.')).toBeNull();
  await fireEvent.press(screen.getByText('다시 시도'));
  expect(screen.getByText('아직 저장된 메모리가 없어요.')).toBeTruthy();
});

it('discards results from a request closed before completion', async () => {
  let resolve!: (value: (typeof memory)[]) => void;
  const load = () =>
    new Promise<(typeof memory)[]>(done => {
      resolve = done;
    });
  await render(<SavedMemoryBrowser load={load} />);
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  await fireEvent.press(screen.getByText('메모리 닫기'));
  await act(async () => resolve([memory]));
  expect(screen.queryByText(memory.text)).toBeNull();
});

it('clears private content on app backgrounding', async () => {
  const listener = jest.mocked(AppState.addEventListener);
  await render(<SavedMemoryBrowser load={async () => [memory]} />);
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  await act(async () =>
    listener.mock.calls[listener.mock.calls.length - 1][1]('background'),
  );
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.getByText('저장된 메모리 보기')).toBeTruthy();
});

it('bounds displayed rows and resets the page on refresh', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    ...memory,
    id: String(index),
    text: `합성 ${index}`,
  }));
  await render(<SavedMemoryBrowser load={async () => rows} />);
  await fireEvent.press(screen.getByText('저장된 메모리 보기'));
  expect(screen.queryByText('합성 20')).toBeNull();
  await fireEvent.press(screen.getByText('더 보기'));
  expect(screen.getByText('합성 20')).toBeTruthy();
  await fireEvent.press(screen.getByText('새로고침'));
  expect(screen.queryByText('합성 20')).toBeNull();
});
