/** Synthetic exact-source records and abstract spans; never actual user data. */
export const local = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record',
  sourceRevision: 'r1',
  evidenceId: 'local',
  evidenceRevision: 'e1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content: '수면 시간은 7시간으로 기록되었어요.',
};
export const paper = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'r2',
  evidenceId: 'MED:1',
  evidenceRevision: 'e2',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content:
    'Abstract: Adults were studied. Sleep was associated with health.\nOriginal source: https://europepmc.org/article/MED/1',
};
export const localClaim = {
  sourceRevision: 'r1',
  evidenceId: 'local',
  evidenceRevision: 'e1',
  span: local.content,
};
export const paperClaim = {
  sourceRevision: 'r2',
  evidenceId: 'MED:1',
  evidenceRevision: 'e2',
  populationSpan: 'Adults were studied.',
  resultSpan: 'Sleep was associated with health.',
  statisticSpan: '',
  limitationSpan: '',
  measure: 'qualitative',
  value: '',
  confidenceInterval: '',
};
