import { createVisitQuestionTaskResponder } from '../taskContract';
import type {
  VisitQuestionEvidenceItem,
  VisitQuestionResponderInput,
} from '../taskContract';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';

const source: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'source-r1',
  evidenceId: 'local-private-record-id',
  evidenceRevision: 'evidence-r1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-09-01T09:00:00Z',
  reviewState: 'reviewed',
  content: '건강 관찰 기록: 혈압 측정 120/80 mmHg',
};

const input = {
  request: '다음 진료를 준비하세요.',
  context: {
    effectiveAt: '2026-11-01T09:00:00+09:00',
    timeZoneIdentifier: 'Asia/Seoul',
    title: 'Synthetic outpatient visit',
  },
  evidence: {
    items: [source],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['source-1'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  },
} satisfies VisitQuestionResponderInput;

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: 'suggestions',
    questions: [
      {
        questionText: '이 혈압 기록을 진료에서 어떻게 확인하면 좋을까요?',
        rationale: '최근 측정 기록이 있어 추세를 의료진과 확인할 수 있어요.',
        priority: 'routine',
        evidenceIds: ['evidence-1'],
      },
      {
        questionText: '이 결과를 다시 측정해야 할까요?',
        rationale: '같은 조건에서 확인할 필요가 있는지 물어볼 수 있어요.',
        priority: 'routine',
        evidenceIds: ['evidence-1'],
      },
      {
        questionText: '다음 방문 전 기록할 점이 있을까요?',
        rationale: '진료 사이에 확인할 방법을 의료진에게 물어볼 수 있어요.',
        priority: 'important',
        evidenceIds: ['evidence-1'],
      },
    ],
    ...overrides,
  };
}

describe('visit question task responder', () => {
  const responder = createVisitQuestionTaskResponder();

  it('maps exact evidence IDs to current source-linked citations', () => {
    const validation = responder.validateResult(response(), input);

    expect(validation.status).toBe('valid');
    if (
      validation.status === 'valid' &&
      validation.value.status === 'suggestions'
    ) {
      expect(validation.value.questions).toHaveLength(3);
      expect(validation.value.questions[0]?.citations).toEqual([source]);
    }
  });

  it('uses short evidence aliases instead of sending local record identifiers to the provider', () => {
    const messages = responder.createMessages(input);
    const request = messages.find(message => message.role === 'user');
    const content = request?.role === 'user' ? request.content : '';

    expect(content).toContain('evidence-1');
    expect(content).not.toContain('local-private-record-id');
    expect(content).not.toContain('appointmentId');
    expect(messages).toHaveLength(1);
    expect(responder.systemPrompt).toContain('type=result');
    expect(responder.systemPrompt).toContain('type=request_evidence');
  });

  it('replaces local identifiers and locators in shared-runtime citations, then restores them locally', () => {
    const privateItem: VisitQuestionEvidenceItem = {
      ...source,
      sourceId: 'db-source-99',
      sourceRevision: 'db-source-revision-99',
      evidenceId: 'db-evidence-42',
      evidenceRevision: 'db-evidence-revision-42',
      locator: { kind: 'structured_record', recordId: 'db-record-42' },
    };
    const aliases = createVisitQuestionEvidenceAliases({
      items: [privateItem],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: ['db-source-99'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: ['A stale item refers to db-record-42.'],
    });
    const alias = aliases.batch.items[0]!;

    expect(JSON.stringify(aliases.batch)).not.toContain('db-source-99');
    expect(JSON.stringify(aliases.batch)).not.toContain('db-evidence-42');
    expect(JSON.stringify(aliases.batch)).not.toContain('db-record-42');
    expect(alias.sourceId).toBe('source-1');
    expect(alias.evidenceId).toBe('evidence-1');
    expect(alias.content).toBe(privateItem.content);
    expect(aliases.originalOf(alias)).toEqual(privateItem);
    expect(aliases.aliasOf(privateItem)).toEqual(alias);
  });

  it.each([
    { questions: [] },
    { questions: response().questions.slice(0, 2) },
    {
      questions: [...response().questions, ...response().questions.slice(0, 3)],
    },
    {
      questions: [
        { ...response().questions[0], evidenceIds: ['unknown'] },
        ...response().questions.slice(1),
      ],
    },
    {
      questions: [
        {
          ...response().questions[0],
          evidenceIds: ['evidence-1', 'evidence-1'],
        },
        ...response().questions.slice(1),
      ],
    },
    {
      questions: [
        {
          ...response().questions[0],
          questionText: 'Should I change this medicine?',
        },
        ...response().questions.slice(1),
      ],
    },
  ])('rejects unsupported question output: %p', override => {
    expect(responder.validateResult(response(override), input).status).toBe(
      'invalid',
    );
  });

  it('requests clarification when evidence reports a material conflict', () => {
    const validation = responder.validateResult(response(), {
      ...input,
      evidence: {
        ...input.evidence,
        conflicts: ['Different values share the same date.'],
      },
    });

    expect(validation.status).toBe('needs_clarification');
  });

  it('accepts dates and values present in cited evidence and asks when they conflict', () => {
    const supported = response({
      questions: [
        {
          ...response().questions[0],
          questionText:
            '2026년 9월 1일 혈압 120/80 mmHg 기록을 어떻게 확인하면 좋을까요?',
          rationale: '2026-09-01 측정한 120/80 mmHg 값이 기록되어 있어요.',
        },
        ...response().questions.slice(1),
      ],
    });
    expect(responder.validateResult(supported, input).status).toBe('valid');

    const unsupported = response({
      questions: [
        {
          ...response().questions[0],
          questionText:
            '2026년 9월 2일 혈압 130/80 mmHg 기록을 어떻게 확인하면 좋을까요?',
        },
        ...response().questions.slice(1),
      ],
    });
    const validation = responder.validateResult(unsupported, input);
    expect(validation.status).toBe('needs_clarification');
  });

  it('requests clarification when no current personal or memory evidence is available', () => {
    const validation = responder.validateResult(response(), {
      ...input,
      evidence: {
        items: [],
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: [],
            gaps: ['no_current_evidence'],
            truncated: false,
            resultLimit: 1,
            returnedCount: 0,
          },
        ],
        conflicts: [],
      },
    });

    expect(validation.status).toBe('needs_clarification');
  });
});
