/** Failure projection tests keep storage details out of saved-question results. */
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';
import {
  evidenceSpan,
  question,
  repositories,
  sourceRecord,
  staleTranscriptArtifacts,
} from '../testSupport/savedVisitQuestionsTestSupport';

test('returns a stale evidence code after transcript invalidation', async () => {
  const stale = staleTranscriptArtifacts().filter(
    artifact => artifact.kind === 'visit_question',
  );
  const { records, sourceReader } = repositories({
    questions: [
      question('question-1', 'appointment-1', 1, ['span-1'], 'transcript-1:r1'),
    ],
    spans: [evidenceSpan('span-1', 'source-1', 'transcript-1:r1')],
    sources: [sourceRecord('source-1')],
    transcriptId: 'transcript-1',
    staleArtifacts: stale,
  });

  const result = await loadSavedVisitQuestionState({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry: new LocalEvidenceReferenceRegistry(),
  });

  expect(result).toMatchObject({
    status: 'error',
    failureReason: 'stale_artifact',
  });
});

test('returns a storage read code without including the thrown detail', async () => {
  const { records, sourceReader } = repositories({
    questions: [],
    spans: [],
    sources: [],
  });
  jest
    .spyOn(records, 'list')
    .mockRejectedValue(new Error('Synthetic private record detail'));

  const result = await loadSavedVisitQuestionState({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry: new LocalEvidenceReferenceRegistry(),
  });

  expect(result).toMatchObject({
    status: 'error',
    appointmentId: 'appointment-1',
    failureReason: 'storage_read_failed',
  });
  expect(JSON.stringify(result)).not.toContain(
    'Synthetic private record detail',
  );
});
