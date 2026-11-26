import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { expectSelectedRecordsPossibility } from '../../generatedReports/testSupport/selectedConversationPossibilityFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import {
  conversationPossibilityBookmarkFixture as openFixture,
  expectConversationPossibilityBookmark,
} from '../testSupport/expectConversationPossibilityBookmark';
import { answer } from '../testSupport/structuredPossibilityReportFixture';
jest.mock('../../generatedReports/readers', () => {
  const actual = jest.requireActual<
    typeof import('../../generatedReports/readers')
  >('../../generatedReports/readers');
  // Select the real reader over this fixture's protected DB without requiring
  // Jest's VM to load the production lazy native-storage boundary.
  return {
    ...actual,
    openGeneratedReportReader: async () => {
      const {
        openLocalAgentMemoryDatabase,
        isCurrentLocalAgentMemoryDatabase,
      } = jest.requireMock<typeof import('../../storage/secureDatabase')>(
        '../../storage/secureDatabase',
      );
      return actual.createGeneratedReportReader(
        await openLocalAgentMemoryDatabase(),
        undefined,
        isCurrentLocalAgentMemoryDatabase,
      );
    },
  };
});
jest.mock('../conversationExecutionNative');
jest.mock('../../memory/openSavedGeneratedReportReferences');
jest.mock('../../storage/secureDatabase', () => ({
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: async () => ({
    listDeletedSourceReferenceIds: async () => [],
    get: async () => null,
    hasStoredRecordId: async () => true,
  }),
}));
test.each(['open', 'bookmark'] as const)(
  'mounted typed Possibilities admits an exact protected original to %s',
  async mode => {
    const file = mode === 'bookmark' ? await openFixture() : undefined;
    const f = file?.f ?? (await healthContextFixture());
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    let mounted: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const database = guardedNativeDatabase(f.database);
      const storage = createConversationArtifactStorage(
        database,
        candidate => candidate === database,
      );
      await storage.createSession(
        'selected',
        await storage.currentGeneration(),
      );
      const clock = '2026-10-05T00:00:00.000Z';
      const model = { providerId: 'sample', modelId: 'sample' };
      const canonical = fixture();
      canonical.generate.mockReset().mockResolvedValue(
        response({
          type: 'result',
          value: { answerKind: 'grounded', answer },
          citations: [f.item.evidenceId],
        }),
      );
      const chunk = f.registry.toSearchChunk(
        f.item,
        'synthetic local evidence',
        {
          status: 'unreviewed',
        },
      );
      const observed = jest.fn();
      mounted = await render(
        <ConversationSessionsProvider
          options={{
            continuousSession: async () => ({
              id: 'selected',
              version: 0,
              updatedAt: clock,
              model,
            }),
            retention: createConversationSessionRetention({
              openStorage: async () => storage,
              createId: () => 'synthetic-possibility-turn',
              now: () => clock,
            }),
            restoreSession: async () => [],
            restoreSessionPage: async () => ({
              turns: [],
              taskCards: [],
              nextCursor: null,
            }),
          }}
        >
          <ConversationScreen
            onBack={jest.fn()}
            onOpenSource={jest.fn()}
            onSend={async (question, _history, signal, observer) => {
              if (!signal || !observer?.onRetentionCandidate) {
                observed({ stage: 'mounted-owner-missing' });
                throw new Error(
                  'The mounted composer lost its retained owner.',
                );
              }
              const entry = {
                intent: 'possibilities',
                entryKey: 'synthetic-owned-possibility',
                typedPossibilityReport: true,
              } as const;
              const bridge = createConversationRetentionBridge({
                observer,
                signal,
                registry: f.registry,
                question,
                ...model,
                entryContext: entry,
              });
              const finished = await runRagConversationTurn(
                {
                  ...canonical.options,
                  question,
                  entryIntent: 'possibilities',
                  authoredCurrentRequest: true,
                  typedPossibilityReport: true,
                  loadCurrentEvidence: async () => ({
                    batch: {
                      items: [f.item],
                      coverage: [
                        {
                          sourceKind: 'personal_record',
                          searchedSourceIds: [f.item.sourceId],
                          returnedCount: 1,
                          resultLimit: 1,
                          gaps: [],
                          truncated: false,
                        },
                      ],
                      conflicts: [],
                    },
                    chunks: [chunk],
                  }),
                  rag: {
                    search: jest.fn(async () => [{ chunk, score: 1 }] as never),
                  },
                  resolveLocalEvidenceIdentity: reference =>
                    f.registry.resolve(reference),
                  onValidatedEvidence: bridge.onValidatedEvidence,
                  workflow: {
                    ...canonical.options.workflow,
                    revalidateEvidence: (references, abortSignal) =>
                      f.registry.revalidateEvidence(references, abortSignal),
                    execution: {
                      ...canonical.options.workflow.execution,
                      allowedScope: { sourceKinds: ['personal_record'] },
                    },
                  },
                },
                { signal },
              );
              const result = await bridge.finish(finished);
              observed({
                stage: 'finished',
                status: finished.status,
                ...(finished.status === 'failure'
                  ? { kind: finished.kind }
                  : {}),
                retained: result.retained,
              });
              return result.outcome;
            }}
          />
        </ConversationSessionsProvider>,
      );
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        '가능성과 추가 확인할 점을 정리해 주세요.',
      );
      await fireEvent(
        screen.getByTestId('rag-conversation-send'),
        'composerPress',
      );
      await waitFor(() => expect(observed).toHaveBeenCalledTimes(1));
      expect(observed).toHaveBeenCalledWith({
        stage: 'finished',
        status: 'answer',
        retained: true,
      });
      expect(await screen.findByText(answer.observations)).toBeTruthy();
      expect(canonical.generate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(canonical.generate.mock.calls)).not.toMatch(
        /possibilityOriginal|accepted-possibility-creation|fresh-possibility-execution/,
      );
      const rows = (await storage.list('selected')).items;
      expect(rows).toHaveLength(1);
      const saved = await storage.read(rows[0]!.id);
      expect(saved?.possibilityOriginal?.version).toBe(1);
      expect(JSON.stringify(saved?.possibilityOriginal)).not.toContain(
        answer.observations,
      );
      if (!saved) throw new Error('The typed original was not committed.');
      if (file) {
        await expectConversationPossibilityBookmark(
          database,
          f,
          saved,
          answer.observations,
          file.path,
          () => mounted!.unmount(),
        );
        mounted = undefined;
        expect(canonical.generate).toHaveBeenCalledTimes(1);
        return;
      }
      await mounted.unmount();
      mounted = undefined;
      await expectSelectedRecordsPossibility(
        database,
        storage,
        saved,
        f.inside.id,
        answer.observations,
      );
    } finally {
      await mounted?.unmount();
      AppState.currentState = previous;
      f.close();
      file?.clean();
    }
  },
);
