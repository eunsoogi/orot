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

test.each(['omitted witness', 'ambiguous key', 'mixed', 'valid control'])(
  '%s across rerun and reopened database',
  async laneName => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-calendar-witness-'));
    const file = join(directory, 'app.sqlite');
    let lane = openSqliteTestDatabase(file);
    try {
      await runMigrations(lane.database);
      const first = record(1),
        other = record(2);
      const events =
        laneName === 'omitted witness'
          ? [
              { ...first, classificationWitness: undefined },
              { ...other, classificationWitness: undefined },
            ]
          : laneName === 'ambiguous key'
            ? [
                first,
                {
                  ...other,
                  classificationWitness: first.classificationWitness,
                },
              ]
            : laneName === 'mixed'
              ? [first, { ...other, classificationWitness: undefined }]
              : [first, other];
      const synthetic = native(events);
      const bridge = createCalendarBridge({
        ...synthetic,
        requestEventAccess: async () => 'fullAccess',
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      });
      const generate = provider();
      const choice = selectedProvider();
      const selection = {
        ...choice,
        provider: { ...choice.provider, generate },
      };
      const render = async () => {
        const repository = createAppointmentRepository(
          createRecordRepository(lane.database),
          lane.database,
        );
        return renderWithRootSafeArea(
          <MedicalAppointmentClassificationScreen
            bridge={bridge}
            calendarSync={calendarSyncState(
              (await bridge.listUpcomingEvents()).events,
            )}
            selectedProvider={selection}
            recipient="synthetic"
            repository={repository}
          />,
        );
      };
      const start = () =>
        fireEvent.press(screen.getByTestId('medical-appointment-import'));
      const complete = () =>
        waitFor(() =>
          expect(
            screen.getByRole('button', { name: '다시 분류하기' }),
          ).toBeTruthy(),
        );
      const view = await render();
      await start();
      await complete();
      await fireEvent.press(
        screen.getByRole('button', { name: '다시 분류하기' }),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId('medical-appointment-import'),
        ).not.toBeDisabled(),
      );
      await start();
      await complete();
      await view.unmount();
      lane.close();
      lane = openSqliteTestDatabase(file);
      const reopened = await render();
      await start();
      await complete();
      const rows = await lane.database.execute(
        'SELECT count(*) AS count FROM calendar_classification_cache',
      );
      expect(rows.rows[0]?.count).toBe(
        laneName === 'valid control' ? 2 : laneName === 'mixed' ? 1 : 0,
      );
      expect(generate).toHaveBeenCalledTimes(
        laneName === 'valid control' || laneName === 'mixed' ? 1 : 0,
      );
      if (laneName !== 'valid control') {
        const count = laneName === 'mixed' ? 1 : 2;
        expect(
          screen.getByText(
            new RegExp(
              `일정 ${count}건은 같은 일정인지 확인할 수 없어 분류하지 않았어요`,
            ),
          ),
        ).toBeTruthy();
      }
      await reopened.unmount();
    } finally {
      lane.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
