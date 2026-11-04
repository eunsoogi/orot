import { suggestionOutput } from '../testing/responseCorrectionFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';
import { clarificationQuestions } from '../clarificationQuestions';

describe('partial evidence correction', () => {
  it('corrects incomplete coverage by including a missing-information question', async () => {
    const current = preparedContext();
    const prepared = {
      ...current,
      evidence: {
        ...current.evidence,
        batch: {
          ...current.evidence.batch,
          coverage: current.evidence.batch.coverage.map(coverage => ({
            ...coverage,
            gaps: ['Synthetic selected-record coverage is incomplete.'],
          })),
        },
      },
    };
    const corrected = JSON.parse(
      suggestionOutput('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?'),
    );
    corrected.value.questions[2] = {
      ...clarificationQuestions[0],
      kind: 'clarification',
      priority: 'routine',
      evidenceIds: [],
    };
    const { provider, requests } = makeProvider([
      suggestionOutput('수면 패턴의 변화를 더 구체적으로 확인해야 합니다.'),
      JSON.stringify(corrected),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected questions');
    expect(result.questions[2]).toMatchObject({
      kind: 'clarification',
      citations: [],
    });
    expect(requests).toHaveLength(2);
  });
});
