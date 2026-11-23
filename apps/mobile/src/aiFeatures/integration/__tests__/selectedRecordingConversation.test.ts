import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  chosen,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';

const mockProtection = jest.fn(async () => true);
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockProtection,
  }),
}));

it.each([
  'generic-fallback',
  'silent-lock',
  'stop',
  'deleted',
  'account-changed',
] as const)('fails closed for %s in the actual selected-turn graph', mode =>
  withRecordings(async data => {
    mockProtection.mockReset().mockResolvedValue(true);
    const fake = publicEvidenceFixture();
    const controller = new AbortController();
    let current = true;
    let account = true;
    if (mode !== 'generic-fallback')
      fake.authorize
        .mockResolvedValueOnce('authorized')
        .mockImplementationOnce(async () => {
          if (mode === 'silent-lock') mockProtection.mockResolvedValue(false);
          if (mode === 'stop') controller.abort();
          if (mode === 'deleted') current = false;
          if (mode === 'account-changed') account = false;
          return 'authorized';
        });
    const journal = jest.fn(async () => {
      throw new Error('unapproved history/checkpoint read');
    });
    const read = jest.spyOn(data, 'readCandidates');
    const outer = jest.fn();
    let n = 0;
    const generate = jest.fn(async (_r: LanguageModelRequest) => {
      n += 1;
      return providerSuccess({
        text: '',
        toolCalls: [
          {
            id: String(n),
            name:
              n === 1
                ? 'local-saved-recording-transcript'
                : 'local-personal-records',
            arguments: { query: 'synthetic transcript' },
          },
        ],
        finishReason: 'tool_calls' as const,
      });
    });
    const ragRunner = jest.fn(runRagConversationTurn);
    const send = createRagConversationService({
      consent: fake.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: outer },
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: journal,
      }),
      selectedAi: async () => ({
        ...fake.selected,
        provider: {
          ...fake.selected.provider,
          generate,
          capabilities: {
            ...fake.selected.provider.capabilities,
            toolCalling: true,
            streaming: false,
            structuredOutput: false,
          },
        },
      }),
      registry: new LocalEvidenceReferenceRegistry(),
      ragRunner,
    });
    await send('What did the chosen recording say?', [], controller.signal, {
      retentionSession: { id: 'synthetic-session', version: 0 },
      expectedConversationModel: {
        providerId: fake.selected.provider.id,
        modelId: fake.selected.modelId,
        isCurrent: () => account,
        isDurablyCurrent: async () => account,
      },
      retainedHistory: [
        { id: 'old-turn', question: 'SYNTHETIC_UNRELATED_HISTORY' },
      ],
      selectedRecordingTranscript: {
        sourceId: chosen,
        isCurrent: () => current,
      },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[2]).toMatchObject({
      selection: 'saved_recording_transcript',
      sourceIds: [chosen],
    });
    if (mode === 'generic-fallback')
      expect(generate.mock.calls.length).toBeGreaterThanOrEqual(2);
    else expect(generate).toHaveBeenCalledTimes(1);
    expect(journal).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(fake.search).not.toHaveBeenCalled();
    expect(fake.authorize.mock.calls[0]?.[0]?.recipient).toBe(
      fake.selected.recipient,
    );
    const [options] = ragRunner.mock.calls[0]!;
    expect(options.continuation).toBeUndefined();
    expect(options.previousMessages).toEqual([]);
    expect(options.workflow.tools.map(tool => tool.id)).toEqual([
      'local-saved-recording-transcript',
    ]);
    expect(JSON.stringify(generate.mock.calls)).not.toMatch(
      /foreign|SYNTHETIC_UNRELATED_HISTORY|selected revision/,
    );
  }, mode === 'generic-fallback'),
);
