import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type TaskResponderContract,
  type MultiAgentExecutionIdentity,
} from '@orot/agent-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { buildTaskRequest } from '../../../../../../packages/agent-runtime/src/multiAgent/requests';
import { callModel } from '../../../../../../packages/agent-runtime/src/multiAgent/modelCall';
import { FakeNativeBridge } from '../../../../../../packages/provider-apple/__tests__/providerTestSupport';
import { FakeBridge } from '../../../../../../packages/provider-openai/__tests__/providerTestSupport';
import { createAppointmentClassificationTask } from '../../../medicalAppointments/classificationTask';
import { createVisitQuestionTaskResponder } from '../../../agent/visitQuestions/taskContract';
import { serializeAppleRequest } from '../serializeRequest';
import { symptomSummaryTask } from '../../../diseaseHypotheses/symptomSummaryTask';
import { evidence as summaryEvidence } from '../../../diseaseHypotheses/taskTestSupport';

const input = {
  request: 'Synthetic task',
  evidence: { items: [], coverage: [], conflicts: [] },
};
const budget = DEFAULT_MULTI_AGENT_BUDGET;
const execution: MultiAgentExecutionIdentity = {
  operationRunId: 'synthetic-run',
  providerId: 'apple-foundation-models',
  modelId: 'system-default',
  recipient: 'device',
  remoteProcessing: false,
  allowedScope: { sourceKinds: ['personal_record'] },
  budget,
};
const consent = { authorize: async () => 'authorized' as const };

test.each([
  ['calendar', createAppointmentClassificationTask()],
  ['visit questions', createVisitQuestionTaskResponder()],
] as const)(
  'serializes the real %s workflow as Apple guided output',
  async (_, contract) => {
    const provider = new AppleFoundationModelsProvider(new FakeNativeBridge());
    const built = await buildTaskRequest(
      provider,
      contract as TaskResponderContract<unknown>,
      input,
      budget,
    );
    expect(built.status).toBe('ready');
    if (built.status !== 'ready') throw new Error('Expected ready request');
    expect(() => serializeAppleRequest(built.request)).not.toThrow();
    expect(serializeAppleRequest(built.request).instructions).not.toContain(
      'Return one concise',
    );
    expect(serializeAppleRequest(built.request).instructions).toContain(
      'When the supplied evidence supports the task',
    );
    expect(serializeAppleRequest(built.request).schema).toMatchObject({
      kind: 'union',
      choices: [
        { name: expect.stringContaining('RequestAdditionalEvidence') },
        { name: expect.stringContaining('EvidenceGroundedResult') },
      ],
    });
  },
);

test('uses guided Apple generation and cancels its matching native request', async () => {
  const native = new FakeNativeBridge();
  native.generateWait = new Promise(() => {});
  let started!: () => void;
  const waiting = new Promise<void>(resolve => {
    started = resolve;
  });
  native.onGenerate = started;
  const provider = new AppleFoundationModelsProvider(native);
  const controller = new AbortController();
  const request = {
    messages: [{ role: 'user' as const, content: 'Synthetic' }],
    responseFormat: { name: 'answer', schema: { type: 'string' } },
  };
  const pending = callModel(
    provider,
    request,
    execution,
    consent,
    controller.signal,
  );
  await Promise.race([
    waiting,
    new Promise(resolve => setTimeout(resolve, 20)),
  ]);
  expect(native.generateCount).toBe(1);
  controller.abort();
  expect((await pending).status).toBe('cancelled');
  expect(native.cancelled).toEqual(native.generatedRequestIds);
});

test('sends the real workflow to the selected ChatGPT slug without unsupported controls', async () => {
  const bridge = new FakeBridge(async (requestId, target) => {
    target.emit({ requestId, type: 'text_delta', text: '{}' });
    target.emit({ requestId, type: 'completed', text: '{}' });
  });
  const provider = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic',
    model: { slug: 'chosen-model', displayName: 'Chosen' },
  });
  const built = await buildTaskRequest(
    provider,
    createAppointmentClassificationTask(),
    input,
    budget,
  );
  if (built.status !== 'ready') throw new Error('Expected ready request');
  expect((await provider.generate(built.request)).ok).toBe(true);
  expect(bridge.started[0]?.request.model).toBe('chosen-model');
});

test('serializes mixed-source summary choices and constrained top-level citation IDs for Apple', async () => {
  const evidence = {
    ...summaryEvidence,
    items: [
      ...summaryEvidence.items,
      {
        ...summaryEvidence.items[0]!,
        sourceKind: 'external_medical' as const,
        evidenceId: 'public-paper',
      },
    ],
  };
  const built = await buildTaskRequest(
    new AppleFoundationModelsProvider(new FakeNativeBridge()),
    symptomSummaryTask,
    { ...input, evidence },
    budget,
  );
  if (built.status !== 'ready')
    throw new Error('Expected ready summary request');
  const serialized = serializeAppleRequest(built.request);
  const text = JSON.stringify(serialized.schema);
  expect(text).toContain('PersonalRecordFacts');
  expect(text).toContain('PublicMedicalContext');
  expect(text).toContain('public-paper');
});
