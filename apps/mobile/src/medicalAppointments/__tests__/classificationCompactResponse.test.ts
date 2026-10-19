import { createAppointmentClassificationTask } from '../classificationTask';
import type { TaskResponderInput } from '@orot/agent-runtime';

const input: TaskResponderInput = {
  request: 'Classify each supplied event.',
  evidence: {
    items: ['one', 'two'].map(evidenceId => ({
      sourceKind: 'personal_record',
      sourceId: 'ios-calendar',
      sourceRevision: '1',
      evidenceId,
      evidenceRevision: '1',
      locator: {},
      effectiveTime: null,
      reviewState: 'unknown',
      content: '{}',
    })),
    coverage: [],
    conflicts: [],
  },
};

test('expands compact decisions into the same user-facing classifications without generated explanations', () => {
  const task = createAppointmentClassificationTask(['one', 'two']);
  expect(
    task.validateResult(
      {
        classifications: [
          { candidateId: 'one', decision: 'medical_low' },
          { candidateId: 'two', decision: 'uncertain_high' },
        ],
      },
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: {
      classifications: [
        {
          candidateId: 'one',
          classification: 'medical',
          uncertainty: 'low',
          reason: '의료 방문·검사 일정',
        },
        {
          candidateId: 'two',
          classification: 'uncertain',
          uncertainty: 'high',
          reason: '제목만으로 판단 어려움',
        },
      ],
    },
  });
});

test.each(['medical', 'medical_unknown', 'non_medical_low_extra'])(
  'rejects unsupported compact decision %s',
  decision => {
    const task = createAppointmentClassificationTask(['one', 'two']);
    expect(
      task.validateResult(
        {
          classifications: [
            { candidateId: 'one', decision },
            { candidateId: 'two', decision: 'uncertain_high' },
          ],
        },
        input,
      ).status,
    ).toBe('invalid');
  },
);

test('still rejects repeated identities even when decisions are individually valid', () => {
  const task = createAppointmentClassificationTask(['one', 'two']);
  expect(
    task.validateResult(
      {
        classifications: [
          { candidateId: 'one', decision: 'medical_low' },
          { candidateId: 'one', decision: 'non_medical_low' },
        ],
      },
      input,
    ).status,
  ).toBe('invalid');
});

test.each([
  ['medical', '의료 방문·검사 일정'],
  ['non_medical', '일반 생활 일정'],
  ['uncertain', '제목만으로 판단 어려움'],
])('preserves all uncertainty levels for %s', (classification, reason) => {
  const task = createAppointmentClassificationTask(['one', 'two']);
  for (const uncertainty of ['low', 'medium', 'high']) {
    const result = task.validateResult(
      {
        classifications: [
          { candidateId: 'one', decision: `${classification}_${uncertainty}` },
          { candidateId: 'two', decision: 'uncertain_high' },
        ],
      },
      input,
    );
    expect(result.status).toBe('valid');
    if (result.status === 'valid')
      expect(result.value.classifications[0]).toEqual({
        candidateId: 'one',
        classification,
        uncertainty,
        reason,
      });
  }
});
