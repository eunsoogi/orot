import { visitGeneratedSourcesAvailable } from '../visitGeneratedSourcePolicy';
import {
  assertGeneratedVisitQuestionSource,
  GeneratedVisitSourceInvalidError,
} from '../../agent/visitQuestions/generatedVisitQuestionValidation';
import type { SqlExecutor } from '@orot/storage';
import type { VisitQuestion } from '@orot/domain';

jest.mock(
  '../../agent/visitQuestions/generatedVisitQuestionValidation',
  () => ({
    assertGeneratedVisitQuestionSource: jest.fn(),
    GeneratedVisitSourceInvalidError: class extends Error {},
  }),
);
const source: NonNullable<VisitQuestion['generatedArtifactSources']> = [
  {
    kind: 'generated_summary',
    type: 'symptom_summary',
    id: 'summary',
    revision: 'revision',
  },
];
const tx = {} as SqlExecutor;
const validate = jest.mocked(assertGeneratedVisitQuestionSource);
test('invalid generated parents are unavailable without exposing their contents', async () => {
  validate.mockRejectedValueOnce(
    new GeneratedVisitSourceInvalidError('changed'),
  );
  await expect(visitGeneratedSourcesAvailable(tx, source)).resolves.toBe(false);
});
test('operational storage failures remain retryable errors, not legacy quarantine decisions', async () => {
  const error = new Error('SQLITE_BUSY');
  validate.mockRejectedValueOnce(error);
  await expect(visitGeneratedSourcesAvailable(tx, source)).rejects.toBe(error);
});
