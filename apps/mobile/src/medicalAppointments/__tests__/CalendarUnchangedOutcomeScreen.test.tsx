import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { withAppointmentReminders } from '../../appointmentReminders/reminderRepository';
import { createCalendarBridge } from '../../calendar/calendarBridge';
import MedicalAppointmentClassificationScreen from '../MedicalAppointmentClassificationScreen';
import {
  calendarSyncState,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';
import {
  native,
  provider,
  record,
} from '../testSupport/incrementalCalendarFixtures';

test('an unchanged scheduled import and a manually cancelled occurrence get distinct result receipts without another model call or write', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(sqlite.database);
    const storage = createAppointmentRepository(
      createRecordRepository(sqlite.database),
      sqlite.database,
    );
    const reconcile = jest.fn(async () => undefined);
    const appointments = withAppointmentReminders(storage, { reconcile });
    const events = [record(1), record(2)];
    const bridge = createCalendarBridge({
      ...native(events),
      requestEventAccess: async () => 'fullAccess',
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    });
    const generate = provider();
    generate.mockImplementationOnce(async request => {
      const outcome = await provider()(request);
      return outcome.ok
        ? {
            ...outcome,
            value: {
              ...outcome.value,
              text: outcome.value.text.replaceAll(
                /(?:non_)?medical_medium/g,
                'medical_low',
              ),
            },
          }
        : outcome;
    });
    const choice = selectedProvider();
    const renderScreen = () =>
      renderWithRootSafeArea(
        <MedicalAppointmentClassificationScreen
          bridge={bridge}
          calendarSync={calendarSyncState(events)}
          selectedProvider={{
            ...choice,
            provider: { ...choice.provider, generate },
          }}
          recipient="synthetic"
          repository={appointments}
        />,
      );
    const start = () =>
      fireEvent.press(screen.getByTestId('medical-appointment-import'));
    const first = await renderScreen();
    await start();
    await waitFor(() =>
      expect(screen.getByText('진료 일정 2건을 가져왔어요.')).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const firstSaved = await appointments.list();
    expect(firstSaved).toHaveLength(2);
    await first.unmount();

    await storage.cancel(firstSaved[0]!.id);
    const before = await appointments.list();
    expect(before.map(item => item.status).sort()).toEqual([
      'cancelled',
      'scheduled',
    ]);

    reconcile.mockClear();
    const second = await renderScreen();
    await start();
    await waitFor(() =>
      expect(
        screen.getByTestId('classification-result-notice').props
          .accessibilityLabel,
      ).toContain('이미 저장된 일정 1건은 변경하지 않았어요.'),
    );
    const notice = screen.getByTestId('classification-result-notice').props
      .accessibilityLabel as string;
    expect(notice).toContain('기존 상태를 유지한 일정 1건이 있어요.');
    expect(notice).not.toContain('취소하거나 완료한 일정 2건');
    expect(notice).toContain('기존 분류 2건 재사용 · 새로 분류 0건');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(await appointments.list()).toEqual(before);
    await second.unmount();
  } finally {
    sqlite.close();
  }
});
