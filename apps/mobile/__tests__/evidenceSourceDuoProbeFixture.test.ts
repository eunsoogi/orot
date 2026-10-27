import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../src/healthEvidence/localEvidenceTestSupport';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import {
  evidenceSourceDuoFixtureRecords,
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
});
