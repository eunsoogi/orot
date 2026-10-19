import {
  PERFORMANCE_RAG_QUESTION,
  performanceRagDiagnostics,
  runPerformanceRagQuestion,
} from '../e2e/performanceRagDiagnostics';
import { openAiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import type { AiFeatureServices } from '../src/aiFeatures/integration/featureServices';
import { runRagConversationTurn } from '../src/ragConversation/service';

jest.mock('../src/aiFeatures/integration/localData', () => ({
  openAiFeatureLocalData: jest.fn(),
}));
jest.mock('../src/ragConversation/service', () => ({
  runRagConversationTurn: jest.fn(),
}));

/** Diagnostic wrappers may observe an outcome, but must never repair or seed it. */
describe('synthetic RAG diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the fixed Korean question through the on-device app service', async () => {
    const outcome = { status: 'insufficient' as const };
    const sendRagMessage = jest.fn(async () => outcome);
    const signal = new AbortController().signal;
    const result = await runPerformanceRagQuestion(
      {
        status: 'ready',
        provider: { id: 'apple-foundation-models' },
        remoteProcessing: false,
      },
      {
        sendRagMessage:
          sendRagMessage as unknown as AiFeatureServices['sendRagMessage'],
      },
      signal,
    );

    expect(result).toEqual({
      status: 'completed',
      question: PERFORMANCE_RAG_QUESTION,
      outcome,
    });
    expect(sendRagMessage).toHaveBeenCalledWith(
      PERFORMANCE_RAG_QUESTION,
      [],
      signal,
    );
  });

  it.each([
    {
      status: 'ready' as const,
      provider: { id: 'chatgpt-plan:account:model' },
      remoteProcessing: true,
    },
    { status: 'unavailable' as const },
  ])(
    'does not send the diagnostic for a non-Apple provider',
    async selection => {
      const sendRagMessage = jest.fn();
      const result = await runPerformanceRagQuestion(
        selection,
        {
          sendRagMessage:
            sendRagMessage as unknown as AiFeatureServices['sendRagMessage'],
        },
        new AbortController().signal,
      );

      expect(result).toEqual({
        status: 'skipped',
        reason: 'on_device_apple_provider_not_selected',
      });
      expect(sendRagMessage).not.toHaveBeenCalled();
    },
  );

  it.each(['unrelated evidence', 'no evidence'])(
    'preserves the actual search response for %s',
    async scenario => {
      jest.spyOn(console, 'info').mockImplementation(() => {});
      const batch = {
        items: scenario === 'no evidence' ? [] : [{ content: 'unrelated' }],
        coverage: [],
        conflicts: [],
      };
      const search = jest.fn(async () => batch);
      const request = { input: { query: 'synthetic heart rate' } };
      const outcome = { status: 'insufficient' as const };
      jest.mocked(runRagConversationTurn).mockImplementation(async options => {
        expect(options.question).toBe('synthetic heart rate');
        const observed = await options.workflow.tools[0]!.search(
          request as never,
        );
        expect(observed).toBe(batch);
        return outcome;
      });
      const diagnostics = performanceRagDiagnostics();
      const invocation = { signal: new AbortController().signal };
      const result = await diagnostics.ragRunner!(
        {
          question: 'synthetic heart rate',
          workflow: { tools: [{ id: 'actual', search }] },
        } as never,
        invocation,
      );
      expect(result).toBe(outcome);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(request);
      expect(jest.mocked(runRagConversationTurn).mock.calls.at(-1)?.[1]).toBe(
        invocation,
      );
      expect(diagnostics.getTrace()).toEqual([
        { stage: 'question', value: 'synthetic heart rate' },
        {
          stage: 'selected',
          value: { tool: 'actual', input: request.input, result: batch },
        },
        { stage: 'outcome', value: outcome },
      ]);
    },
  );

  it('preserves candidate and rank objects without adding a preferred source', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const candidates = { candidates: [] };
    const hits: never[] = [];
    const readCandidates = jest.fn(async () => candidates);
    const search = jest.fn(async () => hits);
    const index = jest.fn(async () => {});
    jest.mocked(openAiFeatureLocalData).mockResolvedValue({
      readCandidates,
      rag: { search, index },
    } as never);
    const diagnostics = performanceRagDiagnostics();
    const data = await diagnostics.loadLocalData!();
    expect(await diagnostics.loadLocalData!()).toBe(data);
    const signal = new AbortController().signal;
    expect(await data.readCandidates('unmatched', signal)).toBe(candidates);
    expect(await data.rag.search('unmatched', [], 3, { signal })).toBe(hits);
    expect(readCandidates).toHaveBeenCalledWith('unmatched', signal);
    expect(search).toHaveBeenCalledWith('unmatched', [], 3, { signal });
    expect(diagnostics.getTrace()).toEqual([
      {
        stage: 'candidates',
        value: { query: 'unmatched', records: [] },
      },
      { stage: 'ranked', value: { query: 'unmatched', limit: 3, hits: [] } },
    ]);
  });
});
