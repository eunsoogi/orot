import { Dimensions, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { SettingsRoute } from '../SettingsRoute';
import { settingsRouteResolverOptions } from '../settingsRouteTestSupport';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

test('keeps one settings end gutter beyond the navigation overlap', async () => {
  await render(
    <NavigationOcclusionContext.Provider
      value={{
        placement: 'bottom',
        systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        viewportInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        scrollContentInsets: { top: 0, right: 0, bottom: 52, left: 0 },
      }}
    >
      <NavigationRouteScrollView>
        <SettingsRoute
          selectedProvider="Cached provider label"
          selectedAiResolverOptions={settingsRouteResolverOptions()}
          onOpenProviderSettings={jest.fn()}
          onOpenAccounts={jest.fn()}
          onOpenPrivacy={jest.fn()}
          onOpenBackup={jest.fn()}
          onOpenHealthData={jest.fn()}
          onOpenSyncStatus={jest.fn()}
        />
      </NavigationRouteScrollView>
    </NavigationOcclusionContext.Provider>,
  );
  const scroll = StyleSheet.flatten(
    screen.getByTestId('navigation-route-scroll').props.contentContainerStyle,
  );
  const panel = StyleSheet.flatten(
    screen.getByTestId('settings-title').parent!.props.style,
  );
  expect(scroll.paddingBottom + panel.paddingBottom).toBe(80);
});

afterEach(() => {
  Dimensions.set(originalDimensions);
});

function setWindowSize(width: number, fontScale: number) {
  // AdaptiveColumns follows the available viewport and the native text scale.
  const window = Dimensions.get('window');
  const screenBounds = Dimensions.get('screen');
  Dimensions.set({
    window: { ...window, width, fontScale },
    screen: { ...screenBounds, width, fontScale },
  });
}

test.each([
  { layout: 'compact', width: 390, fontScale: 1 },
  { layout: 'expanded', width: 1000, fontScale: 1 },
  { layout: 'narrow large text', width: 760, fontScale: 1.5 },
])(
  'keeps all Settings categories readable in a $layout viewport',
  async ({ width, fontScale }) => {
    setWindowSize(width, fontScale);
    await render(
      <SettingsRoute
        selectedProvider="Cached provider label"
        selectedAiResolverOptions={settingsRouteResolverOptions()}
        onOpenProviderSettings={jest.fn()}
        onOpenAccounts={jest.fn()}
        onOpenPrivacy={jest.fn()}
        onOpenBackup={jest.fn()}
        onOpenHealthData={jest.fn()}
        onOpenSyncStatus={jest.fn()}
      />,
    );

    expect(
      StyleSheet.flatten(screen.getByTestId('settings-layout').props.style)
        ?.flexDirection,
    ).toBe('column');
    expect(screen.getByText(t('settings.summary'))).toBeTruthy();
    for (const id of [
      'settings-section-ai-accounts',
      'settings-section-health-data',
      'settings-section-privacy-backup',
      'settings-section-daily-reminders',
      'settings-section-app-info',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const id of [
      'settings-open-health-data',
      'settings-open-sync-status',
      'settings-open-provider',
      'settings-open-accounts',
      'settings-open-privacy',
      'settings-open-backup',
    ]) {
      expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
    }
  },
);
