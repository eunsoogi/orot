import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { chatGPTPlanEncounterPage } from '../chatGPTPlanEncounterPage';

test('passes the stock encounter task final page through the exact Plan submission instead of the ordinary model', async () => {
  const choice = {
    providerId: 'chatgpt-plan:generated-account:generated-model',
    modelId: 'generated-model',
  };
  const generate = jest.fn(async () => {
    throw new Error('Ordinary Plan adapter must not be invoked.');
  });
  const provider = {
    id: choice.providerId,
    kind: 'language-model' as const,
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text' as const],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
  const approved = new Set<OutboundProcessingRequest>();
  const authorize = jest.fn(async (r: OutboundProcessingRequest) => {
    approved.add(r);
    return 'authorized' as const;
  });
  const line = 'Generated example only.';
  const candidate = {
    kind: 'plan',
    text: 'Generated example',
    speaker: 'unknown',
    evidence: [
      {
        segmentId: 'last-row',
        startOffset: 0,
        endOffset: line.length,
        quote: line,
      },
    ],
  };
  const terminal = Promise.resolve({
    text: JSON.stringify({
      type: 'result',
      citations: ['last-row'],
      value: { candidates: [candidate] },
    }),
  });
  const native = {
    prepare: jest.fn(async () => ({
      cancel: jest.fn(),
      admitAndSubmit: () => ({ stop: jest.fn(), terminal }),
    })),
  };
  const extract = chatGPTPlanEncounterPage({
    selected: {
      status: 'ready',
      selection: choice,
      option: {
        provider,
        modelId: choice.modelId,
        displayName: 'Synthetic',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
      provider,
      modelId: choice.modelId,
      recipient: 'generated-recipient',
      remoteProcessing: true,
    },
    sourceId: 'recording',
    executionId: 'generated-run',
    current: () => true,
    native,
    consent: {
      authorize,
      isAuthorizationCurrent: r => approved.has(r),
      subscribeAuthorizationInvalidation: () => () => {},
    },
  });
  expect(extract).toBeDefined();
  const candidates = await extract!(
    {
      sourceId: 'recording',
      segments: [
        {
          id: 'last-row',
          transcriptId: 'final-transcript',
          revision: 3,
          text: line,
          effectiveAt: '2026-01-01T00:00:00Z',
          audioRange: { startMs: 1000, endMs: 2000 },
        },
      ],
    },
    8,
    async () => true,
    new AbortController().signal,
  );
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(native.prepare).toHaveBeenCalledTimes(1);
  expect(native.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'recording',
      account: 'generated-account',
      model: 'generated-model',
      operation: 'generated-run:page:8',
      revisions: [{ id: 'last-row', revision: 3 }],
      wire: expect.objectContaining({
        transcript: expect.stringContaining(line),
      }),
    }),
    expect.anything(),
  );
  expect(candidates).toEqual([
    expect.objectContaining({ text: 'Generated example' }),
  ]);
  expect(generate).not.toHaveBeenCalled();
});
