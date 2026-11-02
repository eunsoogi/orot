import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalHealthEvidenceRecord } from '../src/healthEvidence/localEvidenceRepository';
import type { EvidenceSourceReadResult } from '../src/aiFeatures/integration/evidenceRegistry';
import { evidenceVisualPeriod } from './evidenceVisualPeriod';

// Declared synthetic source events only; no patient storage, HealthKit or provider is opened.
const metadata = {
  effectiveAt: '2026-10-20T08:00:00+09:00',
  recordedAt: '2026-10-20T08:01:00+09:00',
  ingestedAt: '2026-10-20T09:00:00+09:00',
  provenance: {
    origin: 'imported' as const,
    sourceRecordIds: [],
    source: { system: 'healthkit' as const },
  },
  reviewState: { status: 'unreviewed' as const },
};

export const evidenceVisualRecords = {
  medication: {
    kind: 'dose_event',
    record: {
      ...metadata,
      id: 'synthetic-dose',
      eventKind: 'observed',
      observationStatus: 'taken',
      medicationDefinitionId: 'synthetic-medication',
      dose: { amount: 1, unit: '정' },
    },
  },
  measurement: {
    kind: 'health_observation',
    record: {
      ...metadata,
      id: 'synthetic-weight',
      observationKind: 'measurement',
      concept: 'weight',
      value: { kind: 'quantity', amount: 70.5, unit: 'kg' },
    },
  },
  activity: {
    kind: 'health_observation',
    record: {
      ...metadata,
      id: 'synthetic-steps',
      observationKind: 'measurement',
      concept: 'step_count',
      value: { kind: 'quantity', amount: 2400, unit: 'count' },
    },
  },
  sleep: {
    kind: 'health_observation',
    record: {
      ...metadata,
      id: 'synthetic-sleep',
      effectiveAt: '2026-10-20T01:00:00+09:00',
      endedAt: '2026-10-20T02:30:00+09:00',
      observationKind: 'measurement',
      concept: 'HKCategoryTypeIdentifierSleepAnalysis',
      value: { kind: 'text', text: '3' },
    },
  },
} satisfies Record<string, LocalHealthEvidenceRecord>;

export const evidenceVisualMedication = {
  kind: 'medication_definition',
  record: {
    id: 'synthetic-medication',
    ingestedAt: metadata.ingestedAt,
    provenance: metadata.provenance,
    reviewState: metadata.reviewState,
    medicationConceptIdentifier: 'synthetic-medication-concept',
    displayText: '합성 예시약',
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  },
} satisfies LocalHealthEvidenceRecord;

export const evidenceVisualReference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-source-alias',
  sourceRevision: 'synthetic-revision',
  evidenceId: 'synthetic-evidence-alias',
  evidenceRevision: 'synthetic-revision',
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: metadata.effectiveAt,
  reviewState: 'unreviewed',
};

export type EvidenceVisualMode =
  | 'medication'
  | 'measurement'
  | 'activity'
  | 'sleep'
  | 'period'
  | 'loading'
  | 'missing'
  | 'changed'
  | 'unavailable';

/** The native probe and receiving tests share this synthetic state selection; it never reads HealthKit. */
export function createEvidenceVisualReader(mode: EvidenceVisualMode) {
  let attempts = 0;
  return async (
    _reference: EvidenceReference,
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> => {
    attempts += 1;
    if (mode === 'loading')
      return new Promise(resolve =>
        signal.addEventListener(
          'abort',
          () => resolve({ status: 'unavailable' }),
          { once: true },
        ),
      );
    if (mode === 'missing' || mode === 'changed') return { status: mode };
    if (mode === 'period')
      return { status: 'available', document: evidenceVisualPeriod };
    if (mode === 'unavailable' && attempts === 1)
      return { status: 'unavailable' };
    return {
      status: 'available',
      document: {
        sourceKind: 'personal_record',
        records: [
          evidenceVisualRecords[mode === 'unavailable' ? 'measurement' : mode],
          ...(mode === 'medication' ? [evidenceVisualMedication] : []),
        ],
      },
    };
  };
}
