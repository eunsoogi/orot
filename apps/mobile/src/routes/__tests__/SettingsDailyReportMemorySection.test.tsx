import { dailyReportDeviceAuthorityFixture } from '../../storage/testSupport/dailyReportDeviceAuthorityFixture';
import { runMigrations } from '@orot/storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import { t } from '../../i18n';
import { SettingsDailyReportMemorySection } from '../SettingsDailyReportMemorySection';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(() => null),
}));
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

test('retains a settled toggle through plain background and opens only for an explicit change', async () => {
  dailyReportDeviceAuthorityFixture();
  const before = AppState.currentState;
  AppState.currentState = 'active';
  let appChanged: (state: 'active' | 'background') => void = () => {};
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      appChanged = callback as typeof appChanged;
      return { remove: jest.fn() };
    });
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const repository = createConversationArtifactStorage(connection.database);
  const open = jest.mocked(openSavedGeneratedReportReferences);
  open.mockClear().mockResolvedValue(repository);
  try {
    const view = await render(
      <SettingsDailyReportMemorySection
        ownership={{ isCurrent: () => true, subscribe: () => () => {} }}
      />,
    );
    try {
      const toggle = () =>
        screen.getByTestId('settings-daily-report-memory-toggle');
      expect(toggle().props.value).toBe(false);
      expect(open).toHaveBeenCalledTimes(1);
      for (const phase of ['background', 'active'] as const) {
        await act(async () => {
          AppState.currentState = phase;
          appChanged(phase);
        });
        expect(toggle().props.value).toBe(false);
        expect(open).toHaveBeenCalledTimes(1);
      }
      await fireEvent(toggle(), 'valueChange', true);
      expect(await repository.readAutomaticDailyReportMemory()).toBe(true);
      expect(toggle().props.value).toBe(true);
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
    }
  } finally {
    listener.mockRestore();
    AppState.currentState = before;
    connection.close();
  }
});

test('drops the cached preference on protected-data lock and authoritative local clear', async () => {
  const before = AppState.currentState;
  AppState.currentState = 'active';
  const appState = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  let emit: (event: ConversationExecutionEvent) => void = () => {};
  const close = jest.fn();
  const native = jest.mocked(conversationExecutionNative);
  // This component touches only the protected-data subscription and preference reader.
  native.mockReturnValue({
    bridgeAvailable: true,
    subscribe: (listener: (event: ConversationExecutionEvent) => void) => {
      emit = listener;
      return close;
    },
  } as unknown as NonNullable<ReturnType<typeof conversationExecutionNative>>);
  const open = jest.mocked(openSavedGeneratedReportReferences);
  const readAutomaticDailyReportMemory = jest.fn().mockResolvedValue(true);
  open.mockClear().mockResolvedValue({
    readAutomaticDailyReportMemory,
  } as unknown as Awaited<
    ReturnType<typeof openSavedGeneratedReportReferences>
  >);

  try {
    const view = await render(
      <SettingsDailyReportMemorySection
        ownership={{ isCurrent: () => true, subscribe: () => () => {} }}
      />,
    );
    try {
      const toggle = () =>
        screen.queryByTestId('settings-daily-report-memory-toggle');
      expect(toggle()?.props.value).toBe(true);
      await act(async () => emit({ kind: 'protectedData', available: false }));
      expect(toggle()).toBeNull();
      expect(open).toHaveBeenCalledTimes(1);
      readAutomaticDailyReportMemory.mockResolvedValue(false);
      await act(async () => {
        emit({ kind: 'protectedData', available: true });
        emit({ kind: 'protectedData', available: true });
      });
      expect(toggle()?.props.value).toBe(false);
      expect(open).toHaveBeenCalledTimes(2);
      readAutomaticDailyReportMemory.mockResolvedValue(true);
      await act(async () => notifyLocalDataCleared());
      expect(toggle()?.props.value).toBe(true);
      expect(open).toHaveBeenCalledTimes(3);
    } finally {
      await view.unmount();
    }
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    AppState.currentState = before;
    native.mockReturnValue(null);
    appState.mockRestore();
  }
});
