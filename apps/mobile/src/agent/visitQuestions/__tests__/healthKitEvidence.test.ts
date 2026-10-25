import { HealthObservationSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';
import type { RecordRepository } from '@orot/storage';
import { mapRagHitToVisitQuestionEvidence } from '../evidence';
import { visitQuestionCitationKey } from '../evidence';
import { saveReviewedVisitQuestions } from '../persistence';
import {
  appointment,
  candidate,
  input,
  repository as makeStore,
} from '../testing/persistenceFixtures';

// Native HealthKit sample IDs are external provenance, not source_record table keys.
const observation = HealthObservationSchema.parse({
  id: 'health-observation-1',
  effectiveAt: '2026-10-18T00:00:00Z',
  ingestedAt: '2026-10-18T00:01:00Z',
  provenance: {
    origin: 'imported',
    sourceRecordIds: ['healthkit-sample-1'],
    source: { system: 'healthkit' },
  },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
const hit = {
  chunk: chunkStructuredRecord('health_observation', observation),
  score: 1,
  lexicalRank: 1,
  vectorRank: 1,
};
const repository: Pick<RecordRepository, 'get'> = {
  get: jest.fn(async (kind, id) =>
    kind === 'health_observation' && id === observation.id ? observation : null,
  ) as RecordRepository['get'],
};

it('maps imported HealthKit samples using the persisted observation as the source snapshot', async () => {
  const result = await mapRagHitToVisitQuestionEvidence(repository, hit);
  expect(result.item.evidenceId).toBe(observation.id);
  expect(result.item.sourceId).toBe('healthkit-sample-1');
  expect(result.metadata.sourceRecordRevisions).toHaveLength(1);
});

it('still rejects a removed imported observation', async () => {
  await expect(
    mapRagHitToVisitQuestionEvidence({ get: async () => null }, hit),
  ).rejects.toThrow(/changed/);
});

it.each(['unchanged', 'deleted', 'changed'])(
  'checks HealthKit evidence at save: %s',
  async state => {
    const store = makeStore({
      appointment: [appointment],
      health_observation: [observation],
    });
    const mapped = await mapRagHitToVisitQuestionEvidence(store.service, hit);
    if (state === 'deleted')
      await store.service.transaction(writer =>
        writer.delete('health_observation', observation.id),
      );
    if (state === 'changed')
      await store.service.transaction(writer =>
        writer.put('health_observation', {
          ...observation,
          value: { kind: 'quantity', amount: 90, unit: 'count/min' },
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

it('detects an imported observation change in its citation revision', async () => {
  const before = await mapRagHitToVisitQuestionEvidence(repository, hit);
  const changed = {
    ...observation,
    value: { kind: 'quantity' as const, amount: 90, unit: 'count/min' },
  };
  const after = await mapRagHitToVisitQuestionEvidence(
    {
      get: (async (kind: string) =>
        kind === 'health_observation'
          ? changed
          : null) as RecordRepository['get'],
    },
    hit,
  );
  expect(after.item.evidenceRevision).not.toBe(before.item.evidenceRevision);
});
