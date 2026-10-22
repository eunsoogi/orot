import { runVisitQuestionWorkflow } from '../workflow';
import { visitHealthFixture } from '../testing/healthContextFixture';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { hasUnsupportedDateOrValue } from '../questionFacts';
import { t } from '../../../i18n';

const supported =
  '기간 평균 심박수 72회/분을 바탕으로 다음 진료 전 어떤 변화를 기록하면 좋을까요?';
const unsupported =
  '기간 평균 심박수 77회/분을 바탕으로 다음 진료 전 어떤 변화를 기록하면 좋을까요?';

function output(
  first: string,
  secondId = 'evidence-1',
  lastReason = '측정한 시각과 함께 기록할 내용을 정할 수 있어요.',
) {
  return JSON.stringify({
    type: 'result',
    citations: ['evidence-1'],
    value: {
      status: 'suggestions',
      questions: [
        {
          questionText: first,
          rationale: '기간 심박수 기록을 의료진과 함께 검토할 수 있어요.',
          priority: 'routine',
          evidenceIds: ['evidence-1'],
        },
        {
          questionText:
            '심박수 측정 조건 중 진료에서 함께 확인할 점은 무엇인가요?',
          rationale:
            '측정 조건에 따른 해석의 차이를 의료진과 확인할 수 있어요.',
          priority: 'routine',
          evidenceIds: [secondId],
        },
        {
          questionText:
            '심박수 기록과 함께 어떤 증상 변화를 기록하면 좋을까요?',
          rationale: lastReason,
          priority: 'routine',
          evidenceIds: ['evidence-1'],
        },
      ],
    },
  });
}

async function fixture() {
  const f = await visitHealthFixture();
  expect(hasUnsupportedDateOrValue(supported, [f.item])).toBe(false);
  return {
    ...f,
    context: {
      ...f.prepared,
      evidence: {
        ...f.prepared.evidence,
        batch: {
          ...f.prepared.evidence.batch,
          items: [f.item],
          coverage: [
            {
              sourceKind: 'personal_record' as const,
              searchedSourceIds: [f.item.sourceId],
              gaps: [],
              truncated: false,
              resultLimit: 1,
              returnedCount: 1,
            },
          ],
        },
      },
    },
  };
}

test('corrects one unsupported computed value with the same sources and validates the new answer before publication', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider);
    const confirmConsent = jest.fn(async () => true);
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready')
      expect(result.questions[0]?.questionText).toBe(supported);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain(
      'Do not round',
    );
    expect(confirmConsent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('77회/분');
    expect(await f.records.list('visit_question')).toEqual([]);
  } finally {
    f.close();
  }
});

test('stops after one rejected numeric correction without accepting or storing the invented value', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('77회/분');
    expect(await f.records.list('visit_question')).toEqual([]);
  } finally {
    f.close();
  }
});

test.each([
  ['unknown-evidence', '기록된 측정 조건을 의료진과 확인할 수 있어요.'],
  ['evidence-1', '고혈압입니다. 약을 중단하세요.'],
])(
  'keeps another citation or clinical-copy failure terminal before numeric correction (%s)',
  async (secondId, reason) => {
    const f = await fixture();
    try {
      const { provider, requests } = makeProvider([
        output(unsupported, secondId, reason),
        output(supported),
      ]);
      const { selection, option } = selectedOption(provider, 'on-device');
      const result = await runVisitQuestionWorkflow({
        prepared: f.context,
        selection,
        providerOptions: [option],
      });
      expect(result.status).toBe('unavailable');
      expect(requests).toHaveLength(1);
    } finally {
      f.close();
    }
  },
);

test('does not publish unsafe final question copy even when its numeric facts match', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(supported, 'evidence-1', '고혈압입니다. 약을 중단하세요.'),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
    });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('약을 중단하세요');
  } finally {
    f.close();
  }
});

test('requires fresh consent before the correction payload and stops when it is denied', async () => {
  const f = await fixture();
  try {
    const { provider, requests } = makeProvider([
      output(unsupported),
      output(supported),
    ]);
    const { selection, option } = selectedOption(provider);
    let approvals = 0;
    const result = await runVisitQuestionWorkflow({
      prepared: f.context,
      selection,
      providerOptions: [option],
      recipient: 'Synthetic selected account',
      confirmConsent: async () => ++approvals === 1,
    });
    expect(result.status).toBe('consent_required');
    expect(requests).toHaveLength(1);
    expect(approvals).toBe(2);
  } finally {
    f.close();
  }
});

test('does not add a numeric correction after the shared model-call budget is exhausted', async () => {
  const prepared = preparedContext();
  const lookup = (id: string) =>
    JSON.stringify({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id,
          name: 'visit-question-personal-record-search',
          arguments: { query: '합성 심박수 기록' },
        },
      ],
    });
  // Two model-selected local lookups consume the first two model calls; the
  // third result is invalid, so no correction call can fit the original ceiling.
  const { provider, requests } = makeProvider([
    lookup('first-lookup'),
    lookup('second-lookup'),
    output(unsupported),
    output(supported),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
  });
  expect(result).toMatchObject({
    status: 'unavailable',
    message: t('visitQuestions.workflowResults.failure.budgetExceeded'),
  });
  expect(requests).toHaveLength(3);
  expect(prepared.searchEvidence).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(requests)).not.toContain(
    'The previous questions failed exact',
  );
});
