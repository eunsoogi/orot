import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { useSavedMemories } from '../useSavedMemories';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
const memory = {
  id: 'synthetic',
  text: '합성 삭제 대상 기억',
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: {
    sourceIds: ['synthetic-source'],
    reviewState: 'user_confirmed' as const,
  },
};
const events = [
  notifyLocalDataCleared,
  () => notifyLocalSourceDeleted('local'),
  () => notifyLocalSourceDeleted('healthkit'),
];
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

it.each(events)(
  'offers an explicit protected reload after deletion without restoring stale rows',
  async notify => {
    const load = jest
      .fn()
      .mockResolvedValueOnce([memory])
      .mockResolvedValue([]);
    await render(<SavedMemoryBrowser load={load} />);
    await act(async () => notify());
    expect(screen.queryByText(memory.text)).toBeNull();
    expect(screen.queryByText('아직 저장된 기억이 없어요.')).toBeNull();
    expect(
      screen.getByText('기록이 변경되어 기억을 다시 불러와야 해요.'),
    ).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('다시 불러오기'));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
  },
);

it('keeps a deleted detail absent when an interrupted read completes after the explicit reload', async () => {
  let resolve!: (rows: (typeof memory)[]) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    )
    .mockResolvedValue([]);
  await render(<SavedMemoryDetail memoryId={memory.id} load={load} />);
  await act(async () => notifyLocalSourceDeleted());
  await fireEvent.press(screen.getByText('다시 불러오기'));
  await act(async () => resolve([memory]));
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.getByText('이 기억은 더 이상 볼 수 없어요.')).toBeTruthy();
});

it('shows normal retry on a failed recovery rather than an empty result', async () => {
  const load = jest
    .fn()
    .mockResolvedValueOnce([memory])
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue([]);
  await render(<SavedMemoryBrowser load={load} />);
  await act(async () => notifyLocalDataCleared());
  await fireEvent.press(screen.getByText('다시 불러오기'));
  expect(screen.queryByText('아직 저장된 기억이 없어요.')).toBeNull();
  await fireEvent.press(screen.getByText('다시 시도'));
  expect(screen.getByText('아직 저장된 기억이 없어요.')).toBeTruthy();
});

it('does not issue a queued recovery while hidden or backgrounded', async () => {
  const load = jest.fn().mockResolvedValue([memory]);
  let state!: ReturnType<typeof useSavedMemories>;
  function Probe({ enabled }: { enabled: boolean }) {
    state = useSavedMemories(load, enabled);
    return null;
  }
  const view = await render(<Probe enabled />);
  await act(async () => notifyLocalSourceDeleted());
  const queued = state.refresh;
  await view.rerender(<Probe enabled={false} />);
  await act(async () => queued());
  expect(load).toHaveBeenCalledTimes(1);
  expect(state.rows).toEqual([]);
  await view.rerender(<Probe enabled />);
  const change = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => change('background'));
  await act(async () => {
    notifyLocalDataCleared();
    state.refresh();
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(state.rows).toEqual([]);
});
