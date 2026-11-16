import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
const mockPosition = { preserve: jest.fn(), restore: jest.fn() };
jest.mock('../../navigation/NavigationRouteScrollView', () => ({
  useNavigationRouteScrollPosition: () => mockPosition,
}));
const memory = {
  id: 'synthetic',
  text: 'Synthetic row',
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
};
test('preserves before push and restores only after the returning list is ready', async () => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  let complete!: (rows: (typeof memory)[]) => void;
  const load = jest
    .fn()
    .mockResolvedValueOnce([memory])
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          complete = done;
        }),
    );
  const open = jest.fn(() =>
    expect(mockPosition.preserve).toHaveBeenCalledTimes(1),
  );
  const view = await render(
    <SavedMemoryBrowser load={load} onOpenMemory={open} />,
  );
  await fireEvent.press(screen.getByText(memory.text));
  expect(open).toHaveBeenCalledWith(memory.id);
  await view.rerender(
    <SavedMemoryBrowser load={load} onOpenMemory={open} active={false} />,
  );
  mockPosition.restore.mockClear();
  await view.rerender(
    <SavedMemoryBrowser load={load} onOpenMemory={open} active />,
  );
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(mockPosition.restore).not.toHaveBeenCalled();
  await act(async () => complete([memory]));
  expect(screen.getByText(memory.text)).toBeTruthy();
  expect(mockPosition.restore).toHaveBeenCalledTimes(1);
});
