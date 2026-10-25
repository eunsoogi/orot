import { createTranscriptCorrection } from '@orot/domain';
import { chunkTranscriptSegment } from '@orot/rag';
import type { RecordRepository } from '@orot/storage';
import {
  original,
  source,
} from '../../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import {
  mapRagHitToVisitQuestionEvidence,
  visitQuestionCitationKey,
} from '../evidence';
import { saveReviewedVisitQuestions } from '../persistence';
import {
  appointment,
  candidate,
  input,
  repository as makeStore,
} from '../testing/persistenceFixtures';

const correction = createTranscriptCorrection(
  original,
  '수정한 합성 기록',
  '2026-10-06T10:00:00Z',
);
const hit = {
  chunk: chunkTranscriptSegment(correction),
  score: 1,
  lexicalRank: 1,
  vectorRank: 1,
};
function repository(missing?: string): Pick<RecordRepository, 'get'> {
  return {
    get: (async (kind: string, id: string) => {
      if (id === missing) return null;
      if (kind === 'source_record' && id === source.id) return source;
      if (kind === 'transcript_segment')
        return [original, correction].find(row => row.id === id) ?? null;
      return null;
    }) as RecordRepository['get'],
  };
}

it('resolves a correction provenance entry to the previous transcript revision', async () => {
  const result = await mapRagHitToVisitQuestionEvidence(repository(), hit);
  expect(result.item.content).toBe(correction.text);
  expect(
    result.metadata.sourceRecordRevisions.map(row => row.sourceId),
  ).toEqual([source.id, original.id]);
});
it.each([source.id, original.id])(
  'rejects a missing linked source or prior revision: %s',
  async id => {
    await expect(
      mapRagHitToVisitQuestionEvidence(repository(id), hit),
    ).rejects.toThrow(/changed/);
  },
);

it.each(['unchanged', 'source_deleted', 'prior_deleted', 'prior_changed'])(
  'checks corrected transcript evidence at save: %s',
  async state => {
    const store = makeStore({
      appointment: [appointment],
      source_record: [source],
      transcript_segment: [original, correction],
    });
    const mapped = await mapRagHitToVisitQuestionEvidence(store.service, hit);
    if (state === 'source_deleted')
      await store.service.transaction(writer =>
        writer.delete('source_record', source.id),
      );
    if (state === 'prior_deleted')
      await store.service.transaction(writer =>
        writer.delete('transcript_segment', original.id),
      );
    if (state === 'prior_changed')
      await store.service.transaction(writer =>
        writer.put('transcript_segment', {
          ...original,
          text: '다른 합성 원문',
        }),
      );
    const saving = saveReviewedVisitQuestions({
      ...input(store),
      questions: [{ ...candidate, citations: [mapped.item] }],
      evidence: {
        batch: { items: [mapped.item], coverage: [], conflicts: [] },
        metadataByCitation: new Map([
          [visitQuestionCitationKey(mapped.item), mapped.metadata],
        ]),
        memoryStatus: 'not_searched',
      },
    });
    if (state === 'unchanged') {
      await saving;
      expect(store.list('visit_question')).toHaveLength(1);
    } else {
      await expect(saving).rejects.toThrow(/changed/);
      expect(store.list('visit_question')).toHaveLength(0);
    }
  },
);
