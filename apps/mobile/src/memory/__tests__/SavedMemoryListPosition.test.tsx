import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
const mockPosition = {
  preserve: jest.fn(),
  restore: jest.fn(),
  capture: jest.fn(),
};
const mockProtected = {
  bridgeAvailable: true,
  protectedDataAvailable: jest.fn(async () => true),
  subscribe: jest.fn(),
};
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => mockProtected,
}));
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

test.each([
  'none',
  'lock',
  'owner ABA',
  'owner ABA after scheduling',
  'second suspension after scheduling',
  'source deletion',
  'denied',
] as const)(
  'retains only the position through a verified foreground refresh: %s',
  async interruption => {
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const listeners = new Set<
      Parameters<typeof AppState.addEventListener>[1]
    >();
    const app = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_kind, listener) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      });
    let readProtection:
      | ((event: { kind: 'protectedData'; available: boolean }) => void)
      | undefined;
    mockProtected.subscribe.mockImplementation(listener => {
      readProtection = listener;
      return () => {};
    });
    mockProtected.protectedDataAvailable.mockResolvedValue(
      interruption !== 'denied',
    );
    const phase = (next: 'inactive' | 'background' | 'active') => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
    };
    let current = true;
    const ownerListeners = new Set<() => void>();
    const owner = {
      isCurrent: () => current,
      subscribe: (listener: () => void) => {
        ownerListeners.add(listener);
        return () => {
          ownerListeners.delete(listener);
        };
      },
    };
    const replaceOwner = () => {
      current = false;
      for (const listener of ownerListeners) listener();
      current = true;
      for (const listener of ownerListeners) listener();
    };
    let finish!: (rows: (typeof memory)[]) => void;
    const load = jest
      .fn()
      .mockResolvedValue([memory])
      .mockResolvedValueOnce([memory])
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      );
    const scheduled = jest.fn();
    mockPosition.capture.mockReset().mockReturnValue(scheduled);
    const view = await render(
      <SavedMemoryBrowser load={load} ownership={owner} />,
    );
    try {
      expect(await screen.findByText(memory.text)).toBeTruthy();
      await act(async () => phase('inactive'));
      await act(async () => phase('background'));
      expect(screen.queryByText(memory.text)).toBeNull();
      expect(mockPosition.capture).toHaveBeenCalledTimes(1);
      if (interruption === 'lock') {
        await act(async () =>
          readProtection?.({ kind: 'protectedData', available: false }),
        );
        await act(async () =>
          readProtection?.({ kind: 'protectedData', available: true }),
        );
      }
      if (interruption === 'owner ABA') await act(async () => replaceOwner());
      if (interruption === 'source deletion')
        await act(async () => notifyLocalSourceDeleted('local'));
      await act(async () => phase('active'));
      expect(screen.queryByText(memory.text)).toBeNull();
      expect(scheduled).not.toHaveBeenCalled();
      await act(async () => finish([memory]));
      expect(screen.getByText(memory.text)).toBeTruthy();
      if (
        interruption === 'none' ||
        interruption === 'owner ABA after scheduling' ||
        interruption === 'second suspension after scheduling'
      ) {
        expect(scheduled).toHaveBeenCalledTimes(1);
        const ownsAnimationFrame = scheduled.mock.calls[0]![0] as () => boolean;
        expect(ownsAnimationFrame()).toBe(true);
        if (interruption === 'owner ABA after scheduling') {
          await act(async () => replaceOwner());
          expect(ownsAnimationFrame()).toBe(false);
        }
        if (interruption === 'second suspension after scheduling') {
          await act(async () => phase('background'));
          expect(ownsAnimationFrame()).toBe(false);
        }
      } else expect(scheduled).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
      app.mockRestore();
      AppState.currentState = before;
    }
  },
);
