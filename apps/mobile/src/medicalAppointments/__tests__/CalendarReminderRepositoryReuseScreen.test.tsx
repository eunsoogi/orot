import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { createAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { createCalendarBridge } from '../../calendar/calendarBridge';
import {
  calendarSyncState,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';
import MedicalAppointmentClassificationScreen from '../MedicalAppointmentClassificationScreen';
import {
  native,
  provider,
  record,
} from '../testSupport/incrementalCalendarFixtures';

const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

test('the shipping reminder loader reuses unchanged Calendar verdicts across reclassify and database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-calendar-reuse-'));
  const file = join(directory, 'app.sqlite');
  let lane = openSqliteTestDatabase(file);
  try {
    await runMigrations(lane.database);
    const appointments = () =>
      createAppointmentRepository(
        createRecordRepository(lane.database),
        lane.database,
      );
    const events = [record(1), record(2)];
    const synthetic = native(events);
    const bridge = createCalendarBridge({
      ...synthetic,
      requestEventAccess: async () => 'fullAccess',
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    });
    const snapshot = await bridge.listUpcomingEvents();
    expect(snapshot.events[0]?.classificationWitness).toEqual(
      events[0]!.classificationWitness,
    );
    const generate = provider();
    const choice = selectedProvider();
    const selection = { ...choice, provider: { ...choice.provider, generate } };
    const renderScreen = async () => {
      const runtime = createAppointmentReminderRuntime(async () =>
        appointments(),
      );
      const repository = await runtime.load();
      return renderWithRootSafeArea(
        <MedicalAppointmentClassificationScreen
          bridge={bridge}
          calendarSync={calendarSyncState(snapshot.events)}
          selectedProvider={selection}
          recipient="synthetic"
          repository={repository}
        />,
      );
    };
    const start = () =>
      fireEvent.press(screen.getByTestId('medical-appointment-import'));
    const first = await renderScreen();
    await start();
    await waitFor(() =>
      expect(screen.getByText(/일정 2건 · 분류 완료/)).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getByRole('button', { name: '다시 분류하기' }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('medical-appointment-import'),
      ).not.toBeDisabled(),
    );
    await start();
    await waitFor(() =>
      expect(screen.getByTestId('classification-result-notice')).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText(/기존 분류 2건 재사용 · 새로 분류 0건/),
      ).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    await first.unmount();
    lane.close();
    lane = openSqliteTestDatabase(file);
    const relaunched = await renderScreen();
    await start();
    await waitFor(() =>
      expect(
        screen.getByText(/기존 분류 2건 재사용 · 새로 분류 0건/),
      ).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const cached = await appointments().classificationCache!.read(
      events.map(event => event.classificationWitness.occurrence),
      new AbortController().signal,
    );
    expect(
      new Map(cached.rows.map(row => [row.occurrence, row.classification])),
    ).toEqual(
      new Map([
        [events[0]!.classificationWitness.occurrence, 'medical'],
        [events[1]!.classificationWitness.occurrence, 'non_medical'],
      ]),
    );
    await relaunched.unmount();
  } finally {
    lane.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
