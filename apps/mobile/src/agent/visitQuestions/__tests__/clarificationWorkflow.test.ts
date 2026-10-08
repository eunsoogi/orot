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

describe('visit-question clarification workflow', () => {
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

  it('replaces medication-change advice with app-owned copy', async () => {
    const result = await runClarification(
      '고혈압이므로 약을 중단하세요. 확인해 주시겠어요?',
      withBloodPressureEvidence(),
    );

    expect(result).toMatchObject({
      status: 'unavailable',
      message: t('visitQuestions.workflowResults.failure.invalidOutput'),
    });
    expect(JSON.stringify(result)).not.toContain('약을 중단하세요');
  });
});
