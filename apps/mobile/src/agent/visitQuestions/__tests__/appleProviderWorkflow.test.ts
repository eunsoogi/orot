import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { FakeNativeBridge } from '../../../../../../packages/provider-apple/__tests__/providerTestSupport';
import { runVisitQuestionWorkflow } from '../workflow';
import { modelResponseFixture } from '../testing/modelResponseFixture';
import {
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

function setup() {
  const prepared = preparedContext();
  const native = new FakeNativeBridge();
  const provider = new AppleFoundationModelsProvider(native);
  const selected = selectedOption(provider, 'on-device');
  const run = (signal = new AbortController().signal) =>
    runVisitQuestionWorkflow({
      prepared,
      selection: selected.selection,
      providerOptions: [selected.option],
      signal,
    });
  return { prepared, native, run };
}

test('runs the visit workflow through the Apple adapter with synthetic guided responses', async () => {
  const { prepared, native, run } = setup();
  const outputs = successfulOutputs(
    prepared.initialEvidence,
    prepared.supplementalEvidence,
  );
  const requests: unknown[] = [];
  native.generate = jest.fn(async request => {
    requests.push(request);
    return modelResponseFixture(outputs[requests.length - 1] ?? '');
  });
  const result = await run();
  expect(result.status).toBe('ready');
  if (result.status !== 'ready')
    throw new Error('Synthetic questions were not generated.');
  expect(result.questions).toHaveLength(3);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    responseFormat: { schema: expect.any(Object) },
  });
});

test('rejects unparseable guided output without producing questions', async () => {
  const { native, run } = setup();
  native.generate = jest.fn(async () => modelResponseFixture('{invalid'));
  const result = await run();
  expect(result.status).toBe('rejected_output');
  expect(result).not.toHaveProperty('questions');
  expect(native.generate).toHaveBeenCalledTimes(1);
});

test('reports a native refusal without retrying or returning questions', async () => {
  const { native, run } = setup();
  native.generate = jest.fn(async () => {
    throw Object.assign(new Error('Synthetic private provider detail'), {
      code: 'SAFETY_REFUSAL',
    });
  });
  const result = await run();
  expect(result).toMatchObject({
    status: 'unavailable',
    message:
      '선택한 AI 서비스가 이 요청에 답하지 않았어요. 질문을 바꿔 다시 시도해 주세요.',
  });
  expect(JSON.stringify(result)).not.toContain(
    'Synthetic private provider detail',
  );
  expect(result).not.toHaveProperty('questions');
  expect(native.generate).toHaveBeenCalledTimes(1);
});

test('does not invoke native generation while the model is not ready', async () => {
  const { native, run } = setup();
  native.availability = 'modelNotReady';
  const result = await run();
  expect(result.status).toBe('unavailable');
  expect(native.generateCount).toBe(0);
});

test('cancels the matching native request and ignores a late response', async () => {
  const { prepared, native, run } = setup();
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => {
    started = resolve;
  });
  let finish!: (value: ReturnType<typeof modelResponseFixture>) => void;
  native.generateWait = new Promise(resolve => {
    finish = resolve;
  });
  native.onGenerate = started;
  const controller = new AbortController();
  const pending = run(controller.signal);
  await dispatched;
  controller.abort();
  finish(
    modelResponseFixture(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      )[0]!,
    ),
  );
  expect((await pending).status).toBe('cancelled');
  expect(native.cancelled).toEqual(native.generatedRequestIds);
  expect(native.generateCount).toBe(1);
  expect(prepared.searchEvidence).not.toHaveBeenCalled();
});
