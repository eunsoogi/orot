import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { providerFailure } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { createCalendarBridge } from '../../calendar/calendarBridge';
import {
  calendarSyncState,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';
import { stringContent } from '../classificationWorkflowTestFixtures';
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

test('retains an earlier completed outbound batch after a rate limit and does not replay it on reclassify or reload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-calendar-rate-limit-'));
  const file = join(directory, 'app.sqlite');
  let lane = openSqliteTestDatabase(file);
  try {
    await runMigrations(lane.database);
    const appointments = () =>
      createAppointmentRepository(
        createRecordRepository(lane.database),
        lane.database,
      );
    const events = Array.from({ length: 9 }, (_, index) => record(index + 1));
    const bridge = createCalendarBridge({
      ...native(events),
      requestEventAccess: async () => 'fullAccess',
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    });
    const generate = provider();
    generate.mockImplementationOnce(provider()).mockResolvedValueOnce(
      providerFailure({
        code: 'rate_limited',
        message: 'Synthetic rate limit',
        retryable: true,
      }),
    );
    const choice = selectedProvider();
    const selection = { ...choice, provider: { ...choice.provider, generate } };
    const renderScreen = async () => {
      const snapshot = await bridge.listUpcomingEvents();
      return renderWithRootSafeArea(
        <MedicalAppointmentClassificationScreen
          bridge={bridge}
          calendarSync={calendarSyncState(snapshot.events)}
          selectedProvider={selection}
          recipient="synthetic"
          repository={appointments()}
        />,
      );
    };
    const start = () =>
      fireEvent.press(screen.getByTestId('medical-appointment-import'));
    const outboundTimes = (index: number): string[] =>
      JSON.parse(
        stringContent(generate.mock.calls[index]![0].messages[1])!,
      ).candidates.map(
        (candidate: { event: { startsAt: string } }) =>
          candidate.event.startsAt,
      );
    const first = await renderScreen();
    await start();
    await waitFor(() =>
      expect(
        screen.getByText(/불러온 일정 9건 중 8건을 분류했습니다/),
      ).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(outboundTimes(0)).toEqual(
      events.slice(0, 8).map(item => item.effectiveAt),
    );
    expect(outboundTimes(1)).toEqual([events[8]!.effectiveAt]);

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
    expect(outboundTimes(2)).toEqual([events[8]!.effectiveAt]);
    expect(generate).toHaveBeenCalledTimes(3);
    await first.unmount();

    lane.close();
    lane = openSqliteTestDatabase(file);
    const relaunched = await renderScreen();
    await start();
    await waitFor(() =>
      expect(
        screen.getByText(/기존 분류 9건 재사용 · 새로 분류 0건/),
      ).toBeTruthy(),
    );
    expect(generate).toHaveBeenCalledTimes(3);
    await relaunched.unmount();

    const removed = events.shift()!;
    const edited = record(2, 200);
    edited.calendarEventSnapshot = {
      ...edited.calendarEventSnapshot,
      title: '편집한 합성 일정',
    };
    events[0] = edited;
    const added = record(10);
    events.push(added);
    const changed = await renderScreen();
    await start();
    await waitFor(() =>
      expect(
        screen.getByText(/기존 분류 7건 재사용 · 새로 분류 2건/),
      ).toBeTruthy(),
    );
    expect(outboundTimes(3)).toEqual([edited.effectiveAt, added.effectiveAt]);
    expect(generate).toHaveBeenCalledTimes(4);
    const cachedRemoved = await appointments().classificationCache!.read(
      [removed.classificationWitness.occurrence],
      new AbortController().signal,
    );
    expect(cachedRemoved.rows).toEqual([]);
    await changed.unmount();
  } finally {
    lane.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
