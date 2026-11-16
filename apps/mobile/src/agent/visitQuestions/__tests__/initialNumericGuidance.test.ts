import { runVisitQuestionWorkflow } from '../workflow';
import { suggestionOutput } from '../testing/responseCorrectionFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';

const supported = '수면 기록을 바탕으로 진료 전 어떤 변화를 기록하면 좋을까요?';
const unsupported =
  '수면 시간이 999시간이라는 기록을 어떻게 확인하면 좋을까요?';

async function run(outputs: string[]) {
  const { provider, requests } = makeProvider(outputs);
  const { selection, option } = selectedOption(provider, 'on-device');
  const prepared = preparedContext();
  const sleepEvidence = {
    ...prepared.initialEvidence,
    content:
      '최근 수면 패턴에 변화가 있어 진료에서 관찰할 점을 확인하기로 했어요.',
  };
  const result = await runVisitQuestionWorkflow({
    prepared: {
      ...prepared,
      evidence: {
        ...prepared.evidence,
        batch: { ...prepared.evidence.batch, items: [sleepEvidence] },
      },
      reloadPersonalEvidence: async () => sleepEvidence,
    },
    selection,
    providerOptions: [option],
  });
  return { result, requests };
}

// Synthetic responses prove prompt delivery and unchanged acceptance, not real-model latency.
test('delivers exact numeric guidance before the first answer and accepts a supported nonnumeric question', async () => {
  const { result, requests } = await run([suggestionOutput(supported)]);
  expect(result.status).toBe('ready');
  expect(requests).toHaveLength(1);
  const request = JSON.stringify(requests[0]);
  expect(request).toContain('In both questionText and rationale');
  expect(request).toContain('complete units from the same cited evidence item');
  expect(request).toContain(
    'Do not round, convert units, calculate new quantities',
  );
  expect(request).toContain('including its denominator');
  expect(request).toContain('without a numeric claim');
});

test('still rejects an unsupported value after the single bounded correction', async () => {
  const { result, requests } = await run([
    suggestionOutput(unsupported),
    suggestionOutput(unsupported),
    suggestionOutput(supported),
  ]);
  expect(result.status).toBe('rejected_output');
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('999');
});

test('retains the valid one-shot recovery without silently removing an unsupported value', async () => {
  const { result, requests } = await run([
    suggestionOutput(unsupported),
    suggestionOutput(supported),
  ]);
  expect(result.status).toBe('ready');
  expect(requests).toHaveLength(2);
  if (result.status === 'ready')
    expect(result.questions[0]?.questionText).toBe(supported);
});
