import {
  createPreparedContext,
  createSyntheticProvider,
  createVisitQuestionsProbeMetrics,
} from '../e2e/visitQuestionsProbe';
import { runVisitQuestionWorkflow } from '../src/agent/visitQuestions/workflow';
import { selectedOption } from '../src/agent/visitQuestions/testing/workflowFixtures';

test('the original synthetic probe follows the current role and citation protocol without exposing private identifiers', async () => {
  const metrics = createVisitQuestionsProbeMetrics();
  const { selection, option } = selectedOption(
    createSyntheticProvider(metrics),
    'on-device',
  );
  const result = await runVisitQuestionWorkflow({
    prepared: createPreparedContext(),
    selection,
    providerOptions: [option],
  });
  expect(result.status).toBe('ready');
  expect(metrics).toMatchObject({
    calls: 2,
    allowedReferenceCount: 2,
    privateIdentifierExposed: false,
  });
  if (result.status !== 'ready')
    throw new Error('Missing original synthetic review');
  expect(result.questions).toHaveLength(3);
  for (const question of result.questions) {
    expect(question.citations).toHaveLength(1);
    expect(question.citations[0]?.content).toBe(
      '이 프로브에만 쓰는 합성 검사 기록입니다.',
    );
  }
});
