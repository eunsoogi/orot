import { AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SavedMemoryLoaderContext } from '../SavedMemoryLoaderContext';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { resumeStatementMemoryAfterRead } from '../resumeStatementMemoryAfterRead';
jest.mock('../resumeStatementMemoryAfterRead', () => ({
  resumeStatementMemoryAfterRead: jest.fn(),
}));
const memory = {
  id: 'synthetic-memory',
  text: 'Synthetic context memory',
  kind: 'preference' as const,
  createdAt: 1,
  provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
};
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
it('uses the admitted reader, retries one failure and does not schedule projection maintenance', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic read failure'))
    .mockResolvedValue([memory]);
  await render(
    <SavedMemoryLoaderContext.Provider value={load}>
      <SavedMemoryBrowser />
    </SavedMemoryLoaderContext.Provider>,
  );
  await fireEvent.press(screen.getByText('다시 시도'));
  expect(screen.getByText(memory.text)).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
  expect(resumeStatementMemoryAfterRead).not.toHaveBeenCalled();
});
it('keeps foreground and late-result fences around an injected reader', async () => {
  let finish!: (rows: (typeof memory)[]) => void;
  const load = () =>
    new Promise<(typeof memory)[]>(resolve => {
      finish = resolve;
    });
  await render(
    <SavedMemoryLoaderContext.Provider value={load}>
      <SavedMemoryBrowser />
    </SavedMemoryLoaderContext.Provider>,
  );
  await act(async () => {
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]('background');
  });
  await act(async () => finish([memory]));
  expect(screen.queryByText(memory.text)).toBeNull();
});
