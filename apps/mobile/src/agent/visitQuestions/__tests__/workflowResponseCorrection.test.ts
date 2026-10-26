import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

function suggestionOutput(
  firstQuestion: string,
  citations: readonly string[] = ['evidence-1'],
  secondQuestionEvidenceIds: readonly string[] = ['evidence-1'],
): string {
  const questions = [
    {
      questionText: firstQuestion,
      rationale: '최근 수면 기록의 변화를 의료진과 확인할 수 있어요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
    {
      questionText: '수면 변화와 관련해 어떤 점을 더 살펴보면 좋을까요?',
      rationale: '진료에서 관찰할 변화를 의료진과 정리할 수 있어요.',
      priority: 'important',
      evidenceIds: secondQuestionEvidenceIds,
    },
    {
      questionText: '다음 방문 전 기록할 점이 있을까요?',
      rationale: '진료 사이에 확인할 방법을 의료진에게 물어볼 수 있어요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
  ];
  return JSON.stringify({
    type: 'result',
    value: { status: 'suggestions', questions },
    citations,
  });
}

describe('visit-question response correction', () => {
  it('regenerates once after question validation rejects a declarative response', async () => {
    const prepared = preparedContext();
    const rejectedText =
      '최근 일주일간 평소보다 두 시간 일찍 잠에서 깨어 다시 잠들기 어려웠다는 기록을 바탕으로, 수면 패턴의 변화를 더 구체적으로 확인해야 합니다.';
    const acceptedText =
      '수면 패턴의 변화와 관련해 어떤 점을 관찰하고 기록하면 좋을까요?';
    const { provider, requests } = makeProvider([
      suggestionOutput(rejectedText),
      suggestionOutput(acceptedText),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.questions[0]?.questionText).toBe(acceptedText);
    expect(requests).toHaveLength(2);
    const userMessages = (index: number) =>
      requests[index]!.messages.filter(message => message.role === 'user');
    expect(userMessages(1).slice(0, -1)).toEqual(userMessages(0));
    expect(JSON.stringify(userMessages(1).at(-1))).toContain(
      'Korean interrogative',
    );
    expect(JSON.stringify(requests[0])).not.toContain(
      'The previous response failed local question-field validation.',
    );
    // Correction retains the rejected answer only as assistant context; source aliases still hide private IDs.
    const previousAnswer = requests[1]!.messages.find(
      message => message.role === 'assistant',
    );
    expect(JSON.parse(previousAnswer!.content as string)).toEqual(
      JSON.parse(suggestionOutput(rejectedText)),
    );
    expect(JSON.stringify(requests[1])).not.toContain('private-source-');
  });

  it('stops after one correction when the regenerated response is still invalid', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider([
      suggestionOutput('수면 패턴의 변화를 더 구체적으로 확인해야 합니다.'),
      suggestionOutput('수면 기록은 진료에서 더 구체적으로 확인해야 합니다.'),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(2);
  });

  it('does not exceed the model-call budget when research used the remaining call', async () => {
    const prepared = preparedContext();
    const outputs = successfulOutputs(
      prepared.initialEvidence,
      prepared.supplementalEvidence,
    );
    const finalResponse = JSON.parse(outputs[1]!) as {
      value: { questions: { questionText: string }[] };
    };
    finalResponse.value.questions[0]!.questionText =
      '수면 패턴의 변화를 더 구체적으로 확인해야 합니다.';
    outputs[1] = JSON.stringify(finalResponse);
    const { provider, requests } = makeProvider(outputs);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(3);
  });

  it('does not regenerate when a top-level citation is outside the current evidence', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider([
      suggestionOutput('수면 변화와 관련해 어떤 점을 살펴보면 좋을까요?', [
        'unknown-evidence',
      ]),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(1);
  });

  it('does not regenerate formatting when another question has an invalid evidence citation', async () => {
    const prepared = preparedContext();
    const { provider, requests } = makeProvider([
      suggestionOutput(
        '수면 패턴의 변화를 더 구체적으로 확인해야 합니다.',
        ['evidence-1'],
        ['unknown-evidence'],
      ),
      suggestionOutput('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?'),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(1);
  });

  it('does not regenerate unsafe clinical clarification copy', async () => {
    const prepared = preparedContext();
    const unsafeClarification = JSON.stringify({
      type: 'result',
      value: {
        status: 'needs_clarification',
        message: '복용약을 즉시 중단하세요.',
      },
      citations: ['evidence-1'],
    });
    const { provider, requests } = makeProvider([unsafeClarification]);
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });

    expect(result.status).toBe('unavailable');
    expect(requests).toHaveLength(1);
  });

  it('keeps incomplete coverage terminal even when question formatting could be corrected', async () => {
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
    const { provider, requests } = makeProvider([
      suggestionOutput('수면 패턴의 변화를 더 구체적으로 확인해야 합니다.'),
      suggestionOutput('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?'),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('needs_clarification');
    expect(requests).toHaveLength(1);
  });

  it('does not start a correction request after cancellation', async () => {
    const prepared = preparedContext();
    const controller = new AbortController();
    const { provider, requests } = makeProvider(
      [
        suggestionOutput('수면 패턴의 변화를 더 구체적으로 확인해야 합니다.'),
        suggestionOutput('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?'),
      ],
      (_request, callIndex) => {
        if (callIndex === 0) controller.abort();
      },
    );
    const { selection, option } = selectedOption(provider, 'on-device');

    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(requests).toHaveLength(1);
  });
});
