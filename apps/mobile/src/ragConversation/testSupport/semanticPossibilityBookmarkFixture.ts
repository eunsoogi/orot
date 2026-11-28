import {
  markPossibilityProofOutput,
  possibilityBookmarkSelectedModel,
  syntheticNoPossibilityOriginal,
} from './possibilityBookmarkSelectedModel';
import { fixture, response } from './conversationEnvelopeFixtures';
import { answer } from './structuredPossibilityReportFixture';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import type { SqlDatabase } from '@orot/storage';
import { t } from '../../i18n';
import {
  apple,
  localData,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createRagConversationService } from '../../aiFeatures/integration/ragConversationService';
import type { ConversationArtifact } from '../../storage/conversationArtifactTypes';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { conversationExecutionNative } from '../conversationExecutionNative';
import { runRagConversationTurn } from '../service';
export const possibilityFixtureModes = [
  'open',
  'bookmark',
  'semantic',
  'semantic-cold',
  'semantic-untyped',
  'semantic-no-selection-proof',
  'semantic-stale-selection',
] as const;
export function semanticPossibilityBookmarkFixture(
  mode: (typeof possibilityFixtureModes)[number],
  storage: ReturnType<typeof createConversationArtifactStorage>,
  database: SqlDatabase,
) {
  if (mode === 'open' || mode === 'bookmark') return;
  const rejected =
    mode === 'semantic-untyped' || mode === 'semantic-no-selection-proof';
  const retired = mode === 'semantic-stale-selection';
  const fallback = 'Synthetic no eligible original';
  const execute = database.transaction.bind(database);
  let idle = Promise.resolve();
  database.transaction = work => {
    const pending = idle.then(() => execute(work));
    idle = pending.catch(() => {});
    return pending;
  };
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => false,
    end: () => {},
    isActive: async () => false,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  });
  const reopen = jest.fn(storage.readBookmarkedConversationPossibility);
  const write = jest.fn(storage.bookmarkConversationPossibility);
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue({
    ...storage,
    bookmarkConversationPossibility: write,
    readBookmarkedConversationPossibility: reopen,
  });
  const name = 'remember-possibilities-report';
  const question =
    'Could you keep the preceding possibilities report for next time?';
  const proof = markPossibilityProofOutput(storage);
  const generate = jest.fn(async (call: LanguageModelRequest) => {
    proof.expectNoMarker(call);
    if (rejected) {
      expect(call.tools?.find(tool => tool.name === name)).toBeUndefined();
      return syntheticNoPossibilityOriginal(fallback);
    }
    expect(call.tools?.find(tool => tool.name === name)).toBeDefined();
    return providerSuccess({
      text: 'Untrusted provider prose.',
      finishReason: 'tool_calls' as const,
      toolCalls: [
        {
          id: 'selection',
          name,
          arguments: { target: 'preceding_possibilities_report' },
        },
      ],
    });
  });
  const model = { providerId: apple.provider.id, modelId: apple.modelId };
  const provider = {
    ...apple.provider,
    generate,
    capabilities: {
      ...apple.provider.capabilities,
      streaming: false,
      toolCalling: true,
    },
  };
  const selected = possibilityBookmarkSelectedModel(
    { ...apple, provider },
    mode,
  );
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const confirmHistorySave = jest.fn(selected.confirm);
  const search = jest.fn();
  const run = createRagConversationService({
    selectedAi: selected.resolve,
    consent,
    queryConsent: consent,
    externalEvidence: { search },
    registry: new LocalEvidenceReferenceRegistry(),
    loadLocalData: async () => ({
      ...localData([]).data,
      openConversationArtifactStorage: async () => proof.probe,
    }),
    createOperationRunId: () => 'synthetic-semantic-possibility',
    ragRunner: runRagConversationTurn,
  });
  const observed = jest.fn();
  const send: ConversationScreenProps['onSend'] = async (
    text,
    history,
    signal,
    observer,
    context,
  ) => {
    const out = await run(
      text,
      history,
      signal,
      { ...observer, confirmHistorySave, suppressContextualOpening: true },
      context,
    );
    observed(out);
    return out;
  };
  return {
    question,
    model,
    readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
      async () => storage,
    ),
    send,
    close: selected.close,
    async verify(saved: ConversationArtifact, remount: () => Promise<void>) {
      if (mode !== 'semantic') {
        await remount();
        expect(await screen.findByText(answer.observations)).toBeTruthy();
      }
      await submitPossibilityFixture(question);
      if (rejected || retired) {
        await waitFor(() => expect(observed).toHaveBeenCalledTimes(1));
        const action = generate.mock.calls[0]?.[0].tools?.find(
          tool => tool.name === name,
        );
        expect(Boolean(action)).toBe(retired);
        expect(
          screen.queryByText(t('savedMemory.generatedReportSaved')),
        ).toBeNull();
        expect(generate).toHaveBeenCalledTimes(1);
        expect(confirmHistorySave).toHaveBeenCalledTimes(retired ? 1 : 0);
        expect(write).not.toHaveBeenCalled();
        expect(reopen).not.toHaveBeenCalled();
        expect(await storage.listBookmarkedConversationPossibilities()).toEqual(
          [],
        );
        return;
      }
      await waitFor(() =>
        expect(observed).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'answer',
            committedAnswerMemory: true,
          }),
        ),
      );
      expect(generate).toHaveBeenCalledTimes(1);
      expect(confirmHistorySave).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: saved.id,
          createdAt: saved.createdAt,
        }),
      );
      expect(reopen).toHaveBeenCalledWith(saved.id, expect.any(Object));
      expect(
        await storage.listBookmarkedConversationPossibilities(),
      ).toMatchObject([{ artifactId: saved.id }]);
      expect(search).not.toHaveBeenCalled();
      expect(
        await screen.findByText(t('savedMemory.generatedReportSaved')),
      ).toBeTruthy();
      expect(screen.queryByText('Untrusted provider prose.')).toBeNull();
    },
  };
}
export async function expectCommittedPossibilityFixture(
  observed: jest.Mock,
  generate: jest.Mock,
  storage: ReturnType<typeof createConversationArtifactStorage>,
  body: string,
  legacy = false,
) {
  await waitFor(() => expect(observed).toHaveBeenCalledTimes(1));
  expect(observed).toHaveBeenCalledWith({
    stage: 'finished',
    status: 'answer',
    retained: true,
  });
  expect(await screen.findByText(body)).toBeTruthy();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(generate.mock.calls)).not.toMatch(
    /possibilityOriginal|accepted-possibility-creation|fresh-possibility-execution/,
  );
  const rows = (await storage.list('selected')).items;
  expect(rows).toHaveLength(1);
  const saved = await storage.read(rows[0]!.id);
  expect(saved?.possibilityOriginal?.version).toBe(legacy ? undefined : 1);
  if (!legacy)
    expect(JSON.stringify(saved?.possibilityOriginal)).not.toContain(body);
  if (!saved) throw new Error('The typed original was not committed.');
  return saved;
}
export async function submitPossibilityFixture(question: string) {
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    question,
  );
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
}
/** Each mount uses the same typed envelope, not a fabricated retained stamp. */
export function canonicalPossibilityFixture(evidenceId: string) {
  const canonical = fixture();
  canonical.generate.mockReset().mockResolvedValue(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer },
      citations: [evidenceId],
    }),
  );
  return canonical;
}
