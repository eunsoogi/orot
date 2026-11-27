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

export function semanticPossibilityBookmarkFixture(
  mode: 'open' | 'bookmark' | 'semantic',
  storage: ReturnType<typeof createConversationArtifactStorage>,
  database: SqlDatabase,
) {
  if (mode !== 'semantic') return;
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
  const generate = jest.fn(async (call: LanguageModelRequest) => {
    expect(call.tools?.find(tool => tool.name === name)).toBeDefined();
    expect(JSON.stringify(call)).not.toContain('synthetic-possibility-turn-1');
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
  const selectedAi = async () => ({
    status: 'ready' as const,
    selection: model,
    option: { ...apple, provider },
    provider,
    modelId: model.modelId,
    recipient: 'Synthetic device',
    remoteProcessing: false,
  });
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const confirmHistorySave = jest.fn(async () => true);
  const search = jest.fn();
  const run = createRagConversationService({
    selectedAi,
    consent,
    queryConsent: consent,
    externalEvidence: { search },
    registry: new LocalEvidenceReferenceRegistry(),
    loadLocalData: async () => ({
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
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
    async verify(saved: ConversationArtifact) {
      await submitPossibilityFixture(question);
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
  expect(saved?.possibilityOriginal?.version).toBe(1);
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
