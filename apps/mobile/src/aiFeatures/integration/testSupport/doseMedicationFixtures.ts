import { DoseEventSchema, MedicationDefinitionSchema } from '@orot/domain';

// Synthetic records keep registration and actual dose occurrence on different days.
const provenance = {
  origin: 'imported',
  sourceRecordIds: [],
  source: { system: 'healthkit' },
};
export const definition = MedicationDefinitionSchema.parse({
  id: 'linked-medication',
  ingestedAt: '2026-10-01T00:00:00Z',
  provenance,
  reviewState: { status: 'unreviewed' },
  displayText: '합성 예시약',
  medicationConceptIdentifier: 'synthetic-concept',
  generalForm: 'tablet',
  isArchived: false,
  hasSchedule: true,
});
export const dose = DoseEventSchema.parse({
  id: 'synthetic-dose',
  effectiveAt: '2026-10-20T00:00:00Z',
  ingestedAt: '2026-10-20T01:00:00Z',
  provenance,
  reviewState: { status: 'unreviewed' },
  eventKind: 'observed',
  observationStatus: 'taken',
  medicationDefinitionId: definition.id,
  dose: { amount: 1, unit: '정' },
});
export const doseEntry = { kind: 'dose_event', record: dose } as const;
export const definitionEntry = {
  kind: 'medication_definition',
  record: definition,
} as const;
