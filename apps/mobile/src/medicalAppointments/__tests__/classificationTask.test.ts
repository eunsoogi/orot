import type { EvidenceBatch, TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import {
  createAppointmentClassificationTask,
  validateAppointmentClassification,
} from '../classificationTask';

function input(): TaskResponderInput {
  const items: EvidenceBatch['items'][number][] = [
    {
      sourceKind: 'personal_record',
      sourceId: 'ios-calendar',
      sourceRevision: 'eventkit-live-snapshot-v1',
      evidenceId: 'calendar-candidate-1',
      evidenceRevision: 'candidate-snapshot-v1',
      locator: {
        kind: 'calendar_occurrence',
        candidateId: 'calendar-candidate-1',
      },
      effectiveTime: '2035-06-02T00:00:00.000Z',
      reviewState: 'unknown',
      content: JSON.stringify({
        candidateId: 'calendar-candidate-1',
        title: '치과 진료',
      }),
    },
    {
      sourceKind: 'personal_record',
      sourceId: 'ios-calendar',
      sourceRevision: 'eventkit-live-snapshot-v1',
      evidenceId: 'calendar-candidate-2',
      evidenceRevision: 'candidate-snapshot-v1',
      locator: {
        kind: 'calendar_occurrence',
        candidateId: 'calendar-candidate-2',
      },
      effectiveTime: '2035-06-03T00:00:00.000Z',
      reviewState: 'unknown',
      content: JSON.stringify({
        candidateId: 'calendar-candidate-2',
        title: '점심 약속',
      }),
    },
  ];
  return {
    request: 'Classify supplied Calendar events.',
    evidence: { items, coverage: [], conflicts: [] },
  };
}

describe('medical appointment responder contract', () => {
  it('returns only the event fields needed for classification, without Calendar identifiers', () => {
    const task = createAppointmentClassificationTask();
    const messages = task.createMessages(input());
    const payload =
      messages[0]?.role === 'user' && typeof messages[0].content === 'string'
        ? messages[0].content
        : undefined;

    expect(typeof payload).toBe('string');
    expect(payload).toContain('치과 진료');
    expect(payload).not.toContain('calendarEventIdentifier');
    expect(payload).not.toContain('sourceId');
    expect(task.resultSchema).toMatchObject({
      properties: {
        classifications: {
          items: {
            properties: {
              classification: { enum: ['medical', 'non_medical', 'uncertain'] },
            },
          },
        },
      },
    });
  });

  it('accepts all three classes only when every candidate has a reason and uncertainty', () => {
    const result = validateAppointmentClassification(
      {
        classifications: [
          {
            candidateId: 'calendar-candidate-1',
            classification: 'medical',
            reason: '진료를 나타내는 제목입니다.',
            uncertainty: 'low',
          },
          {
            candidateId: 'calendar-candidate-2',
            classification: 'uncertain',
            reason: '제목만으로 목적을 확인하기 어렵습니다.',
            uncertainty: 'high',
          },
        ],
      },
      input(),
    );

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(
        result.value.classifications.map(item => item.classification),
      ).toEqual(['medical', 'uncertain']);
    }
  });

  it.each([
    [
      'missing a candidate',
      [
        {
          candidateId: 'calendar-candidate-1',
          classification: 'medical',
          reason: '근거',
          uncertainty: 'low',
        },
      ],
    ],
    [
      'duplicating a candidate',
      [
        {
          candidateId: 'calendar-candidate-1',
          classification: 'medical',
          reason: '근거',
          uncertainty: 'low',
        },
        {
          candidateId: 'calendar-candidate-1',
          classification: 'non_medical',
          reason: '근거',
          uncertainty: 'medium',
        },
      ],
    ],
    [
      'using an unsupported class',
      [
        {
          candidateId: 'calendar-candidate-1',
          classification: 'maybe',
          reason: '근거',
          uncertainty: 'medium',
        },
        {
          candidateId: 'calendar-candidate-2',
          classification: 'non_medical',
          reason: '근거',
          uncertainty: 'low',
        },
      ],
    ],
    [
      'omitting the uncertainty',
      [
        {
          candidateId: 'calendar-candidate-1',
          classification: 'medical',
          reason: '근거',
        },
        {
          candidateId: 'calendar-candidate-2',
          classification: 'non_medical',
          reason: '근거',
          uncertainty: 'low',
        },
      ],
    ],
  ])('rejects a response %s', (_name, classifications) => {
    expect(
      validateAppointmentClassification(
        { classifications } as JsonValue,
        input(),
      ).status,
    ).toBe('invalid');
  });
});
