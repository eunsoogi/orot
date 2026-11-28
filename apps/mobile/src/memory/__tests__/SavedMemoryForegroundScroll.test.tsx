import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => undefined,
  }),
}));

test('returns to the exact expanded Memory list offset in its original shared scroll host', async () => {
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const listeners = new Set<Parameters<typeof AppState.addEventListener>[1]>();
  const app = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    });
  const phase = async (value: 'inactive' | 'background' | 'active') =>
    act(async () => {
      AppState.currentState = value;
      for (const listener of [...listeners]) listener(value);
    });
  const scrollTo = jest
    .spyOn(ScrollView.prototype, 'scrollTo')
    .mockImplementation(() => undefined);
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: 'synthetic-' + index,
    text: 'Synthetic memory ' + index,
    kind: 'preference' as const,
    createdAt: 1000,
    provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
  }));
  let finish!: (value: typeof rows) => void;
  const load = jest
    .fn()
    .mockResolvedValueOnce(rows)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  const owner = { isCurrent: () => true, subscribe: () => () => undefined };
  const view = await render(
    <NavigationRouteScrollView>
      <SavedMemoryBrowser load={load} ownership={owner} />
    </NavigationRouteScrollView>,
  );
  try {
    await fireEvent.press(await screen.findByText('더 보기'));
    expect(screen.getByText('Synthetic memory 20')).toBeTruthy();
    const host = screen.getByTestId('navigation-route-scroll');
    await fireEvent.scroll(host, {
      nativeEvent: { contentOffset: { x: 0, y: 425 } },
    });
    await phase('inactive');
    await phase('background');
    expect(screen.queryByText('Synthetic memory 20')).toBeNull();
    await phase('active');
    expect(screen.queryByText('Synthetic memory 20')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => finish(rows));
    expect(screen.getByText('Synthetic memory 20')).toBeTruthy();
    expect(screen.getByTestId('navigation-route-scroll')).toBe(host);
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 425, animated: false }),
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    app.mockRestore();
    scrollTo.mockRestore();
    AppState.currentState = previous;
  }
});
