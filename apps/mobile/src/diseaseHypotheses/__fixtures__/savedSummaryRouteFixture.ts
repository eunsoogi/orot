import type { DiseaseHypothesisAnalysis } from '../types';

export const source = {
  sourceKind: 'personal_record' as const,
  sourceId: 'synthetic-record',
  evidenceId: 'synthetic-evidence',
  sourceRevision: '1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record' as const, recordId: 'synthetic-record' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

export const restored: DiseaseHypothesisAnalysis = {
  presentation: 'symptom_summary',
  savedSummary: {
    status: 'saved',
    id: 'saved-summary',
    createdAt: '2035-01-01T00:00:00Z',
    modelName: 'Synthetic',
  },
  hypotheses: [
    {
      title: 'Synthetic symptom summary',
      summary: 'Synthetic route result.',
      supportingEvidence: [source],
      contraryEvidence: [],
      uncertainty: 'Synthetic evidence only.',
      missingData: [],
    },
  ],
};
