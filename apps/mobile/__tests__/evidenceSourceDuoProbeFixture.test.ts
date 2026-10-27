import { chunkEvidenceSpan } from '@orot/rag';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../src/healthEvidence/localEvidenceTestSupport';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import { createLocalEvidenceSearchTool } from '../src/aiFeatures/integration/evidenceSearchTool';
import { createLocalEvidenceSnapshot } from '../src/aiFeatures/integration/evidenceSnapshot';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import {
  entry,
  inventory,
  noStaleEvidence,
  repository,
} from '../src/aiFeatures/integration/testSupport/personalEvidenceTestSupport';
import {
  evidenceSourceDuoFixtureRecords,
  createEvidenceSourceDuoServiceDependencies,
  seedEvidenceSourceDuoRecords,
  selectAiFeatureProbeDependencies,
} from '../e2e/evidenceSourceDuoProbeFixture';

test('seeds the reserved source and excerpt idempotently in local storage', async () => {
  const opened = createHealthEvidenceTestDatabase();
  try {
    await seedEvidenceSourceDuoRecords(opened.database);
    const records = createRecordRepository(opened.database);
    await expect(
      records.get('source_record', evidenceSourceDuoFixtureRecords.source.id),
    ).resolves.toEqual(evidenceSourceDuoFixtureRecords.source);
    await expect(
      records.get('evidence_span', evidenceSourceDuoFixtureRecords.excerpt.id),
    ).resolves.toEqual(evidenceSourceDuoFixtureRecords.excerpt);

    await seedEvidenceSourceDuoRecords(opened.database);
    await expect(
      records.get('evidence_span', evidenceSourceDuoFixtureRecords.excerpt.id),
    ).resolves.toEqual(evidenceSourceDuoFixtureRecords.excerpt);
  } finally {
    opened.close();
  }
});

test('preserves an unexpected row that already uses a reserved fixture ID', async () => {
  const opened = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    await records.put('source_record', {
      ...evidenceSourceDuoFixtureRecords.source,
      title: 'Existing saved source',
    });

    await expect(seedEvidenceSourceDuoRecords(opened.database)).rejects.toThrow(
      'The reserved evidence source fixture ID is already used.',
    );
    await expect(
      records.get('source_record', evidenceSourceDuoFixtureRecords.source.id),
    ).resolves.toMatchObject({ title: 'Existing saved source' });
  } finally {
    opened.close();
  }
});

test('keeps the new source fixture opt-in and preserves the disease probe', () => {
  const diseaseDependencies = {} as AiFeatureServiceDependencies;
  expect(
    selectAiFeatureProbeDependencies(
      { OROT_DISEASE_HYPOTHESES_VISUAL_STATE: 'synthetic' },
      diseaseDependencies,
    ),
  ).toBe(diseaseDependencies);
  expect(
    selectAiFeatureProbeDependencies({}, diseaseDependencies),
  ).toBeUndefined();

  const sourceDependencies = selectAiFeatureProbeDependencies(
    { OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE: 'synthetic' },
    diseaseDependencies,
  );
  expect(sourceDependencies).toBeDefined();
  expect(sourceDependencies).not.toBe(diseaseDependencies);
  const sourceProviderDependencies = {
    selectedAi: {} as NonNullable<AiFeatureServiceDependencies['selectedAi']>,
  };
  const sourceOnlyDependencies = selectAiFeatureProbeDependencies(
    { OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE: 'synthetic' },
    undefined,
    sourceProviderDependencies,
  );
  expect(sourceOnlyDependencies?.selectedAi).toBe(
    sourceProviderDependencies.selectedAi,
  );
});

test('source runner preserves the real local evidence registry alias', async () => {
  const records = [
    entry('source_record', evidenceSourceDuoFixtureRecords.source),
    entry('evidence_span', evidenceSourceDuoFixtureRecords.excerpt),
  ];
  const persistedChunk = chunkEvidenceSpan(
    evidenceSourceDuoFixtureRecords.excerpt,
  );
  const registry = new LocalEvidenceReferenceRegistry();
  const snapshot = await createLocalEvidenceSnapshot({
    records,
    inventory: inventory(records),
    persistedChunks: [persistedChunk],
    loadCurrentPersistedChunks: async () => [persistedChunk],
    ...noStaleEvidence,
    repository: repository(records),
    memoryRecords: [],
    memoryStorage: { listRecords: async () => [] },
    registry,
  });
  const registeredCitation = snapshot.items[0];
  if (!registeredCitation)
    throw new Error('The fixture source was not registered.');
  expect(registeredCitation.sourceId).not.toBe(
    evidenceSourceDuoFixtureRecords.source.id,
  );
  expect(registeredCitation.evidenceId).not.toBe(
    evidenceSourceDuoFixtureRecords.excerpt.id,
  );
  const tool = createLocalEvidenceSearchTool({
    id: 'local-personal-records',
    sourceKind: 'personal_record',
    snapshot,
    registry,
    rag: {
      search: async (_query, chunks, limit = 8) =>
        chunks.slice(0, limit).map((chunk, index) => ({
          chunk,
          score: 1,
          lexicalRank: index + 1,
          vectorRank: index + 1,
        })),
    },
  });
  const runner =
    createEvidenceSourceDuoServiceDependencies(undefined).diseaseRunner;
  expect(runner).toBeDefined();

  const outcome = await runner!(
    {
      execution: { operationRunId: 'evidence-source-duo-test-run' },
      tools: [tool],
    } as never,
    undefined as never,
    undefined,
    undefined as never,
    undefined,
  );

  expect(outcome.status).toBe('workflow');
  if (outcome.status !== 'workflow' || outcome.result.status !== 'result') {
    throw new Error('The synthetic source runner did not return a citation.');
  }
  const citation = outcome.result.citations[0];
  if (!citation)
    throw new Error('The synthetic source runner returned no citation.');
  expect(citation).toMatchObject({
    sourceKind: 'personal_record',
    sourceId: registeredCitation.sourceId,
    sourceRevision: registeredCitation.sourceRevision,
    evidenceId: registeredCitation.evidenceId,
    evidenceRevision: registeredCitation.evidenceRevision,
    locator: registeredCitation.locator,
  });
  expect(JSON.stringify(citation)).not.toContain(
    evidenceSourceDuoFixtureRecords.source.id,
  );
  expect(JSON.stringify(citation)).not.toContain(
    evidenceSourceDuoFixtureRecords.excerpt.id,
  );

  const source = await registry.readSource(
    citation,
    new AbortController().signal,
  );
  if (
    source.status !== 'available' ||
    source.document.sourceKind !== 'personal_record'
  ) {
    throw new Error('The registry alias did not resolve to its saved source.');
  }
  expect(source.document.records.map(record => record.record.id)).toContain(
    evidenceSourceDuoFixtureRecords.excerpt.id,
  );
});
