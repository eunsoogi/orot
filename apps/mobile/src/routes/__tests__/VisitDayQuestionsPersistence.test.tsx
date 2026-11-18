import { AppState } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { question } from '../../aiFeatures/integration/testSupport/savedVisitQuestionsTestSupport';
import { loadSavedVisitQuestionState } from '../../aiFeatures/integration/savedVisitQuestions';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
import { VisitDayQuestionsRoute } from '../VisitDayQuestionsRoute';

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
