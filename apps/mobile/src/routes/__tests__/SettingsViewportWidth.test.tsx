import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { SettingsMemoryRoute } from '../SettingsMemoryRoute';
import { SettingsNotificationsRoute } from '../SettingsNotificationsRoute';
import { SettingsRoute } from '../SettingsRoute';

jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

afterEach(() => Dimensions.set(originalDimensions));

function settingsHome() {
  return (
    <NavigationRouteScrollView>
      <SettingsRoute
        selectedProvider="Synthetic"
        onOpenProviderSettings={jest.fn()}
        onOpenAccounts={jest.fn()}
        onOpenPrivacy={jest.fn()}
        onOpenMemory={jest.fn()}
        onOpenDisplayMode={() => {}}
        onOpenNotifications={jest.fn()}
        onOpenPrivacyPolicy={jest.fn()}
        onOpenHealthData={jest.fn()}
        onOpenSyncStatus={jest.fn()}
      />
    </NavigationRouteScrollView>
  );
}

const routes = [
  {
    name: 'home',
    renderRoute: settingsHome,
    layout: 'settings-layout',
    title: 'settings-title',
    group: 'settings-destinations',
    scroll: 'navigation-route-scroll',
  },
  {
    name: 'Memory',
    renderRoute: () => <SettingsMemoryRoute />,
    layout: 'settings-memory-layout',
    title: 'settings-memory-title',
    group: 'settings-memory-controls',
    scroll: 'settings-memory-scroll',
  },
  {
    name: 'Notifications',
    renderRoute: () => <SettingsNotificationsRoute />,
    layout: 'settings-notifications-layout',
    title: 'settings-notifications-title',
    group: 'settings-notifications',
    scroll: 'settings-notifications-scroll',
  },
];

describe.each(routes)(
  'Settings $name',
  ({ renderRoute, title, group, layout, scroll }) => {
    test.each([
      { width: 948, side: 'right' as const, rail: 84 },
      { width: 390, side: 'bottom' as const, rail: 0 },
    ])(
      'fills the route inside the $side navigation rail at width $width',
      async ({ width, side, rail }) => {
        Dimensions.set({
          window: { ...originalDimensions.window, width, fontScale: 1 },
          screen: { ...originalDimensions.screen, width, fontScale: 1 },
        });
        const frame = { x: 0, y: 0, width, height: 700 };
        await render(
          <NavigationContentFrameContext.Provider
            value={{
              side,
              windowFrame: frame,
              viewportFrame: frame,
              availableContentFrame: { ...frame, width: width - rail },
              navigationFrame: null,
              reservedRegions: [],
            }}
          >
            <NavigationOcclusionContext.Provider
              value={resolveNavigationOcclusion({
                placement: side,
                reservedRightWidth: rail,
                systemBottomInset: 34,
                measuredBottomActionOcclusion: 0,
                systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
              })}
            >
              {renderRoute()}
            </NavigationOcclusionContext.Provider>
          </NavigationContentFrameContext.Provider>,
        );

        // Check the actual mounted shell and its page together; a 100% page with a
        // maxWidth would still render narrower than the adaptive lane.
        expect(
          StyleSheet.flatten(
            screen.getByTestId(`${layout}-primary`).props.style,
          ).width,
        ).toBe(width - rail);
        const page = StyleSheet.flatten(
          screen.getByTestId(title).parent?.props.style,
        );
        expect(page.width).toBe('100%');
        expect(Math.min(width - rail, page.maxWidth ?? Infinity)).toBe(
          width - rail,
        );
        expect(page.paddingHorizontal ?? page.padding).toBe(20);
        expect(page.paddingTop).toBe(24);
        expect(
          StyleSheet.flatten(screen.getByTestId(title).props.style),
        ).toEqual(
          expect.objectContaining({
            fontSize: 34,
            fontWeight: '700',
          }),
        );
        expect(screen.getByTestId(group)).toBeVisible();
        expect(
          StyleSheet.flatten(screen.getByTestId(scroll).props.style)
            ?.marginRight ?? 0,
        ).toBe(-rail || 0);
      },
    );
  },
);
