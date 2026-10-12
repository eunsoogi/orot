import { batch, run } from '../testing/rankedWorkflowFixtures';
import { diseaseHypothesisTask } from '../../../diseaseHypotheses/task';
import { createVisitQuestionTaskResponder } from '../../../agent/visitQuestions/taskContract';

const evidence = {
  ...batch,
  items: [
    {
      ...batch.items[0],
      content:
        '합성 기록: 최근 일주일 동안 새벽에 깨고 다시 잠들기 어렵다고 기록했어요.',
    },
  ],
};

describe.each(['Apple', 'ChatGPT'] as const)(
  '%s feature task contracts',
  kind => {
    it('restores exact disease evidence references from the supported compact citation schema', async () => {
      const { result } = await run(kind, evidence, {
        task: diseaseHypothesisTask,
        output: {
          type: 'result',
          citations: ['e1'],
          value: {
            hypotheses: [
              {
                title: '수면 유지 문제 가능성',
                summary: '새벽에 깨어 다시 잠들기 어렵다는 기록이 있어요.',
                supportingEvidence: ['e1'],
                contraryEvidence: [],
                uncertainty: '단일 기록만으로 원인을 알 수 없어요.',
                missingData: ['지속 기간과 생활 변화에 관한 기록'],
              },
            ],
          },
        },
      });
      expect(result.status).toBe('result');
      if (result.status !== 'result') throw new Error(JSON.stringify(result));
      expect(result.value).toMatchObject({
        hypotheses: [
          {
            supportingEvidence: [
              expect.objectContaining({
                evidenceId: 'e1',
                evidenceRevision: 'er1',
              }),
            ],
          },
        ],
      });
    });

    it('validates three source-linked questions using the real visit task', async () => {
      const { result } = await run(kind, evidence, {
        task: createVisitQuestionTaskResponder(),
        output: {
          type: 'result',
          citations: ['e1'],
          value: {
            status: 'suggestions',
            questions: [
              {
                questionText: '새벽에 깨는 변화는 어떻게 살펴보면 좋을까요?',
                rationale: '기록한 수면 변화를 함께 확인해요.',
                priority: 'important',
                evidenceIds: ['e1'],
              },
              {
                questionText: '다음 방문까지 어떤 수면 기록을 준비할까요?',
                rationale: '변화의 경과를 확인할 기록이 필요해요.',
                priority: 'routine',
                evidenceIds: ['e1'],
              },
              {
                questionText: '다시 잠들기 어려운 때 확인할 점이 있을까요?',
                rationale: '기록된 불편에 관해 질문해요.',
                priority: 'routine',
                evidenceIds: ['e1'],
              },
            ],
          },
        },
      });
      expect(result.status).toBe('result');
      if (result.status !== 'result') throw new Error(JSON.stringify(result));
      expect(result.value).toMatchObject({
        status: 'suggestions',
        questions: [
          expect.objectContaining({
            citations: [expect.objectContaining({ evidenceId: 'e1' })],
          }),
          expect.anything(),
          expect.anything(),
        ],
      });
    });
  },
);
