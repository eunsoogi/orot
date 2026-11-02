import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { classifyCalendarEvents } from '../classificationWorkflow';
import {
  isConfidentMedical,
  saveCalendarCandidate,
} from '../saveCalendarCandidate';
import {
  event,
  input,
  makeProvider,
  workflowResponse,
} from '../classificationWorkflowTestFixtures';

test('classification saves the selected occurrence once across repeat imports', async () => {
  // SQLite and the shipping repository exercise writes; Calendar and model responses remain synthetic.
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    let sequence = 0;
    const repository = createAppointmentRepository(
      createRecordRepository(opened.database),
      opened.database,
      {
        createId: () => `appointment-${++sequence}`,
      },
    );
    const events = [event(0), event(1), event(2)];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      const response = workflowResponse(request);
      if (!response.ok) throw new Error('Expected synthetic model response');
      const output = JSON.parse(response.value.text);
      output.value.classifications[0].decision = 'medical_low';
      return providerSuccess({
        ...response.value,
        text: JSON.stringify(output),
      });
    });
    const options = input(events, { provider: makeProvider(generate) });
    for (let importNumber = 0; importNumber < 2; importNumber += 1) {
      const classification = await classifyCalendarEvents(options);
      expect(classification.status).toBe('complete');
      const selected = classification.candidates.filter(isConfidentMedical);
      expect(selected.map(candidate => candidate.candidateId)).toEqual([
        'calendar-candidate-1',
      ]);
      await expect(
        saveCalendarCandidate(selected[0]!, repository, options.bridge),
      ).resolves.toBe('saved');
      expect(await repository.list()).toEqual([
        expect.objectContaining({
          id: 'appointment-1',
          calendarEventIdentifier: events[0]!.calendarEventIdentifier,
          calendarEventSnapshot: events[0]!.calendarEventSnapshot,
        }),
      ]);
    }
    expect(generate).toHaveBeenCalledTimes(2);
  } finally {
    opened.close();
  }
});
