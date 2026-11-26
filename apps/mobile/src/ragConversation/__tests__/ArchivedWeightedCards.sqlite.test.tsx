import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { AppState, StyleSheet } from 'react-native';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { recoverArchiveLayout } from '../../storage/conversationArchiveA2UI';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { agentMemoryDatabaseFacade } from '../../storage/agentMemoryDatabaseFacade';
import { ConversationMessageText } from '../ConversationMessageText';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../ConversationA2UILocalDraftOwner';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeArchivedConversationWeightedCards } from '../archivedConversationWeightedCards';
import { conversationA2UICardWeight } from '../conversationA2UICardWeightTask';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { ConversationSessions } from '../conversationSessions';
import { ragConversationTask } from '../task';

jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 800, height: 844, scale: 3, fontScale: 1 }),
}));

const first = '중요한 항목';
const second = '짧은 참고';
const answer = [first, second].join('\n');
const question = '비교해서 보여 주세요.';
const row = {
  id: 'weighted-answer',
  sessionId: 'weighted-session',
  createdAt: '2026-11-26T03:00:00.000Z',
  sessionVersion: 0,
  question,
};

function liveRoot() {
  const result = ragConversationTask.validateResult(
    {
      answer,
      answerKind: 'conversation',
      a2uiFrames: [
        JSON.stringify({
          version: '1.0',
          createSurface: {
            catalogId: conversationA2UICatalog,
            surfaceId: 'orot:response:draft',
            components: [
              { id: 'root', component: 'Row', children: ['head', 'tail'] },
              { id: 'head', component: 'Card', child: 'first', weight: 3 },
              { id: 'first', component: 'Text', text: first },
              { id: 'tail', component: 'Card', child: 'second', weight: 1 },
              { id: 'second', component: 'Text', text: second },
            ],
          },
        }),
      ],
    },
    {
      request: question,
      context: [],
      evidence: { items: [], coverage: [], conflicts: [] },
    } as TaskResponderInput,
  );
  const root = result.status === 'valid' && result.value.a2uiPresentation;
  if (!root || root.component !== 'Row') throw new Error('Expected live row.');
  expect(root.children.map(conversationA2UICardWeight)).toEqual([3, 1]);
  return root;
}

test('reopens accepted weighted cards through current protected SQLite owner', async () => {
  const f = await healthContextFixture();
  const previousPhase = AppState.currentState;
  AppState.currentState = 'active';
  const events = new Set<(event: ConversationExecutionEvent) => void>();
  const native = jest.fn(async () => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => false,
    end() {},
    isActive: async () => false,
    protectedDataAvailable: native,
    subscribe(listener) {
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    },
  });
  const guarded = guardedNativeDatabase(f.database);
  const db = agentMemoryDatabaseFacade(guarded);
  const storage = createConversationArtifactStorage(db, owner => owner === db);
  try {
    await storage.createSession(
      row.sessionId,
      await storage.currentGeneration(),
    );
    await storage.startRequest(row);
    const retention = createConversationRetentionBridge({
      observer: {
        onRetentionCandidate: async candidate =>
          storage.append({ ...candidate, ...row, status: 'complete' }),
      },
      providerId: 'synthetic',
      modelId: 'synthetic',
      question,
      registry: new LocalEvidenceReferenceRegistry(),
      signal: new AbortController().signal,
    });
    retention.onValidatedEvidence([]);
    const retained = await retention.finish({
      status: 'answer',
      answer,
      citations: [],
      a2uiPresentation: liveRoot(),
    });
    expect(retained.retained).toBe(true);
    const read = conversationSavedHistoryDisplayOption(async () => storage);
    const stored = (await read(row.sessionId, 0, new AbortController().signal))
      .rows[0];
    if (
      stored?.kind !== 'answer' ||
      stored.archivedA2UIPresentation?.component !== 'Row'
    )
      throw new Error('Expected stored row layout.');
    expect(stored.answer).toBe(answer);
    const { archivedA2UIPresentation: root } = stored;
    expect(root.children.map(conversationA2UICardWeight)).toEqual([3, 1]);
    const subscribe = () => () => {};
    const route = Object.assign(() => true, {
      route: { isCurrent: () => true, subscribe },
    });
    const store = {
      subscribe,
      savedReportLease: () => ({ id: row.sessionId, version: 0 }),
      getSnapshot: () => ({
        activeId: 1,
        sessions: [
          {
            id: 1,
            draft: '',
            savedHistoryDisplay: [
              { row: stored, questionId: -1, answerId: -2 },
            ],
          },
        ],
      }),
    } as unknown as ConversationSessions;
    function Fixture() {
      const owner = useConversationA2UILocalDraftOwner(store, 1, [
        route,
        route,
      ]);
      return (
        <ConversationA2UILocalDraftOwner.Provider value={owner}>
          <ConversationMessageText
            content={answer}
            user={false}
            staticText
            verifiedA2UI={root}
          />
        </ConversationA2UILocalDraftOwner.Provider>
      );
    }
    const reads = jest.spyOn(db, 'execute');
    const transactions = jest.spyOn(db, 'transaction');
    const ui = await render(<Fixture />);
    try {
      const surface = await screen.findByTestId('conversation-a2ui-row');
      await fireEvent(surface, 'layout', {
        nativeEvent: { layout: { width: 800 } },
      });
      expect(screen.getByText(first)).toBeVisible();
      expect(screen.getByText(second)).toBeVisible();
      expect(
        screen
          .getByTestId('conversation-a2ui-row')
          .children.map(child =>
            typeof child === 'string'
              ? undefined
              : StyleSheet.flatten(child.props.style)?.flexGrow,
          ),
      ).toEqual([3, 1]);
      expect(native).toHaveBeenCalledTimes(1);
      expect(reads).not.toHaveBeenCalled();
      expect(transactions).not.toHaveBeenCalled();
      await act(async () => {
        await guarded.execute(
          'DELETE FROM conversation_artifacts WHERE id = ?',
          [row.id],
        );
      });
      expect(screen.queryByText(first)).toBeNull();
      expect(screen.queryByText(second)).toBeNull();
    } finally {
      await ui.unmount();
    }
  } finally {
    jest.mocked(conversationExecutionNative).mockReset();
    AppState.currentState = previousPhase;
    await f.close();
  }
});

test('the weighted overlay cannot widen the stored archive eligibility or bind a malformed slot', () => {
  const layout = storeArchivedConversationWeightedCards(liveRoot(), answer);
  expect(layout?.version).toBe(10);
  const value = {
    status: 'complete',
    answer,
    archivedA2UILayout: layout,
    citations: [],
    sources: [],
  };
  expect(recoverArchiveLayout(value)?.component).toBe('Row');
  for (const rejected of [
    { ...value, citations: undefined },
    { ...value, citations: [{}] },
    { ...value, sources: [{}] },
    { ...value, historicalDialogueParents: [{}] },
    { ...value, status: 'partial' },
    {
      ...value,
      archivedA2UILayout: {
        ...layout,
        weights: [
          [0, 3],
          [0, 1],
        ],
      },
    },
    { ...value, archivedA2UILayout: { ...layout, weights: [[2, 3]] } },
    { ...value, archivedA2UILayout: { ...layout, weights: [[0, 4]] } },
    { ...value, archivedA2UILayout: { ...layout, unknown: true } },
  ]) {
    expect(recoverArchiveLayout(rejected)).toBeUndefined();
    expect(rejected.answer).toBe(answer);
  }
});
