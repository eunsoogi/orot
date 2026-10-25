import {
  definition,
  definitionEntry,
  dose,
  doseEntry,
} from '../testSupport/doseMedicationFixtures';
import { chunkStructuredRecord } from '@orot/rag';
import { buildPersonalEvidence } from '../personalEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { presentEvidenceSource } from '../evidenceSourcePresentation';
import {
  noStaleEvidence,
  referenceOnly,
  repository,
} from '../testSupport/personalEvidenceTestSupport';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceRepository';
import {
  captureSymptomSummarySources,
  restoreSymptomSummary,
} from '../symptomSummarySources';
import { localData } from '../featureServiceFixtures';

test('uses only the explicitly linked medication name while preserving original dose facts', () => {
  const source = {
    sourceKind: 'personal_record',
    records: [doseEntry, definitionEntry],
  } as const;
  expect(presentEvidenceSource(source)[0]?.hero).toMatchObject({
    heading: '합성 예시약',
    value: '1 정',
    atLabel: '복용 발생 시각',
  });
  const unrelated = {
    ...definitionEntry,
    record: {
      ...definition,
      id: 'unrelated-medication',
      displayText: '다른 합성 약',
    },
  };
  expect(
    presentEvidenceSource({ ...source, records: [doseEntry, unrelated] })[0]
      ?.hero?.heading,
  ).toBeUndefined();
});

test('reads the exact linked medication into a dose source and rejects its subsequent change or deletion', async () => {
  let current: readonly LocalHealthEvidenceRecord[] = [
    doseEntry,
    definitionEntry,
  ];
  const live = repository(current);
  jest
    .mocked(live.readRecord)
    .mockImplementation(
      async (kind, id) =>
        current.find(entry => entry.kind === kind && entry.record.id === id)
          ?.record ?? null,
    );
  const chunk = chunkStructuredRecord('dose_event', dose);
  const registry = new LocalEvidenceReferenceRegistry();
  const result = buildPersonalEvidence({
    records: current,
    candidateRecords: [doseEntry],
    persistedChunks: [chunk],
    loadCurrentPersistedChunks: async () => [chunk],
    repository: live,
    registry,
    ...noStaleEvidence,
  });
  const ref = referenceOnly(result.items[0]!);
  const signal = new AbortController().signal;
  await expect(registry.readSource(ref, signal)).resolves.toMatchObject({
    status: 'available',
    document: { records: [doseEntry, definitionEntry] },
  });
  current = [
    doseEntry,
    {
      ...definitionEntry,
      record: { ...definition, displayText: '변경된 합성 이름' },
    },
  ];
  await expect(registry.revalidateEvidence([ref], signal)).resolves.toBe(false);
  await expect(registry.readSource(ref, signal)).resolves.toEqual({
    status: 'changed',
  });
  current = [doseEntry];
  await expect(registry.readSource(ref, signal)).resolves.toEqual({
    status: 'missing',
  });
});

test('a missing linked record never borrows another medication name or invents a dose date', async () => {
  const unrelated = {
    ...definitionEntry,
    record: { ...definition, id: 'unrelated' },
  };
  const records = [doseEntry, unrelated];
  const chunk = chunkStructuredRecord('dose_event', dose);
  const registry = new LocalEvidenceReferenceRegistry();
  const result = buildPersonalEvidence({
    records,
    candidateRecords: [doseEntry],
    persistedChunks: [chunk],
    loadCurrentPersistedChunks: async () => [chunk],
    repository: repository(records),
    registry,
    ...noStaleEvidence,
  });
  const source = await registry.readSource(
    referenceOnly(result.items[0]!),
    new AbortController().signal,
  );
  expect(source.status).toBe('available');
  if (source.status === 'available') {
    expect(
      presentEvidenceSource(source.document)[0]?.hero?.heading,
    ).toBeUndefined();
  }
});

test('saved summary descriptors retain the linked name revision for restoration without regeneration', async () => {
  const records = [doseEntry, definitionEntry];
  const chunk = chunkStructuredRecord('dose_event', dose);
  const registry = new LocalEvidenceReferenceRegistry();
  const result = buildPersonalEvidence({
    records,
    candidateRecords: [doseEntry],
    persistedChunks: [chunk],
    loadCurrentPersistedChunks: async () => [chunk],
    repository: repository(records),
    registry,
    ...noStaleEvidence,
  });
  const captured = await captureSymptomSummarySources(
    {
      presentation: 'symptom_summary',
      hypotheses: [
        {
          title: '합성 복약 기록',
          summary: '합성 기록을 읽었어요.',
          uncertainty: '',
          missingData: [],
          supportingEvidence: [referenceOnly(result.items[0]!)],
          contraryEvidence: [],
        },
      ],
    },
    registry,
    new AbortController().signal,
  );
  expect(captured.sources[0]).toMatchObject({
    records: [
      { kind: 'dose_event', id: dose.id },
      { kind: 'medication_definition', id: definition.id },
    ],
  });
  const saved = {
    id: 'saved-dose-summary',
    createdAt: '2026-10-20T01:00:00Z',
    providerId: 'synthetic',
    modelId: 'synthetic',
    modelName: 'Synthetic',
    ...captured,
  };
  const fresh = new LocalEvidenceReferenceRegistry();
  const data = localData([]).data;
  data.repository.readRecord = repository(records).readRecord;
  const restored = await restoreSymptomSummary(saved, fresh, data);
  const read = await fresh.readSource(
    restored.hypotheses[0]!.supportingEvidence[0]!,
    new AbortController().signal,
  );
  expect(read.status).toBe('available');
  if (read.status === 'available')
    expect(presentEvidenceSource(read.document)[0]?.hero?.heading).toBe(
      '합성 예시약',
    );
  data.repository.readRecord = repository([doseEntry]).readRecord;
  const missing = await restoreSymptomSummary(
    saved,
    new LocalEvidenceReferenceRegistry(),
    data,
  );
  expect(missing.savedSummary).toMatchObject({
    status: 'saved',
    sourceChanged: true,
  });
});
