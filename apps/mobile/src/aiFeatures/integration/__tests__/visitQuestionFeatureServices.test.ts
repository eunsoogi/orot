import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createVisitQuestionFeatureServices } from '../visitQuestionFeatureServices';

test('converts local database setup failure to a safe typed read failure', async () => {
  const services = createVisitQuestionFeatureServices({
    loadLocalData: async () => {
      throw new Error('Synthetic private database detail');
    },
    privateLocalData: async () => {
      throw new Error('Not used during a saved-question read');
    },
    registry: new LocalEvidenceReferenceRegistry(),
  });

  const result = await services.loadSavedVisitQuestions('appointment-1');

  expect(result).toMatchObject({
    status: 'error',
    appointmentId: 'appointment-1',
    questions: [],
    failureReason: 'storage_read_failed',
  });
  expect(JSON.stringify(result)).not.toContain(
    'Synthetic private database detail',
  );
});
