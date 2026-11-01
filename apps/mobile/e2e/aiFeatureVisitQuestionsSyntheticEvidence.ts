import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';

/** Keeps the disease visualization independent from saved-source navigation. */
export const syntheticDiseaseCitation: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-ai-feature-e2e-record',
  sourceRevision: 'revision-1',
  evidenceId: 'synthetic-ai-feature-e2e-span',
  evidenceRevision: 'revision-1',
  locator: { kind: 'synthetic-span', id: 'synthetic-ai-feature-e2e-span' },
  effectiveTime: '2035-05-20T09:00:00.000Z',
  reviewState: 'unreviewed',
  content: '합성 기록: 최근 증상 변화를 확인할 수 있어요.',
};
