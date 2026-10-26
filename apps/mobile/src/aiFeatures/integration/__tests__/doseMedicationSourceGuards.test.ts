import { DoseEventSchema, MedicationAssertionSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';
import { buildPersonalEvidence } from '../personalEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { presentEvidenceSource } from '../evidenceSourcePresentation';
import { guardDoseMedicationSource } from '../doseSourceGuard';
import {
  noStaleEvidence,
  referenceOnly,
  repository,
} from '../testSupport/personalEvidenceTestSupport';
import {
  definition,
  definitionEntry,
  dose,
  doseEntry,
} from '../testSupport/doseMedicationFixtures';

test('rejects a medication mutation between source read and final citation validation', async () => {
  const live = repository([doseEntry, definitionEntry]);
  let medicationReads = 0;
  jest.mocked(live.readRecord).mockImplementation(async (kind, id) => {
    if (kind === 'medication_definition' && id === definition.id) {
      medicationReads += 1;
      return medicationReads === 1
        ? definition
        : { ...definition, displayText: '합성 변경 이름' };
    }
    return kind === 'dose_event' && id === dose.id ? dose : null;
  });
  const chunk = chunkStructuredRecord('dose_event', dose);
  const registry = new LocalEvidenceReferenceRegistry();
  const selected = buildPersonalEvidence({
    records: [doseEntry, definitionEntry],
    candidateRecords: [doseEntry],
    persistedChunks: [chunk],
    loadCurrentPersistedChunks: async () => [chunk],
    repository: live,
    registry,
    ...noStaleEvidence,
  });
  await expect(
    registry.readSource(
      referenceOnly(selected.items[0]!),
      new AbortController().signal,
    ),
  ).resolves.toEqual({ status: 'changed' });
});

test('a same-ID assertion cannot substitute for the linked catalog definition', () => {
  const assertion = MedicationAssertionSchema.parse({
    id: definition.id,
    effectiveAt: '2026-10-01T00:00:00Z',
    recordedAt: '2026-10-01T00:00:00Z',
    ingestedAt: '2026-10-01T00:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    assertionKind: 'current_medication_confirmation',
    medicationName: '다른 합성 약',
    confirmedByUserId: 'synthetic-user',
  });
  const assertionEntry = {
    kind: 'medication_assertion',
    record: assertion,
  } as const;
  expect(
    presentEvidenceSource({
      sourceKind: 'personal_record',
      records: [doseEntry, assertionEntry],
    })[0]?.hero?.heading,
  ).toBeUndefined();
  const manualDose = DoseEventSchema.parse({
    id: 'manual-dose',
    effectiveAt: dose.effectiveAt,
    ingestedAt: dose.ingestedAt,
    recordedAt: dose.ingestedAt,
    provenance: assertion.provenance,
    reviewState: assertion.reviewState,
    eventKind: 'taken',
    medicationAssertionId: assertion.id,
    dose: { amount: 1, unit: '정' },
  });
  expect(
    presentEvidenceSource({
      sourceKind: 'personal_record',
      records: [{ kind: 'dose_event', record: manualDose }, assertionEntry],
    })[0]?.hero?.heading,
  ).toBe('다른 합성 약');
});

test('cancellation during the linked read discards its result and does not duplicate an existing source', async () => {
  const controller = new AbortController();
  const live = repository([definitionEntry]);
  const read = jest.fn(
    async () =>
      ({
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [doseEntry, definitionEntry],
        },
      }) as const,
  );
  const guard = guardDoseMedicationSource(
    doseEntry,
    [definitionEntry],
    live,
    read,
    async () => [],
  );
  await expect(guard.readSource(controller.signal)).resolves.toMatchObject({
    document: { records: [doseEntry, definitionEntry] },
  });
  jest.mocked(live.readRecord).mockImplementation(async () => {
    controller.abort();
    return definition;
  });
  await expect(guard.readSource(controller.signal)).resolves.toEqual({
    status: 'unavailable',
  });
});
