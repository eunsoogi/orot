import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  loadSavedVisitQuestionState,
  restoreSavedVisitQuestions,
} from '../savedVisitQuestions';
import { referenceOnly } from '../testSupport/personalEvidenceTestSupport';
import {
  evidenceSpan,
  question,
  repositories,
  sourceRecord,
  staleTranscriptArtifacts,
} from '../testSupport/savedVisitQuestionsTestSupport';

test('restores only the active appointment in saved order and registers readable source links', async () => {
  const span = evidenceSpan('span-1', 'source-1');
  const source = sourceRecord('source-1');
  const { records, sourceReader } = repositories({
    questions: [
      question('question-2', 'appointment-1', 2, ['span-1']),
      question('question-other', 'appointment-2', 1, ['span-other']),
      question('question-1', 'appointment-1', 1, ['span-1']),
    ],
    spans: [span],
    sources: [source],
  });
  const registry = new LocalEvidenceReferenceRegistry();

  const restored = await restoreSavedVisitQuestions({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry,
  });

  expect(restored.questions.map(item => item.questionText)).toEqual([
    '질문 question-1',
    '질문 question-2',
  ]);
  expect(restored.questions[0]?.citations).toHaveLength(1);
  expect(restored.caveats).toEqual([]);
  expect(restored.restorationNotice).toContain('원본 버전');
  const citation = restored.questions[0]?.citations[0];
  expect(citation).toBeDefined();
  if (!citation) throw new Error('The saved citation was not restored.');
  expect(citation.sourceId).not.toBe('source-1');
  expect(registry.resolve(citation)).toMatchObject({
    sourceId: 'source-1',
    evidenceId: 'span-1',
    locator: span.locator,
  });
  await expect(
    registry.readSource(citation, new AbortController().signal),
  ).resolves.toMatchObject({ status: 'available' });
  await expect(
    registry.revalidateEvidence(
      [referenceOnly(citation)],
      new AbortController().signal,
    ),
  ).resolves.toBe(true);
  expect(sourceReader.querySource).toHaveBeenCalledWith(
    'source-1',
    expect.objectContaining({ signal: expect.anything() }),
  );
});

test('rejects a saved question when its cited source span is missing', async () => {
  const { records, sourceReader } = repositories({
    questions: [question('question-1', 'appointment-1', 1, ['missing-span'])],
    spans: [],
    sources: [],
  });

  await expect(
    restoreSavedVisitQuestions({
      appointmentId: 'appointment-1',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).rejects.toMatchObject({ reason: 'missing_citation_source' });
});

test('rejects a transcript-derived question already invalidated before restore', async () => {
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

  await expect(
    restoreSavedVisitQuestions({
      appointmentId: 'appointment-1',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).rejects.toMatchObject({ reason: 'stale_artifact' });
});

test('rejects a saved question when its cited transcript span is stale', async () => {
  const stale = staleTranscriptArtifacts().filter(
    artifact => artifact.kind === 'evidence_span',
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

  await expect(
    restoreSavedVisitQuestions({
      appointmentId: 'appointment-1',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).rejects.toMatchObject({ reason: 'stale_artifact' });
});

test('restores a transcript-derived question while its citation is current', async () => {
  const { records, sourceReader } = repositories({
    questions: [
      question('question-1', 'appointment-1', 1, ['span-1'], 'transcript-1:r1'),
    ],
    spans: [evidenceSpan('span-1', 'source-1', 'transcript-1:r1')],
    sources: [sourceRecord('source-1')],
    transcriptId: 'transcript-1',
  });
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreSavedVisitQuestions({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry,
  });
  const citation = restored.questions[0]?.citations[0];
  if (!citation) throw new Error('The saved citation was not restored.');

  await expect(
    registry.revalidateEvidence(
      [referenceOnly(citation)],
      new AbortController().signal,
    ),
  ).resolves.toBe(true);
  await expect(
    registry.readSource(citation, new AbortController().signal),
  ).resolves.toMatchObject({ status: 'available' });
});

test('invalidates restored citations after a transcript correction', async () => {
  const { records, sourceReader, setCurrentStaleArtifacts } = repositories({
    questions: [
      question('question-1', 'appointment-1', 1, ['span-1'], 'transcript-1:r1'),
    ],
    spans: [evidenceSpan('span-1', 'source-1', 'transcript-1:r1')],
    sources: [sourceRecord('source-1')],
    transcriptId: 'transcript-1',
  });
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreSavedVisitQuestions({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry,
  });
  const citation = restored.questions[0]?.citations[0];
  if (!citation) throw new Error('The saved citation was not restored.');

  setCurrentStaleArtifacts(staleTranscriptArtifacts());

  await expect(
    registry.revalidateEvidence(
      [referenceOnly(citation)],
      new AbortController().signal,
    ),
  ).resolves.toBe(false);
  await expect(
    registry.readSource(citation, new AbortController().signal),
  ).resolves.toMatchObject({ status: 'changed' });
  expect(sourceReader.querySource).not.toHaveBeenCalled();
});

test('shows an appointment-scoped error when a corrected transcript invalidates its question', async () => {
  const { records, sourceReader } = repositories({
    questions: [
      question('question-1', 'appointment-1', 1, ['span-1'], 'transcript-1:r1'),
    ],
    spans: [evidenceSpan('span-1', 'source-1', 'transcript-1:r1')],
    sources: [sourceRecord('source-1')],
    transcriptId: 'transcript-1',
    staleArtifacts: staleTranscriptArtifacts().filter(
      artifact => artifact.kind === 'visit_question',
    ),
  });

  await expect(
    loadSavedVisitQuestionState({
      appointmentId: 'appointment-1',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).resolves.toMatchObject({
    status: 'error',
    appointmentId: 'appointment-1',
    questions: [],
    message: expect.stringContaining('녹취 내용이 수정되어'),
  });
});

test('keeps a saved-list error scoped to the appointment whose lookup failed', async () => {
  const { records, sourceReader } = repositories({
    questions: [question('question-1', 'appointment-1', 1, ['missing-span'])],
    spans: [],
    sources: [],
  });

  await expect(
    loadSavedVisitQuestionState({
      appointmentId: 'appointment-1',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).resolves.toMatchObject({
    status: 'error',
    appointmentId: 'appointment-1',
    questions: [],
    message: expect.stringContaining('원문 근거'),
  });
});
