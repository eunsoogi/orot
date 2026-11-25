import { providerSuccess } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
import { runMultiAgentWorkflow, type EvidenceReference } from '../src';
import { makeOptions, reference } from './multiAgent-evidence-freshness-fixture';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

describe('multi-agent evidence freshness at model boundaries', () => {
  it('revalidates after consent and before dispatching evidence to the provider', async () => {
    let fresh = true;
    const revalidateEvidence = jest.fn(async () => fresh);
    const authorize = jest.fn(async () => {
      fresh = false;
      return 'authorized' as const;
    });
    const { options, generate } = makeOptions(revalidateEvidence, authorize);

    const result = await runMultiAgentWorkflow(options);

    expect(generate).not.toHaveBeenCalled();
    expect(result.status).toBe('stale_evidence');
    expect(revalidateEvidence).toHaveBeenCalledTimes(2);
  });

  it('rejects a result when its cited evidence changed during the provider call', async () => {
    let fresh = true;
    const revalidateEvidence = jest.fn(async () => fresh);
    const authorize = jest.fn(async () => 'authorized' as const);
    const { options, generate } = makeOptions(revalidateEvidence, authorize);
    generate.mockImplementation(async () => {
      fresh = false;
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Ask about the recorded blood pressure.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    });

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('stale_evidence');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(revalidateEvidence).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['result', undefined, false],
    ['task-approved clarification', '혈압 120/80 mmHg 기록을 확인해 주세요.', false],
    ['incomplete-coverage clarification', '혈압 120/80 mmHg 기록을 확인해 주세요.', true],
  ] as const)(
    'revalidates after the final checkpoint write before publishing %s',
    async (_outcome, copy, incomplete) => {
      let fresh = true;
      const revalidateEvidence = jest.fn(async () => fresh);
      const authorize = jest.fn(async () => 'authorized' as const);
      const { options } = makeOptions(revalidateEvidence, authorize, copy, incomplete);
      const saver = new MemorySaver();
      let releaseFinalWrite!: () => void, markFinalWriteStarted!: () => void;
      const finalWriteGate = new Promise<void>((resolve) => {
        releaseFinalWrite = resolve;
      });
      const finalWriteStarted = new Promise<void>((resolve) => {
        markFinalWriteStarted = resolve;
      });
      const persist = saver.put.bind(saver);
      let heldFinalWrite = false;
      jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
        const [, checkpoint] = args;
        const values = checkpoint.channel_values as Record<string, unknown>;
        if (!heldFinalWrite && values.phase === 'complete' && values.terminal === true) {
          heldFinalWrite = true;
          markFinalWriteStarted();
          await finalWriteGate;
        }
        return persist(...args);
      });
      const pending = runMultiAgentWorkflow(
        { ...options, checkpointer: saver },
        { config: { configurable: { thread_id: 'freshness-final-write' } } },
      );

      await finalWriteStarted;
      fresh = false;
      releaseFinalWrite();
      expect((await pending).status).toBe('stale_evidence');
      expect(revalidateEvidence).toHaveBeenCalledTimes(4);
    },
  );

  it('does not start evidence revalidation when consent resolves after cancellation', async () => {
    let authorizeLate!: (decision: 'authorized') => void;
    let markAuthorizationStarted!: () => void;
    const authorization = new Promise<'authorized'>((resolve) => {
      authorizeLate = resolve;
    });
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const abortedValidation = Promise.reject(new Error('Evidence lookup was aborted.'));
    abortedValidation.catch(() => undefined);
    const revalidateEvidence = jest.fn(
      (_references: readonly EvidenceReference[], signal: AbortSignal): Promise<boolean> =>
        signal.aborted ? abortedValidation : Promise.resolve(true),
    );
    const authorize = jest.fn(() => {
      markAuthorizationStarted();
      return authorization;
    });
    const { options, generate } = makeOptions(revalidateEvidence, authorize);
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(options, { signal: controller.signal });

    await authorizationStarted;
    controller.abort();
    const result = await pending;
    authorizeLate('authorized');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.status).toBe('cancelled');
    expect(revalidateEvidence).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
});

test('preserves an unrelated journal completion refusal when evidence remains current', async () => {
  const current = jest.fn(async () => true);
  const { options, generate } = makeOptions(current, async () => 'authorized');
  const { journal, records } = operationJournalFixture();
  // Refuse persistence for an independent reason so stale evidence cannot mask it.
  const complete = jest
    .fn<ReturnType<typeof journal.complete>, Parameters<typeof journal.complete>>()
    .mockResolvedValue(false);
  const acknowledge = jest.fn(async () => true);
  const result = await runMultiAgentWorkflow({
    ...options,
    operationJournal: {
      ...journal,
      complete,
      steering: {
        enqueue: async () => true,
        list: async () => [],
        bind: async (_operation, request) => request,
        acknowledge,
      },
    },
  });
  expect(result).toMatchObject({ status: 'unavailable', providerErrorCode: 'invalid_request' });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(acknowledge).not.toHaveBeenCalled();
  const rejected = complete.mock.calls[0]?.[0].operationId;
  expect(rejected).toEqual(expect.any(String));
  expect(records.get(rejected ?? '')?.state.status).toBe('pending');
  expect([...records.values()].some(({ state }) => state.status === 'completed')).toBe(false);
});
