import { createTranscriptCorrection } from '@orot/domain';
import { chunkTranscriptSegment } from '@orot/rag';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import {
  entry,
  inventory,
  referenceOnly,
  repository,
  sourceRecord,
  type StaleEvidenceArtifact,
} from '../testSupport/personalEvidenceTestSupport';

const recordedAt = '2026-01-02T08:00:00.000Z';

function transcript(
  id: string,
  revision: number,
  text: string,
  supersedesId?: string,
) {
  return entry('transcript_segment', {
    id,
    transcriptId: 'transcript-current',
    recordingSourceId: 'recording-source',
    segmentOrdinal: 0,
    revision,
    text,
    language: 'en-US',
    recordingDurationMs: 5000,
    audioRange: { startMs: 0, endMs: 2500 },
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    ...(supersedesId ? { supersedesId } : {}),
    provenance: {
      origin: 'derived',
      sourceRecordIds: ['recording-source'],
      source: {
        system: 'fixture',
        sourceIdentifier: 'engine',
        sourceVersion: '1',
      },
    },
    reviewState: { status: 'unreviewed' },
  });
}

function derivedArtifact(kind: 'visit_question' | 'visit_brief', id: string) {
  const common = {
    id,
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'derived', sourceRecordIds: ['transcript-r1'] },
    reviewState: { status: 'unreviewed' },
  };
  return kind === 'visit_question'
    ? entry('visit_question', {
        ...common,
        questionText: 'Did the symptom continue?',
        priority: 'routine',
        evidenceSpanIds: [],
      })
    : entry('visit_brief', {
        ...common,
        encounterId: 'encounter-1',
        summary: 'A prior visit summary.',
        questionIds: [],
        evidenceSpanIds: ['transcript-r1'],
        medicationAssertionIds: [],
      });
}

function fixture(staleArtifacts: readonly StaleEvidenceArtifact[]) {
  const source = sourceRecord('recording-source');
  const original = transcript('transcript-r1', 1, 'Old transcript wording.');
  const corrected = createTranscriptCorrection(
    original.record as never,
    'Corrected transcript wording.',
    '2026-01-02T08:10:00.000Z',
  );
  const current = entry('transcript_segment', corrected);
  const question = derivedArtifact('visit_question', 'question-1');
  const brief = derivedArtifact('visit_brief', 'brief-1');
  const records = [source, original, current, question, brief];
  const currentChunk = chunkTranscriptSegment(corrected);
  const registry = new LocalEvidenceReferenceRegistry();
  let currentStaleArtifacts = [...staleArtifacts];
  const result = buildPersonalEvidence({
    inventory: inventory(records),
    persistedChunks: [currentChunk],
    loadCurrentPersistedChunks: async () => [currentChunk],
    repository: repository(records),
    registry,
    staleArtifacts,
    loadCurrentStaleArtifacts: async () => currentStaleArtifacts,
  });
  return {
    result,
    registry,
    setCurrentStaleArtifacts(value: readonly StaleEvidenceArtifact[]) {
      currentStaleArtifacts = [...value];
    },
  };
}

describe('derived personal evidence freshness', () => {
  it('excludes stale visit questions and briefs even when only the corrected transcript is chunked', () => {
    const { result } = fixture([
      { kind: 'visit_question', id: 'question-1' },
      { kind: 'visit_brief', id: 'brief-1' },
    ]);

    expect(
      result.items.some(item =>
        item.content.includes('Did the symptom continue?'),
      ),
    ).toBe(false);
    expect(
      result.items.some(item =>
        item.content.includes('A prior visit summary.'),
      ),
    ).toBe(false);
    expect(
      result.items.some(item =>
        item.content.includes('Corrected transcript wording.'),
      ),
    ).toBe(true);
  });

  it('invalidates an already-issued derived citation when transcript correction marks it stale', async () => {
    const source = fixture([]);
    const question = source.result.items.find(item =>
      item.content.includes('Did the symptom continue?'),
    );
    if (!question) throw new Error('Expected the current visit question.');
    source.setCurrentStaleArtifacts([
      { kind: 'visit_question', id: 'question-1' },
    ]);

    await expect(
      source.registry.revalidateEvidence(
        [referenceOnly(question)],
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });
});
