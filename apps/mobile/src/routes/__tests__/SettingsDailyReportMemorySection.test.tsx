import { dailyReportDeviceAuthorityFixture } from '../../storage/testSupport/dailyReportDeviceAuthorityFixture';
import { runMigrations } from '@orot/storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { t } from '../../i18n';
import { SettingsDailyReportMemorySection } from '../SettingsDailyReportMemorySection';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../agent/execution/consentGeneration', () => {
  let sequence = 0;
  return {
    createConsentGeneration: () => (++sequence).toString(16).padStart(64, '0'),
  };
});
jest.mock('../../memory/openSavedGeneratedReportReferences', () => ({
  openSavedGeneratedReportReferences: jest.fn(),
}));

test('separate Memory control defaults off and only changes through an explicit action', async () => {
  dailyReportDeviceAuthorityFixture();
  const before = AppState.currentState;
  AppState.currentState = 'active';
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const repository = createConversationArtifactStorage(connection.database);
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue(repository);
  try {
    const view = await render(
      <SettingsDailyReportMemorySection
        ownership={{ isCurrent: () => true, subscribe: () => () => {} }}
      />,
    );
    try {
      const toggle = await screen.findByTestId(
        'settings-daily-report-memory-toggle',
      );
      expect(toggle.props.value).toBe(false);
      expect(await repository.readAutomaticDailyReportMemory()).toBe(false);
      const info = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      try {
        await fireEvent.press(
          screen.getByTestId('settings-daily-report-memory-info'),
        );
        expect(info.mock.lastCall?.slice(0, 2)).toEqual([
          t('settings.dailyReportMemory.title'),
          expect.stringContaining(t('settings.dailyReportMemory.retention')),
        ]);
        expect(await repository.readAutomaticDailyReportMemory()).toBe(false);
      } finally {
        info.mockRestore();
      }
      await fireEvent(toggle, 'valueChange', true);
      expect(await repository.readAutomaticDailyReportMemory()).toBe(true);
      const enabled = screen.getByTestId('settings-daily-report-memory-toggle');
      expect(enabled.props.value).toBe(true);
      await fireEvent(enabled, 'valueChange', false);
      expect(await repository.readAutomaticDailyReportMemory()).toBe(false);
    } finally {
      await view.unmount();
    }
  } finally {
    AppState.currentState = before;
    connection.close();
  }
});
