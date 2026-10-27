import { healthReviewTask } from '../task';
import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';

const input: TaskResponderInput = {
  request: '최근 기록 검토',
  evidence: {
    items: [
      {
        sourceKind: 'personal_record',
        sourceId: 'source',
        sourceRevision: '1',
        evidenceId: 'pulse',
        evidenceRevision: '1',
        content: '심박수 75 count/min 기록',
        locator: {},
        effectiveTime: '2035-01-02T00:00:00Z',
        reviewState: 'unreviewed',
      },
    ],
    conflicts: [],
    coverage: [],
  },
};
const value = {
  observedChanges: [{ text: '심박 기록이 있어요.', evidenceIds: ['pulse'] }],
  unresolvedItems: ['측정 당시 상황은 알 수 없어요.'],
  questions: ['기록 당시 상황을 확인할까요?'],
};

describe('Health review non-diagnostic result contract', () => {
  it('retains observed changes, unknowns and questions with current evidence', () => {
    expect(healthReviewTask.validateResult(value, input)).toEqual({
      status: 'valid',
      value,
    });
  });
  it.each([
    { ...value, category: 'no_triggered_action', requiredActions: [] },
    { ...value, diagnosis: 'hypertension' },
    { ...value, questions: ['고혈압입니다.'] },
    { ...value, questions: ['You have hypertension?'] },
    { ...value, questions: ['약 복용을 중단하세요?'] },
    { ...value, questions: ['심박수 999 기록을 확인할까요?'] },
    {
      ...value,
      observedChanges: [{ text: '기록 확인', evidenceIds: ['invented'] }],
    },
    { ...value, observedChanges: [] },
  ])(
    'rejects safety overrides, diagnosis, treatment, unsupported values and invented citations',
    candidate => {
      expect(
        healthReviewTask.validateResult(candidate as JsonValue, input).status,
      ).toBe('invalid');
    },
  );
});
