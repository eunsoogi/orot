import {
  validateEvidenceBatch,
  DEFAULT_MULTI_AGENT_BUDGET,
} from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import type { EvidenceItem, EvidenceSearchTool } from '@orot/agent-runtime';
import type { HealthObservation } from '@orot/domain';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { projectVisitSensorEvidence } from '../providerSensorEvidence';
import {
  visitQuestionCitationKey,
  type VisitQuestionEvidenceMetadata,
} from '../evidence';
import type { VisitQuestionEvidenceCollection } from '../evidenceCollection';

function fixture(record: HealthObservation) {
  const item: EvidenceItem = {
    sourceKind: 'personal_record',
    sourceId: 's1',
    sourceRevision: 'r1',
    evidenceId: 'e1',
    evidenceRevision: 'r1',
    locator: null,
    effectiveTime: null,
    reviewState: 'reviewed',
    content: 'original synthetic content',
  };
  const metadata: VisitQuestionEvidenceMetadata = {
    sourceRecordIds: [record.id],
    sourceRecordRevisions: [],
    sourceDates: [],
    recordKind: 'health_observation',
    evidenceRecordId: record.id,
  };
  const collection: VisitQuestionEvidenceCollection = {
    batch: { items: [item], coverage: [], conflicts: [] },
    metadataByCitation: new Map([[visitQuestionCitationKey(item), metadata]]),
    memoryStatus: 'not_searched',
  };
  return {
    item,
    collection,
    repository: { get: jest.fn(async () => record) } as unknown as Pick<
      RecordRepository,
      'get'
    >,
  };
}

test('bulk visit measurements use the existing period source and never retain sample content', async () => {
  const f = fixture({
    ...healthObservation('sensor', 'heart_rate', '2026-10-01T10:00:00Z'),
    value: { kind: 'quantity', amount: 93, unit: 'count/min' },
  });
  const aggregate = {
    ...f.item,
    evidenceId: 'period',
    sourceId: 'period-source',
    content: 'period statistics only',
  };
  const metadata = {
    sourceRecordIds: [],
    sourceRecordRevisions: [],
    sourceDates: [],
    healthContextSource: { topic: 'measurements' },
  } as unknown as VisitQuestionEvidenceMetadata;
  const search = jest.fn(async () => ({
    items: [aggregate],
    coverage: [],
    conflicts: [],
  }));
  const result = await projectVisitSensorEvidence({
    ...f,
    metadata: new Map([[visitQuestionCitationKey(aggregate), metadata]]),
    periodTool: { search } as unknown as EvidenceSearchTool,
  });
  expect(result.batch.items).toEqual([aggregate]);
  expect(
    result.metadataByCitation.get(visitQuestionCitationKey(aggregate)),
  ).toBe(metadata);
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { topics: ['measurements'], detail: 'summary' },
      executionLimits: 'unbounded',
    }),
  );
});

test('narrative diagnosis remains exact and does not demand an aggregation service', async () => {
  const f = fixture({
    ...healthObservation('note', 'clinical note', '2026-10-01T10:00:00Z'),
    observationKind: 'diagnosis',
    value: { kind: 'text', text: 'Original clinical narrative' },
  });
  expect(await projectVisitSensorEvidence({ ...f, metadata: new Map() })).toBe(
    f.collection,
  );
});

test('an unavailable sensor aggregation fails without a raw fallback', async () => {
  const f = fixture({
    ...healthObservation('sensor', 'heart_rate', '2026-10-01T10:00:00Z'),
    value: { kind: 'quantity', amount: 93, unit: 'count/min' },
  });
  await expect(
    projectVisitSensorEvidence({ ...f, metadata: new Map() }),
  ).rejects.toThrow('aggregation is unavailable');
});

test('an unfamiliar typed measurement still uses period aggregation rather than throwing or returning raw samples', async () => {
  const f = fixture({
    ...healthObservation('glucose', 'blood_glucose', '2026-10-01T10:00:00Z'),
    value: { kind: 'quantity', amount: 111, unit: 'mg/dL' },
  });
  const period = {
    ...f.item,
    evidenceId: 'period',
    content: 'glucose period summary',
  };
  const metadata = {
    sourceRecordIds: [],
    sourceRecordRevisions: [],
    sourceDates: [],
    healthContextSource: { topic: 'measurements' },
  } as unknown as VisitQuestionEvidenceMetadata;
  const search = jest.fn(async () => ({
    items: [period],
    coverage: [],
    conflicts: [],
  }));
  const result = await projectVisitSensorEvidence({
    ...f,
    metadata: new Map([[visitQuestionCitationKey(period), metadata]]),
    periodTool: { search } as unknown as EvidenceSearchTool,
  });
  expect(result.batch.items).toEqual([period]);
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { topics: ['measurements'], detail: 'summary' },
    }),
  );
});

test('mixed source-kind coverage counts the combined batch and passes the production runtime validator', async () => {
  const f = fixture({
    ...healthObservation('sensor', 'heart_rate', '2026-10-01T10:00:00Z'),
    value: { kind: 'quantity', amount: 93, unit: 'count/min' },
  });
  const narrative = {
    ...f.item,
    sourceId: 'narrative',
    evidenceId: 'narrative',
    content: 'Original symptom description',
  };
  const period = {
    ...f.item,
    sourceId: 'period',
    evidenceId: 'period',
    content: 'period statistics only',
  };
  const metadata = {
    sourceRecordIds: [],
    sourceRecordRevisions: [],
    sourceDates: [],
    healthContextSource: { topic: 'measurements' },
  } as unknown as VisitQuestionEvidenceMetadata;
  const coverage = {
    sourceKind: 'personal_record' as const,
    searchedSourceIds: ['s1', 'narrative'],
    gaps: [],
    truncated: false,
    resultLimit: 8,
    returnedCount: 2,
  };
  const emptyMemoryCoverage = {
    sourceKind: 'reviewed_memory' as const,
    searchedSourceIds: [],
    gaps: ['No matching reviewed memory'],
    truncated: false,
    resultLimit: 8,
    returnedCount: 0,
    requestedTimeRange: {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
    },
  };
  const search = jest.fn(async () => ({
    items: [period],
    coverage: [
      {
        ...coverage,
        searchedSourceIds: ['period'],
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  }));
  const result = await projectVisitSensorEvidence({
    ...f,
    collection: {
      ...f.collection,
      batch: {
        ...f.collection.batch,
        items: [f.item, narrative],
        coverage: [coverage, emptyMemoryCoverage],
      },
    },
    metadata: new Map([[visitQuestionCitationKey(period), metadata]]),
    periodTool: { search } as unknown as EvidenceSearchTool,
  });
  expect(result.batch.items).toEqual([narrative, period]);
  expect(result.batch.coverage).toEqual([
    { ...coverage, searchedSourceIds: ['s1', 'narrative', 'period'] },
    emptyMemoryCoverage,
  ]);
  expect(
    validateEvidenceBatch(
      result.batch,
      { sourceKinds: ['personal_record', 'reviewed_memory'] },
      DEFAULT_MULTI_AGENT_BUDGET,
    ),
  ).toBeUndefined();
  expect(result.batch.items.some(item => item.content === f.item.content)).toBe(
    false,
  );
});
