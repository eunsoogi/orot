import { Dimensions, NativeModules, StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { SettingsRoute } from '../SettingsRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

afterEach(() => {
  Dimensions.set(originalDimensions);
});

function setWindowSize(width: number, fontScale: number) {
  // AdaptiveColumns reads both the live viewport width and the native text scale.
  const window = Dimensions.get('window');
  const screenBounds = Dimensions.get('screen');
  Dimensions.set({
    window: { ...window, width, fontScale },
    screen: { ...screenBounds, width, fontScale },
  });
}

test('shows the installed application version supplied by native metadata', async () => {
  const previousMetadata = NativeModules.OrotAppMetadata;
  NativeModules.OrotAppMetadata = { version: '0.1.0' };
  try {
    await render(
      <SettingsRoute
        selectedProvider="Apple Intelligence"
        onOpenProviderSettings={jest.fn()}
        onOpenAccounts={jest.fn()}
        onOpenPrivacy={jest.fn()}
        onOpenBackup={jest.fn()}
        onOpenHealthData={jest.fn()}
        onOpenSyncStatus={jest.fn()}
      />,
    );

    expect(screen.getByTestId('settings-app-info')).toHaveTextContent(
      '오롯 0.1.0',
    );
  } finally {
    NativeModules.OrotAppMetadata = previousMetadata;
  }
});

test('keeps automatic health integrations in their own Settings group', async () => {
  const onOpenHealthData = jest.fn();
  const onOpenSyncStatus = jest.fn();
  const onOpenProviderSettings = jest.fn();
  const onOpenAccounts = jest.fn();
  const onOpenPrivacy = jest.fn();
  const onOpenBackup = jest.fn();
  await render(
    <SettingsRoute
      selectedProvider="Apple Intelligence"
      onOpenProviderSettings={onOpenProviderSettings}
      onOpenAccounts={onOpenAccounts}
      onOpenPrivacy={onOpenPrivacy}
      onOpenBackup={onOpenBackup}
      onOpenHealthData={onOpenHealthData}
      onOpenSyncStatus={onOpenSyncStatus}
    />,
  );

  expect(
    within(screen.getByTestId('settings-section-integrations')).getByText(
      '연동',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('settings-open-health-data')).toHaveTextContent(
    '건강 데이터앱을 열 때 자동으로 동기화해요.',
  );
  expect(screen.getByTestId('settings-open-sync-status')).toHaveTextContent(
    '권한 및 동기화 상태문제가 있으면 상태를 확인하고 다시 시도해요.',
  );
  const actionIDs = [
    'settings-open-health-data',
    'settings-open-sync-status',
    'settings-open-provider',
    'settings-open-accounts',
    'settings-open-privacy',
    'settings-open-backup',
  ];
  for (const id of actionIDs) {
    expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
    await fireEvent.press(screen.getByTestId(id));
  }

  expect(onOpenHealthData).toHaveBeenCalledTimes(1);
  expect(onOpenSyncStatus).toHaveBeenCalledTimes(1);
  expect(onOpenProviderSettings).toHaveBeenCalledTimes(1);
  expect(onOpenAccounts).toHaveBeenCalledTimes(1);
  expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
  expect(onOpenBackup).toHaveBeenCalledTimes(1);
});

test.each([
  { layout: 'compact', width: 390, fontScale: 1, direction: 'column' },
  { layout: 'expanded', width: 1000, fontScale: 1, direction: 'row' },
  {
    layout: 'narrow large text',
    width: 760,
    fontScale: 1.5,
    direction: 'column',
  },
])(
  'keeps every Settings category in a readable $layout layout',
  async ({ width, fontScale, direction }) => {
    setWindowSize(width, fontScale);
    await render(
      <SettingsRoute
        selectedProvider="Apple Intelligence"
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
    ).toBe(direction);
    expect(
      within(screen.getByTestId('settings-section-integrations')).getByText(
        '연동',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('settings-section-other')).getByText(
        '기타 설정',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('settings-section-data-management')).getByText(
        '데이터 관리',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('settings-section-app-info')).getByText(
        '앱 정보',
      ),
    ).toBeTruthy();
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
