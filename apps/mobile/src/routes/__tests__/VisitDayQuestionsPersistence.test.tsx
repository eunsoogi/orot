import { AppState } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { question } from '../../aiFeatures/integration/testSupport/savedVisitQuestionsTestSupport';
import { loadSavedVisitQuestionState } from '../../aiFeatures/integration/savedVisitQuestions';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
import { formatDateTime } from '../../i18n';
import { VisitDayQuestionsRoute } from '../VisitDayQuestionsRoute';
import { GeneratedReportBrowser } from '../../generatedReports/GeneratedReportBrowser';
import { createGeneratedReportReader } from '../../generatedReports/readers';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

/** A saved legacy question remains in SQLite unchanged after repeated read-only viewing. */
test('opens existing questions only for the selected visit without mutating persisted rows', async () => {
  AppState.currentState = 'active';
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  try {
    await records.put('visit_question', question('selected', 'visit', 1, []));
    await records.put(
      'visit_question',
      question('other', 'other-visit', 1, []),
    );
    const before = await f.database.execute(
      'SELECT * FROM visit_questions ORDER BY id',
    );
    const runtime = {
      overviewPreparationTargets: new Map([['route', 'visit']]),
      list: async () => [
        {
          id: 'visit',
          status: 'scheduled',
          effectiveAt: '2035-06-02T00:00:00Z',
        },
      ],
    };
    const load = (appointmentId: string) =>
      loadSavedVisitQuestionState({
        appointmentId,
        records,
        sourceReader: createLocalHealthEvidenceRepository(f.database),
        registry: new LocalEvidenceReferenceRegistry(),
      });
    for (let i = 0; i < 2; i += 1) {
      const view = await render(
        <AppointmentReminderProvider runtime={runtime as never}>
          <VisitDayQuestionsRoute routeKey="route" loadSavedQuestions={load} />
        </AppointmentReminderProvider>,
      );
      expect(await screen.findByText('질문 selected')).toBeTruthy();
      expect(screen.queryByText('질문 other')).toBeNull();
      await view.unmount();
    }
    expect(
      (await f.database.execute('SELECT * FROM visit_questions ORDER BY id'))
        .rows,
    ).toEqual(before.rows);
  } finally {
    f.close();
  }
});

test('a real cold read distinguishes an earlier visit from a rescheduled same-ID visit without relabeling questions', async () => {
  AppState.currentState = 'active';
  const directory = mkdtempSync(join(tmpdir(), 'orot-visit-generation-date-'));
  const path = join(directory, 'records.sqlite');
  let f = openSqliteTestDatabase(path);
  let records = createRecordRepository(f.database);
  const original = '2035-12-18T02:00:00.000Z';
  const current = '2035-11-18T02:00:00.000Z';
  const earlier = {
    id: 'earlier-visit',
    status: 'scheduled',
    effectiveAt: '2035-10-18T02:00:00.000Z',
  };
  const rescheduled = {
    id: 'december-visit',
    status: 'rescheduled',
    effectiveAt: current,
  };
  try {
    await runMigrations(f.database);
    await records.put('visit_question', {
      ...question('december', rescheduled.id, 1, []),
      effectiveAt: original,
      provenance: { origin: 'derived', sourceRecordIds: [rescheduled.id] },
      reviewState: {
        status: 'reviewed',
        reviewerId: 'local-user',
        reviewedAt: current,
      },
    });
    await records.put('visit_question', {
      ...question('november', rescheduled.id, 2, []),
      effectiveAt: current,
      provenance: { origin: 'derived', sourceRecordIds: [rescheduled.id] },
      reviewState: {
        status: 'reviewed',
        reviewerId: 'local-user',
        reviewedAt: current,
      },
    });
    await records.put('visit_question', {
      ...question('unmapped', 'unavailable', 2, []),
      appointmentId: undefined,
    });
    f.close();
    f = openSqliteTestDatabase(path);
    records = createRecordRepository(f.database);
    const runtime = {
      overviewPreparationTargets: new Map([
        ['earlier', earlier.id],
        ['rescheduled', rescheduled.id],
      ]),
      list: async () => [earlier, rescheduled],
    };
    const load = (appointmentId: string) =>
      loadSavedVisitQuestionState({
        appointmentId,
        records,
        sourceReader: createLocalHealthEvidenceRepository(f.database),
        registry: new LocalEvidenceReferenceRegistry(),
      });
    const view = (routeKey: string) => (
      <AppointmentReminderProvider runtime={runtime as never}>
        <VisitDayQuestionsRoute routeKey={routeKey} loadSavedQuestions={load} />
      </AppointmentReminderProvider>
    );
    const rendered = await render(view('earlier'));
    expect(
      await screen.findByText(/이 진료에 저장한 질문이 아직 없어요/),
    ).toBeTruthy();
    expect(screen.queryByText('질문 december')).toBeNull();
    await rendered.unmount();

    // The real Records destination opens the same saved bundle by its persisted
    // appointment ID, independently of which appointment Overview selected.
    const reader = createGeneratedReportReader(f.database, {
      data: async () => ({
        ...localData([]).data,
        repository: createLocalHealthEvidenceRepository(f.database),
      }),
      records: async () => records,
    });
    const archive = await render(
      <GeneratedReportBrowser destination open={async () => reader} />,
    );
    const originalBundle = await screen.findByTestId(
      'generated-report-visit:december-visit',
    );
    expect(
      screen.queryByTestId('generated-report-visit:earlier-visit'),
    ).toBeNull();
    expect(screen.queryByText('질문 december')).toBeNull();
    await fireEvent.press(originalBundle);
    expect(await screen.findByText('질문 december')).toBeTruthy();
    expect(screen.getByText('근거를 확인할 질문 december')).toBeTruthy();
    expect(screen.queryByText('질문 unmapped')).toBeNull();
    await archive.unmount();

    const resumed = await render(view('rescheduled'));
    const historical = await screen.findByTestId(
      'visit-day-historical-questions',
    );
    expect(
      within(historical).getByText(formatDateTime(new Date(original))),
    ).toBeTruthy();
    expect(within(historical).getByText('질문 december')).toBeTruthy();
    expect(
      within(historical).getByText('근거를 확인할 질문 december'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('visit-day-appointment')).getByText(
        formatDateTime(new Date(current)),
      ),
    ).toBeTruthy();
    const currentGroup = within(
      screen.getByTestId('visit-day-current-questions'),
    );
    expect(currentGroup.getByText('질문 november')).toBeTruthy();
    expect(currentGroup.queryByText('질문 december')).toBeNull();
    expect(screen.getByTestId('visit-day-provenance')).toBeTruthy();
    expect(screen.queryByText('질문 unmapped')).toBeNull();
    expect(await records.get('visit_question', 'december')).toMatchObject({
      appointmentId: rescheduled.id,
      effectiveAt: original,
    });
    await resumed.unmount();
  } finally {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
