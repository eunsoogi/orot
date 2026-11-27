import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import {
  appContentLayoutOwner,
  appRouteIsScrollable,
} from '../../navigation/appContentLayoutPolicy';
import {
  openGeometry,
  rotatedGeometry,
} from '../../navigation/__fixtures__/navigationOpenGeometry';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import { resolveNavigationRootLayout } from '../../navigation/navigationRootLayout';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { selectionStore } from '../../aiFeatures/integration/featureServiceFixtures';
import { AppRouteContent } from '../AppRouteContent';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { recordsRouteTestProps } from '../testSupport/recordsRouteTestProps';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(async () => {
    throw new Error('Synthetic settings fixture has no persistent consent');
  }),
}));

const compact: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 390, height: 760 },
  safeAreaInsets: { left: 0, right: 0, top: 46, bottom: 34 },
  hasHinge: false,
  reservedRegionsSupported: false,
  reservedRegions: [],
};

async function publishGeometry(nativeEvent: NavigationGeometryPayload) {
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent },
  );
}

function assertRight(
  geometry: NavigationGeometryPayload,
  saveAvailable: boolean,
) {
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(geometry),
  );
  if (layout.placement !== 'right' || layout.railSide === 'left')
    throw new Error('Expected a genuine right-rail fixture');
  const rail = screen.getByTestId('navigation-right-rail');
  expect(rail.props).toMatchObject({
    layoutMode: 'right',
    railBackTopInset: layout.railTopInset,
    railAvailableHeight: layout.windowHeight,
    actions: [
      expect.objectContaining({ id: 'back', testID: 'navigation-back' }),
    ],
  });
  expect(rail.props.railTopInset).toBeGreaterThan(layout.railTopInset);
  const dock = screen.queryByTestId('navigation-page-action-surface');
  if (saveAvailable) {
    expect(dock?.props.actions).toEqual([
      expect.objectContaining({
        id: 'page:confirm-provider',
        testID: 'provider-selection-confirm',
        disabled: true, // No model is chosen in this synthetic receipt.
      }),
    ]);
    expect(dock?.props.layoutMode).toBe('right');
    expect(dock?.props.railBackTopInset).toBeUndefined();
    expect(dock?.props.railTopInset).toBeGreaterThan(
      rail.props.railBackTopInset + 48,
    );
  } else expect(dock).toBeNull();
  return rail;
}

afterEach(() => jest.restoreAllMocks());

const rootTabs = {
  activeTab: 'settings' as const,
  onSelect: () => undefined,
};

/** Runs the real Settings entries, shared stack, and RN bridge props. The
 * registered native test adapter does not implement UIKit portal ownership.
 */
test.each([
  [
    'settings-privacy',
    'settings-open-privacy',
    'settings-privacy-title',
    false,
  ],
  ['settings-memory', 'settings-open-memory', 'settings-memory-title', false],
  [
    'settings-notifications',
    'settings-open-notifications',
    'settings-notifications-title',
    false,
  ],
  [
    'settings-provider',
    'settings-open-provider',
    'settings-provider-screen',
    true,
  ],
] as const)(
  '%s submits its safe-right Back contract on cold entry and warm geometry changes',
  async (route, row, marker, hasSave) => {
    AppState.currentState = 'active';
    const listeners = new Set<(status: AppStateStatus) => void>();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'change') listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      });
    const setAppState = async (status: AppStateStatus) =>
      act(() => {
        AppState.currentState = status;
        for (const listener of listeners) listener(status);
      });
    const controller = createNavigationController<AppNavigationRoute>('root');
    const persisted = selectionStore(null);
    const committed = jest.fn();
    const props = recordsRouteTestProps();
    const app = (
      <NavigationRouteAdapter
        controller={controller}
        contentLayoutOwner={appContentLayoutOwner}
        scrollable={r => appRouteIsScrollable(r, 'settings')}
        rootTabs={r => (r.name === 'root' ? rootTabs : undefined)}
      >
        {actions => (
          <AppRouteContent
            {...props}
            activeTab="settings"
            actions={actions}
            openProviderSettings={() => controller.push('settings-provider')}
            serviceDependencies={{
              selectedAi: {
                selectionStore: persisted,
                loadAppleOption: async () =>
                  createAppleSelectionOption('available'),
              },
            }}
            onProviderSelectionCommitted={committed}
          />
        )}
      </NavigationRouteAdapter>
    );
    const view = await render(app);
    await publishGeometry(openGeometry);
    await fireEvent.press(screen.getByTestId(row));
    await screen.findByTestId(marker);
    if (hasSave) await screen.findByTestId('provider-selection-confirm');
    await waitFor(() =>
      expect(screen.getByTestId('navigation-back')).toBeEnabled(),
    );
    const cold = assertRight(openGeometry, hasSave);
    await setAppState('background');
    await setAppState('active');
    await publishGeometry(rotatedGeometry);
    await waitFor(() => assertRight(rotatedGeometry, hasSave));
    expect(screen.getByTestId('navigation-right-rail')).toBe(cold);
    await publishGeometry(compact);
    expect(screen.queryByTestId('navigation-right-rail')).toBeNull();
    await publishGeometry(openGeometry);
    await waitFor(() => assertRight(openGeometry, hasSave));
    expect(screen.getAllByTestId('navigation-back')).toHaveLength(1);
    expect(controller.getSnapshot().currentRoute.name).toBe(route);
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() =>
      expect(controller.getSnapshot().currentRoute.name).toBe('root'),
    );
    expect(persisted.save).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
    await view.unmount();
  },
);
