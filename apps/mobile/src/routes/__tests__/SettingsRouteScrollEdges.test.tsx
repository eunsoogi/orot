import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import type { NavigationContentFrame } from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import ProviderSelectionScreen from '../../providers/selection/ProviderSelectionScreen';
import { SettingsBackupRoute } from '../SettingsBackupRoute';
import { SettingsPrivacyRoute } from '../SettingsPrivacyRoute';
import { SettingsSyncStatusRoute } from '../SettingsSyncStatusRoute';

const outer = { x: 0, y: 0, width: 466, height: 678 };
const right = {
  side: 'right',
  windowFrame: outer,
  viewportFrame: outer,
  availableContentFrame: { ...outer, width: 382 },
  navigationFrame: null,
  reservedRegions: [],
} satisfies NavigationContentFrame;
const bottom = {
  ...right,
  side: 'bottom',
  availableContentFrame: outer,
} satisfies NavigationContentFrame;
const occlusion = resolveNavigationOcclusion({
  placement: 'right',
  reservedRightWidth: 84,
  systemBottomInset: 34,
  measuredBottomActionOcclusion: 40,
  systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
});
const page = (child: ReactNode, frame: NavigationContentFrame = right) => (
  <NavigationContentFrameContext.Provider value={frame}>
    <NavigationOcclusionContext.Provider value={occlusion}>
      {child}
    </NavigationOcclusionContext.Provider>
  </NavigationContentFrameContext.Provider>
);

function expectRightEdge(id: string, gutter: number) {
  const scroll = screen.getByTestId(id);
  expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBe(-84);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    paddingRight: 84 + gutter,
    paddingBottom: 56,
  });
  expect(scroll.props.scrollIndicatorInsets).toMatchObject({
    right: 0,
    bottom: 40,
  });
  expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
}

afterEach(() => jest.restoreAllMocks());

test('backup and privacy keep OS Settings as a user action inside the existing page', async () => {
  const settings = jest
    .spyOn(Linking, 'openSettings')
    .mockImplementation(async () => {});
  const onPrepare = jest.fn(async () => {});
  const backup = await render(
    page(<SettingsBackupRoute state="checking" onPrepare={onPrepare} />),
  );
  expectRightEdge('settings-backup-scroll', 0);
  expect(settings).not.toHaveBeenCalled();
  await fireEvent.press(
    within(screen.getByTestId('settings-backup-scroll')).getByTestId(
      'backup-open-system-settings',
    ),
  );
  expect(settings).toHaveBeenCalledTimes(1);
  expect(onPrepare).not.toHaveBeenCalled();
  await backup.unmount();

  const privacy = await render(page(<SettingsPrivacyRoute />));
  const scroll = screen.getByTestId('settings-privacy-scroll');
  expectRightEdge('settings-privacy-scroll', 20);
  expect(settings).toHaveBeenCalledTimes(1);
  await privacy.rerender(page(<SettingsPrivacyRoute />, bottom));
  expect(screen.getByTestId('settings-privacy-scroll')).toBe(scroll);
  expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBeUndefined();
  await fireEvent.press(
    within(scroll).getByTestId('privacy-open-system-settings'),
  );
  expect(settings).toHaveBeenCalledTimes(2);
});

test('Sync Status retains its explicit retry and one loaded scroll page at the new edge', async () => {
  const retrySync = jest.fn(async () => ({
    status: 'complete' as const,
    attemptedFeatures: ['sleep'] as const,
  }));
  await render(
    page(
      <SettingsSyncStatusRoute
        loadSelection={async () => ['sleep']}
        loadStatus={async () => null}
        retrySync={retrySync}
        calendarSync={{
          ...emptyCalendarAutoSyncState,
          requestAccess: async () => 'fullAccess',
          refresh: async () => undefined,
        }}
      />,
    ),
  );
  expectRightEdge('settings-sync-status-scroll', 20);
  expect(retrySync).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByTestId('settings-sync-retry'));
  expect(retrySync).toHaveBeenCalledTimes(1);
});

test.each([
  ['settings-provider', 'settings-provider-screen', 'actual-route', true],
  ['settings-accounts', 'settings-accounts-screen', 'actual-route', true],
  ['settings-provider', 'settings-provider-screen', undefined, false],
  ['feature', 'provider-selection-screen', 'feature-overlay', false],
] as const)(
  '%s only borrows the outer rail when it is a measured Settings route (%s, %s)',
  async (presentation, id, navigationRouteKey, ownsEdge) => {
    const load = jest.fn(async () => null);
    const save = jest.fn(async () => {});
    await render(
      page(
        <ProviderSelectionScreen
          navigationRouteKey={navigationRouteKey}
          options={[]}
          presentation={presentation}
          requirements={{ inputTypes: ['text'] }}
          selectionStore={{ load, save, clear: async () => {} }}
        />,
      ),
    );
    const scroll = screen.getByTestId(id);
    const measure = async (width: number) => {
      const lane = screen.queryByTestId('provider-selection-scroll-lane');
      if (lane) {
        await fireEvent(lane, 'layout', {
          nativeEvent: { layout: { x: 0, y: 0, width, height: 640 } },
        });
      }
    };

    expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBeUndefined();
    await measure(240);
    expect(StyleSheet.flatten(scroll.props.style)?.marginRight).toBeUndefined();
    await measure(382);
    if (ownsEdge) expectRightEdge(id, 20);
    else {
      expect(
        StyleSheet.flatten(scroll.props.style)?.marginRight,
      ).toBeUndefined();
      expect(
        scroll.props.automaticallyAdjustsScrollIndicatorInsets,
      ).toBeUndefined();
    }
    expect(screen.getByTestId(id)).toBe(scroll);
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  },
);
