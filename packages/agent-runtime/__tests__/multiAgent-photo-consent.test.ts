import { callModelWithEvidenceFreshness } from '../src/multiAgent/modelCallFreshness';
import { callModel } from '../src/multiAgent/modelCall';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import type { ExecutionConsentPort } from '../src/multiAgent/contracts';

jest.mock('../src/multiAgent/modelCall', () => ({
  ...jest.requireActual('../src/multiAgent/modelCall'),
  callModel: jest.fn().mockResolvedValue({
    status: 'response',
    response: { text: '', toolCalls: [], finishReason: 'complete' },
  }),
}));

function fixture(authorize: ExecutionConsentPort['authorize']) {
  const signal = new AbortController().signal;
  const request = { messages: [{ role: 'user' as const, content: 'synthetic OCR payload' }] };
  const context = {
    signal,
    timedOut: () => false,
    currentEvidence: { items: [], coverage: [], conflicts: [] },
    options: {
      provider: {},
      execution: {
        operationRunId: 'run',
        providerId: 'provider',
        modelId: 'model',
        recipient: 'device',
        remoteProcessing: false,
        allowedScope: { sourceKinds: ['personal_record'] },
        consentScope: {
          purpose: 'record_conversation',
          policyVersion: 'v1',
          dataCategories: ['photo_ocr'],
        },
      },
      photoInput: { evidenceIds: ['e1'], consent: { authorize } },
      consent: { authorize: async () => 'authorized' },
      revalidateEvidence: async () => true,
    },
  } as unknown as RuntimeContext<unknown>;
  return { context, request, signal };
}

beforeEach(() => jest.mocked(callModel).mockClear());

test('local photo processing requires explicit consent on the actual payload', async () => {
  const authorize = jest.fn().mockResolvedValue('authorized');
  const f = fixture(authorize);
  await callModelWithEvidenceFreshness(f.context, f.request);
  expect(authorize).toHaveBeenCalledWith(
    expect.objectContaining({ payload: f.request, remoteProcessing: false, signal: f.signal }),
  );
  expect(callModel).toHaveBeenCalledTimes(1);
});

test('denial or payload mutation during approval prevents the provider call', async () => {
  const denied = fixture(async () => 'renewal_required');
  expect(await callModelWithEvidenceFreshness(denied.context, denied.request)).toEqual({
    status: 'consent_required',
  });
  const changed = fixture(async () => {
    changed.request.messages[0]!.content = 'changed';
    return 'authorized';
  });
  expect(await callModelWithEvidenceFreshness(changed.context, changed.request)).toEqual({
    status: 'consent_required',
  });
  expect(callModel).not.toHaveBeenCalled();
});
