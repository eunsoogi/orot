import { callModelWithEvidenceFreshness } from '../src/multiAgent/modelCallFreshness';
import { callModel } from '../src/multiAgent/modelCall';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';

jest.mock('../src/multiAgent/modelCall', () => ({
  ...jest.requireActual('../src/multiAgent/modelCall'),
  callModel: jest.fn().mockResolvedValue({
    status: 'response',
    response: { text: '', toolCalls: [], finishReason: 'complete' },
  }),
}));

function fixture() {
  const controller = new AbortController();
  const request = { messages: [{ role: 'user' as const, content: 'Synthetic input' }] };
  const context = {
    signal: controller.signal,
    timedOut: () => false,
    currentEvidence: { items: [], coverage: [], conflicts: [] },
    options: {
      provider: {},
      execution: { remoteProcessing: false },
      consent: { authorize: async () => 'authorized' },
      revalidateEvidence: async () => true,
    },
  } as unknown as RuntimeContext<unknown>;
  return { controller, request, context };
}

beforeEach(() => jest.mocked(callModel).mockClear());

test('stream preparation completes with the actual input before the provider starts', async () => {
  const f = fixture();
  let finish!: () => void;
  const barrier = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const context = { ...f.context, beforeTaskStream: barrier };
  const pending = callModelWithEvidenceFreshness(context, f.request, () => {});
  await Promise.resolve();
  await Promise.resolve();
  expect(barrier).toHaveBeenCalledWith(
    expect.objectContaining({ request: f.request, evidence: f.context.currentEvidence }),
    f.controller.signal,
  );
  expect(callModel).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(callModel).toHaveBeenCalledTimes(1);
});

test('failed or cancelled preparation prevents provider invocation', async () => {
  const f = fixture();
  await callModelWithEvidenceFreshness(
    {
      ...f.context,
      beforeTaskStream: async () => {
        throw new Error('private error');
      },
    },
    f.request,
    () => {},
  );
  expect(callModel).not.toHaveBeenCalled();
  const pending = callModelWithEvidenceFreshness(
    {
      ...fixture().context,
      signal: f.controller.signal,
      beforeTaskStream: () => new Promise<void>(() => {}),
    },
    f.request,
    () => {},
  );
  f.controller.abort();
  await pending;
  expect(callModel).not.toHaveBeenCalled();
});

test('consumers without a preparation callback retain the existing behavior', async () => {
  const f = fixture();
  await callModelWithEvidenceFreshness(f.context, f.request, () => {});
  expect(callModel).toHaveBeenCalledTimes(1);
});

test('preparation still fences a call when no preview stream is exposed', async () => {
  const f = fixture();
  const barrier = jest.fn().mockRejectedValue(new Error('source unavailable'));
  await callModelWithEvidenceFreshness({ ...f.context, beforeTaskStream: barrier }, f.request);
  expect(barrier).toHaveBeenCalled();
  expect(callModel).not.toHaveBeenCalled();
});

test('an input changed during preparation never reaches the provider', async () => {
  const f = fixture();
  const context = {
    ...f.context,
    beforeTaskStream: async () => {
      f.request.messages[0]!.content = 'Changed input';
    },
  };
  await callModelWithEvidenceFreshness(context, f.request, () => {});
  expect(callModel).not.toHaveBeenCalled();
});

test('source freshness is checked again after asynchronous preparation', async () => {
  const f = fixture();
  let checks = 0;
  const context = {
    ...f.context,
    currentEvidence: {
      items: [
        {
          sourceKind: 'personal_record',
          sourceId: 'record',
          sourceRevision: 'one',
          evidenceId: 'evidence',
          evidenceRevision: 'one',
          locator: null,
          effectiveTime: null,
          reviewState: 'reviewed',
          content: 'Synthetic evidence',
        },
      ],
      coverage: [],
      conflicts: [],
    },
    beforeTaskStream: async () => {},
    options: { ...f.context.options, revalidateEvidence: async () => ++checks === 1 },
  } as unknown as RuntimeContext<unknown>;
  await callModelWithEvidenceFreshness(context, f.request, () => {});
  expect(checks).toBe(2);
  expect(callModel).not.toHaveBeenCalled();
});
