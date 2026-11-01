import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { t } from '../../../i18n';
import { runVisitQuestionWorkflow } from '../workflow';

function withBloodPressureEvidence() {
  const prepared = preparedContext();
  const item = {
    ...prepared.initialEvidence,
    effectiveTime: '2026-09-01T08:00:00+09:00',
    content: '2026-09-01 혈압 120/80 mmHg',
  };
  return {
    ...prepared,
    evidence: {
      ...prepared.evidence,
      batch: { ...prepared.evidence.batch, items: [item] },
    },
  };
}

async function runClarification(message: string, prepared = preparedContext()) {
  const { provider } = makeProvider([
    JSON.stringify({
      type: 'result',
      value: { status: 'needs_clarification', message },
      citations: [],
    }),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  return runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
  });
}

function expectInvalidClarificationFallback(
  result: Awaited<ReturnType<typeof runVisitQuestionWorkflow>>,
  unsafeText: string,
) {
  expect(result).toMatchObject({
    status: 'rejected_output',
    message: t('visitQuestions.workflowResults.failure.invalidOutput'),
  });
  expect(JSON.stringify(result)).not.toContain(unsafeText);
}

describe('visit-question clarification workflow', () => {
  it.each(['', 'No sufficient evidence.', 'a'.repeat(401)])(
    'uses app-owned guidance when clarification text is unusable: %s',
    async message => {
      const result = await runClarification(message);
      expect(result).toMatchObject({
        status: 'needs_clarification',
        message:
          '질문을 준비하기 전에 관련 건강 기록과 진료에서 확인할 내용을 살펴봐 주세요.',
      });
      if (message) expect(JSON.stringify(result)).not.toContain(message);
    },
  );

  it('rejects an unknown citation before applying the clarification fallback', async () => {
    const prepared = preparedContext();
    const { provider } = makeProvider([
      JSON.stringify({
        type: 'result',
        value: { status: 'needs_clarification', message: '' },
        citations: ['unknown-evidence'],
      }),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('rejected_output');
  });
  it('preserves the responder clarification in the public result', async () => {
    // Complete coverage exercises the task-result path, including safe copy preservation.
    const message =
      '기록된 측정 날짜가 서로 다른데, 어느 날짜가 맞는지 알려 주세요.';
    const result = await runClarification(message);

    expect(result).toEqual({
      status: 'needs_clarification',
      message,
      memoryStatus: 'available',
    });
  });

  it('replaces unsupported dates and measurements with app-owned copy', async () => {
    const result = await runClarification(
      '기록된 2026년 9월 2일 혈압 130/80 mmHg가 맞는지 알려 주세요.',
      withBloodPressureEvidence(),
    );

    expect(result).toMatchObject({
      status: 'needs_clarification',
      message: t('visitQuestions.validation.unverifiedDateOrValue'),
    });
    expect(JSON.stringify(result)).not.toContain('130/80');
  });

  it('replaces diagnosis claims with app-owned copy', async () => {
    const result = await runClarification(
      '고혈압이므로 확인해 주시겠어요?',
      withBloodPressureEvidence(),
    );

    expectInvalidClarificationFallback(result, '고혈압이므로');
  });

  it('replaces advice to stop a medication with app-owned copy', async () => {
    const message = '약을 중단하세요. 확인해 주시겠어요?';
    const result = await runClarification(message, withBloodPressureEvidence());

    expectInvalidClarificationFallback(result, '약을 중단하세요');
  });

  it('replaces advice to reduce a medication with app-owned copy', async () => {
    const message = '약을 줄이세요. 어떤 약인지 알려 주세요.';
    const result = await runClarification(message, withBloodPressureEvidence());

    expectInvalidClarificationFallback(result, '약을 줄이세요');
  });

  it('replaces advice to increase a medication dose with app-owned copy', async () => {
    const message = '약 용량을 늘리세요. 확인해 주시겠어요?';
    const result = await runClarification(message, withBloodPressureEvidence());

    expectInvalidClarificationFallback(result, '약 용량을 늘리세요');
  });
});
