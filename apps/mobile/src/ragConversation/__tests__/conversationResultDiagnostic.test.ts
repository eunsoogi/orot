import { NativeModules } from 'react-native';
import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { ragConversationTask } from '../task';
import { observeConversationResultValidation } from '../conversationResultDiagnostic';

const input = {
  request: 'Synthetic',
  evidence: {
    items: [{ sourceKind: 'personal_record' }],
    coverage: [],
    conflicts: [],
  },
} as unknown as TaskResponderInput;
afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});

test.each([
  [null, 'task_value_object'],
  [[], 'task_value_object'],
  [
    { answer: 'Synthetic', privateExtra: 'private content' },
    'task_value_fields',
  ],
  [{ answer: 'Synthetic', completion: 'unknown' }, 'task_value_completion'],
  [{ answer: 'Synthetic', answerKind: 'unknown' }, 'task_value_kind'],
  [{ answer: 4 }, 'task_answer_type'],
  [{ answer: ' \n ' }, 'task_answer_empty'],
  [{ answer: 'S'.repeat(4001) }, 'task_answer_length'],
] as const)(
  'rejected shape emits one closed code without changing the decision',
  (value, code) => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    expect(
      ragConversationTask.validateResult(value as JsonValue, input),
    ).toEqual({
      status: 'invalid',
      reason: 'The answer was empty or outside the supported size.',
    });
    expect(report.mock.calls).toEqual([['rag', 'validation', code]]);
  },
);

test('a real clinical rejection is distinct from format and does not publish the answer', () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const result = ragConversationTask.validateResult(
    { answer: '당뇨 가능성은 90%입니다.' },
    input,
  );
  expect(result).toEqual({
    status: 'invalid',
    reason: 'The answer contained a definitive clinical claim.',
  });
  expect(report.mock.calls).toEqual([
    ['rag', 'validation', 'task_clinical_rejected'],
  ]);
});

test('accepted and clarification decisions stay silent, including the original length boundary', () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  expect(
    ragConversationTask.validateResult(
      {
        answer: 'S'.repeat(4000),
        answerKind: 'conversation',
        completion: 'partial',
      },
      input,
    ).status,
  ).toBe('valid');
  const noEvidence = {
    ...input,
    evidence: { items: [], coverage: [], conflicts: [] },
  };
  expect(
    ragConversationTask.validateResult({ answer: 'Synthetic' }, noEvidence)
      .status,
  ).toBe('needs_clarification');
  expect(report).not.toHaveBeenCalled();
});

test('unknown reasons and thrown validators never disclose private text or change error identity', () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const failure = {
    status: 'invalid' as const,
    reason: 'private unknown detail',
  };
  expect(
    observeConversationResultValidation({ private: 'value' }, () => failure),
  ).toBe(failure);
  const error = new Error('private exception');
  expect(() =>
    observeConversationResultValidation(null, () => {
      throw error;
    }),
  ).toThrow(error);
  expect(report.mock.calls).toEqual([
    ['rag', 'validation', 'task_validator_other'],
    ['rag', 'validation', 'task_validator_exception'],
  ]);
});

test('unavailable or failing observation cannot change validation', () => {
  const original = {
    status: 'invalid' as const,
    reason: 'The answer was empty or outside the supported size.',
  };
  expect(observeConversationResultValidation(null, () => original)).toBe(
    original,
  );
  NativeModules.OrotProviderDiagnostics = {
    report: () => {
      throw new Error('sink');
    },
  };
  expect(observeConversationResultValidation(null, () => original)).toBe(
    original,
  );
  const value = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('classifier');
      },
    },
  ) as JsonValue;
  expect(observeConversationResultValidation(value, () => original)).toBe(
    original,
  );
});
