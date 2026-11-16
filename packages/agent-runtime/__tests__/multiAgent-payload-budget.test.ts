import type { LanguageModelRequest } from '@orot/model-runtime';
import { authorizeModelCall } from '../src/multiAgent/modelAuthorization';
import { callModel } from '../src/multiAgent/modelCall';
import { utf8ByteLength } from '../src/multiAgent/protocol';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

function fixture() {
  const { provider, generate } = makeProvider(['synthetic result']);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(provider, tool);
  return { provider, generate, options, signal: new AbortController().signal };
}

test('an oversized serialized payload stops before consent and provider dispatch without a settings error', async () => {
  const f = fixture();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const request: LanguageModelRequest = {
    messages: [{ role: 'user', content: '합성'.repeat(12_000) }],
  };
  expect(utf8ByteLength(JSON.stringify(request))).toBeGreaterThan(64 * 1024);
  expect(await callModel(f.provider, request, f.options.execution, consent, f.signal)).toEqual({
    status: 'budget_exceeded',
  });
  expect(consent.authorize).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});

test('the byte limit is inclusive and counts UTF-8 bytes rather than string length', async () => {
  const f = fixture();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const request: LanguageModelRequest = { messages: [{ role: 'user', content: '합성' }] };
  const bytes = utf8ByteLength(JSON.stringify(request));
  const execution = {
    ...f.options.execution,
    budget: { ...f.options.execution.budget, maxPayloadBytes: bytes },
  };
  expect((await authorizeModelCall(request, execution, consent, f.signal)).status).toBe(
    'authorized',
  );
  consent.authorize.mockClear();
  expect(
    await authorizeModelCall(
      request,
      { ...execution, budget: { ...execution.budget, maxPayloadBytes: bytes - 1 } },
      consent,
      f.signal,
    ),
  ).toEqual({ status: 'budget_exceeded' });
  expect(consent.authorize).not.toHaveBeenCalled();
});

test('an unserializable request remains a malformed-request failure rather than a size limit', async () => {
  const f = fixture();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const request: LanguageModelRequest & { toJSON(): never } = {
    messages: [{ role: 'user', content: 'Synthetic' }],
    toJSON() {
      throw new Error('Synthetic private serialization detail');
    },
  };
  expect(await callModel(f.provider, request, f.options.execution, consent, f.signal)).toEqual({
    status: 'unavailable',
    errorCode: 'invalid_request',
  });
  expect(consent.authorize).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});

test('workflow preserves a local payload-budget failure without claiming a provider error', async () => {
  const f = fixture();
  const result = await runMultiAgentWorkflow({
    ...f.options,
    task: {
      ...f.options.task,
      createMessages: () => [{ role: 'user', content: 'Synthetic'.repeat(10_000) }],
    },
  });
  expect(result.status).toBe('budget_exceeded');
  expect(result).not.toHaveProperty('providerErrorCode');
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.options.consent.authorize).not.toHaveBeenCalled();
});
