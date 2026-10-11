import { act, render } from '@testing-library/react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useNativeRouteRemoval } from '../useNativeRouteRemoval';
import type { NavigationRoute } from '../navigationController';
import type { NativeRouteParamList } from '../nativeRouteRegistry';

const rootRoute: NavigationRoute<string> = { key: 'root', name: 'home' };
const childRoute: NavigationRoute<string> = {
  key: 'child',
  name: 'details',
};

describe('native route removal reconciliation', () => {
  it('keeps a completed pop pending until the latest logical and native stacks agree', async () => {
    const nativeKeys = { current: ['root', 'child'] as string[] };
    const navigationRef = {
      dispatch: jest.fn(),
      getRootState: () => ({
        routes: nativeKeys.current.map(routeKey => ({
          key: `native-${routeKey}`,
          name: 'scene',
          params: { routeKey },
        })),
      }),
    } as unknown as NavigationContainerRefWithCurrent<NativeRouteParamList>;
    const onRemovalComplete = jest.fn();
    let actions: ReturnType<typeof useNativeRouteRemoval<string>> | undefined;

    function Probe({
      nativeRevision,
      routes,
    }: {
      readonly nativeRevision: number;
      readonly routes: readonly NavigationRoute<string>[];
    }) {
      actions = useNativeRouteRemoval({
        navigationRef,
        nativeRevision,
        onNativeRouteRemovalComplete: onRemovalComplete,
        ready: true,
        reduceMotion: false,
        routes,
      });
      return null;
    }

    const view = await render(
      <Probe nativeRevision={0} routes={[rootRoute, childRoute]} />,
    );
    const staleTransitionListener = actions?.markNativeTransitionComplete;
    await view.rerender(<Probe nativeRevision={0} routes={[rootRoute]} />);
    await act(async () =>
      actions?.trackRemovedRoutes(['root', 'child'], ['root']),
    );

    // UIKit may report the revealed route before its native stack state update.
    await act(async () => staleTransitionListener?.('root', false));
    expect(onRemovalComplete).not.toHaveBeenCalled();

    nativeKeys.current = ['root'];
    await view.rerender(<Probe nativeRevision={1} routes={[rootRoute]} />);

    expect(onRemovalComplete).toHaveBeenCalledTimes(1);
    expect(onRemovalComplete).toHaveBeenCalledWith('child');
    await act(async () => actions?.markNativeTransitionComplete('root', false));
    expect(onRemovalComplete).toHaveBeenCalledTimes(1);
  });
});
