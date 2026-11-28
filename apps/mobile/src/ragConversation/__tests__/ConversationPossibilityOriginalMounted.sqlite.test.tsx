import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { expectSelectedRecordsPossibility } from '../../generatedReports/testSupport/selectedConversationPossibilityFixture';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { runRagConversationTurn } from '../service';
import {
  conversationPossibilityBookmarkFixture as openFixture,
  expectConversationPossibilityBookmark,
} from '../testSupport/expectConversationPossibilityBookmark';
import {
  canonicalPossibilityFixture,
  expectCommittedPossibilityFixture,
  possibilityFixtureModes,
  semanticPossibilityBookmarkFixture,
  submitPossibilityFixture,
} from '../testSupport/semanticPossibilityBookmarkFixture';
import {
  initializePossibilityBookmarkStorage,
  legacyPossibilityBookmarkObserver,
} from '../testSupport/legacyPossibilityBookmarkObserver';
import { answer } from '../testSupport/structuredPossibilityReportFixture';
const possibilitiesPrompt = '가능성과 추가 확인할 점을 정리해 주세요.';
jest.mock('../../generatedReports/readers', () => {
  const actual = jest.requireActual<
    typeof import('../../generatedReports/readers')
  >('../../generatedReports/readers');
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
test.each(possibilityFixtureModes)(
  'mounted typed Possibilities admits an exact protected original to %s',
  async mode => {
    const file = mode === 'bookmark' ? await openFixture() : undefined;
    const f = file?.f ?? (await healthContextFixture());
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    let mounted: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const database = guardedNativeDatabase(f.database);
      const storage = await initializePossibilityBookmarkStorage(database);
      const clock = '2026-10-05T00:00:00.000Z';
      const semantic = semanticPossibilityBookmarkFixture(
        mode,
        storage,
        f.database,
      );
      const model = semantic?.model ?? {
        providerId: 'sample',
        modelId: 'sample',
      };
      const canonical = canonicalPossibilityFixture(f.item.evidenceId);
      const chunk = f.registry.toSearchChunk(
        f.item,
        'synthetic local evidence',
        {
          status: 'unreviewed',
        },
      );
      const observed = jest.fn();
      let requestNumber = 0;
      const view = () => (
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
              createId: () => `synthetic-possibility-turn-${++requestNumber}`,
              now: () => clock,
            }),
            readSavedHistoryDisplay: semantic?.readSavedHistoryDisplay,
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
            onSend={async (question, history, signal, observer, context) => {
              if (semantic?.question === question)
                return semantic.send(
                  question,
                  history,
                  signal,
                  observer,
                  context,
                );
              if (!signal || !observer?.onRetentionCandidate)
                throw new Error('Missing retained owner.');
              const entry = {
                intent: 'possibilities',
                entryKey: 'synthetic-owned-possibility',
                typedPossibilityReport: true,
              } as const;
              const bridge = createConversationRetentionBridge({
                observer:
                  mode === 'semantic-untyped'
                    ? legacyPossibilityBookmarkObserver(observer)
                    : observer,
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
                    provider: {
                      ...canonical.options.workflow.provider,
                      id: model.providerId,
                    },
                    revalidateEvidence: (references, abortSignal) =>
                      f.registry.revalidateEvidence(references, abortSignal),
                    execution: {
                      ...canonical.options.workflow.execution,
                      ...model,
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
        </ConversationSessionsProvider>
      );
      mounted = await render(view());
      await submitPossibilityFixture(possibilitiesPrompt);
      const saved = await expectCommittedPossibilityFixture(
        observed,
        canonical.generate,
        storage,
        answer.observations,
        mode === 'semantic-untyped',
      );
      if (semantic)
        return await semantic
          .verify(saved, async () => {
            await mounted!.unmount();
            mounted = await render(view());
          })
          .finally(semantic.close);
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
