import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
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

test('actual bridge forwards exact witness into durable rerun: checks prior results and does not present AI work', async () => {
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
    const renderScreen = () =>
      renderWithRootSafeArea(
        <MedicalAppointmentClassificationScreen
          bridge={bridge}
          calendarSync={calendarSyncState(snapshot.events)}
          selectedProvider={selection}
          recipient="synthetic"
          repository={appointments()}
        />,
      );
    const start = () =>
      fireEvent.press(screen.getByTestId('medical-appointment-import'));
    const first = await renderScreen();
    await start();
    await waitFor(() =>
      expect(screen.getByText(/일정 2건 · 분류 완료/)).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    let release!: (value: typeof snapshot) => void;
    synthetic.listUpcomingEvents.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve as (value: typeof snapshot) => void;
        }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: '다시 분류하기' }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('medical-appointment-import'),
      ).not.toBeDisabled(),
    );
    await start();
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByLabelText('이전에 분류한 일정 확인 중')).toBeTruthy();
    expect(screen.queryByLabelText('일정 분류 중')).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
    release(snapshot);
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
    await relaunched.unmount();
  } finally {
    lane.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
