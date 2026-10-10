import type { MultiAgentRunResult } from '@orot/agent-runtime';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { preparedContext } from '../testing/workflowFixtures';
import type { VisitQuestionTaskResult } from '../taskContract';
import { mapVisitQuestionWorkflowResult } from '../workflowResults';
import { t } from '../../../i18n';

function incompleteCoverageResult(
  message?: string,
): MultiAgentRunResult<VisitQuestionTaskResult> {
  // Coverage stops carry only task-validated copy; absence leaves the app fallback in control.
  return {
    status: 'needs_clarification',
    reason: 'Evidence coverage is incomplete.',
    checkpoint: {} as never,
    ...(message === undefined ? {} : { message }),
  };
}

describe('visit-question workflow result mapping', () => {
  it('preserves the runtime-validated clarification message for incomplete coverage', async () => {
    const prepared = preparedContext();
    const message =
      '현재 복용 기록이 서로 달라요. 어떤 복용 정보를 의료진과 확인할까요?';
    const result = await mapVisitQuestionWorkflowResult({
      result: incompleteCoverageResult(message),
      aliases: createVisitQuestionEvidenceAliases(prepared.evidence.batch),
      prepared,
    });

    expect(result).toEqual({
      status: 'needs_clarification',
      message,
      memoryStatus: 'available',
    });
  });

  it('keeps the app-owned fallback when incomplete coverage has no validated message', async () => {
    const prepared = preparedContext();
    const result = await mapVisitQuestionWorkflowResult({
      result: incompleteCoverageResult(),
      aliases: createVisitQuestionEvidenceAliases(prepared.evidence.batch),
      prepared,
    });

    expect(result).toEqual({
      status: 'needs_clarification',
      message: t('visitQuestions.workflowResults.failure.needsClarification'),
      memoryStatus: 'available',
    });
  });
});
