import { ragConversationTask } from '../task';

const local = {
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
const paper = {
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
const localClaim = {
  sourceRevision: 'r1',
  evidenceId: 'local',
  evidenceRevision: 'e1',
  span: '수면 시간은 7시간으로 기록되었어요.',
};
const paperClaim = {
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
const input = {
  request: '내 기록과 문헌을 알려줘',
  evidence: { items: [local, paper], coverage: [], conflicts: [] },
};

test('accepts a local-only grounded claim when unrelated literature is present', () => {
  const result = ragConversationTask.validateResult(
    { answerKind: 'grounded', answer: '', localClaims: [localClaim] },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.answer).toContain(localClaim.span);
});

test('assembles source-bound local and publication claims without inventing a comparison', () => {
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      localClaims: [localClaim],
      literature: [paperClaim],
    },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer).toContain(localClaim.span);
    expect(result.value.answer).toContain(paperClaim.resultSpan);
    expect(result.value.answer).toContain('비교');
  }
});

test.each([
  { ...localClaim, sourceRevision: 'stale' },
  { ...localClaim, span: '수면 시간은 8시간으로 기록되었어요.' },
])('rejects a local claim without its exact current evidence', claim => {
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'grounded', answer: '', localClaims: [claim] },
      input,
    ).status,
  ).not.toBe('valid');
});
