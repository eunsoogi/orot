import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { AppState } from 'react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { agentMemoryDatabaseFacade } from '../../storage/agentMemoryDatabaseFacade';
import { storeArchivedConversationRichText } from '../archivedConversationRichTextLayout';
import { ConversationMessageText } from '../ConversationMessageText';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { conversationA2UICatalog } from '../conversationA2UI';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { ConversationSessions } from '../conversationSessions';
import { ragConversationTask } from '../task';
jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const firstTitle = '개요';
const secondTitle = '비교';
const firstLine = '첫 **강조** 예시';
const secondLine = '둘째 *관점* 예시';
const text = [firstTitle, firstLine, secondTitle, secondLine].join('\n');
const sessionId = 'rich-archive';
const id = 'archive-rich-reply';
const createdAt = '2026-11-26T03:00:00.000Z';
const question = '짧은 예시를 보여 줘.';
function shape() {
  const validated = ragConversationTask.validateResult(
    {
      answer: text,
      answerKind: 'conversation',
      a2uiFrames: [
        JSON.stringify({
          version: '1.0',
          createSurface: {
            catalogId: conversationA2UICatalog,
            surfaceId: 'orot:response:draft',
            components: [
              {
                id: 'root',
                component: 'Tabs',
                tabs: [
                  { title: firstTitle, child: 'first-card' },
                  { title: secondTitle, child: 'second' },
                ],
              },
              { id: 'first-card', component: 'Card', child: 'first' },
              { id: 'first', component: 'Text', text: firstLine },
              { id: 'second', component: 'Text', text: secondLine },
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
  if (validated.status !== 'valid' || !validated.value.a2uiPresentation)
    throw new Error('Expected validated v40 native content.');
  const layout = storeArchivedConversationRichText(
    validated.value.a2uiPresentation,
    text,
  );
  if (!layout) throw new Error('Expected local v9 shape.');
  return layout;
}
test.each([
  'native lost',
  'delete',
  'already deleted',
  'delete while native read is held',
  'unknown native',
] as const)(
  'uses the current protected archive reader without an additional SELECT: %s',
  async mode => {
    const f = await healthContextFixture();
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const events = new Set<(event: ConversationExecutionEvent) => void>();
    const native = jest.fn(async () => true);
    jest.mocked(conversationExecutionNative).mockReturnValue(
      mode === 'unknown native'
        ? null
        : {
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
          },
    );
    const guarded = guardedNativeDatabase(f.database);
    const connection = agentMemoryDatabaseFacade(guarded);
    const storage = createConversationArtifactStorage(
      connection,
      owner => owner === connection,
    );
    try {
      await storage.createSession(sessionId, await storage.currentGeneration());
      const row = { id, sessionId, createdAt, question, sessionVersion: 0 };
      await storage.startRequest(row);
      const layout = shape();
      expect(layout).toEqual({ version: 9, tree: ['Tabs', ['Card', 1], 1] });
      await storage.append({
        ...row,
        status: 'complete',
        answer: text,
        sources: [],
        citations: [],
        providerId: 'synthetic',
        modelId: 'synthetic',
        archivedA2UILayout: layout,
      });
      const remove = () =>
        guarded.execute('DELETE FROM conversation_artifacts WHERE id = ?', [
          id,
        ]);
      if (mode === 'already deleted') await remove();
      const read = conversationSavedHistoryDisplayOption(async () => storage);
      const stored = (await read(sessionId, 0, new AbortController().signal))
        .rows[0];
      if (mode === 'already deleted') {
        expect(
          stored?.kind === 'answer' && stored.archivedA2UIPresentation,
        ).toBeFalsy();
        expect(native).not.toHaveBeenCalled();
        return;
      }
      if (stored?.kind !== 'answer' || !stored.archivedA2UIPresentation)
        throw new Error('Expected currently owned native layout.');
      const { archivedA2UIPresentation: root } = stored;
      const subscribe = () => () => {};
      const route = Object.assign(() => true, {
        route: { isCurrent: () => true, subscribe },
      });
      const store = {
        subscribe,
        savedReportLease: () => ({ id: sessionId, version: 0 }),
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
              allowReport
              content={text}
              user={false}
              verifiedA2UI={root}
            />
          </ConversationA2UILocalDraftOwner.Provider>
        );
      }
      const reads = jest.spyOn(connection, 'execute');
      const transactions = jest.spyOn(connection, 'transaction');
      let allowNative: (ok: boolean) => void = () => {};
      if (mode === 'delete while native read is held') {
        native.mockImplementationOnce(
          () =>
            new Promise(resolve => {
              allowNative = resolve;
            }),
        );
      }
      const ui = await render(<Fixture />);
      try {
        if (mode === 'delete while native read is held') {
          await waitFor(() => expect(native).toHaveBeenCalledTimes(1));
          expect(screen.queryByRole('tab')).toBeNull();
          await act(async () => {
            await remove();
            allowNative(true);
          });
          expect(screen.queryByRole('tab')).toBeNull();
          expect(screen.queryByText('강조')).toBeNull();
          return;
        }
        if (mode === 'unknown native') {
          expect(screen.queryByText('강조')).toBeNull();
          return;
        }
        expect(await screen.findByText('강조')).toHaveStyle({
          fontWeight: '700',
        });
        const second = screen.getByRole('tab', { name: secondTitle });
        const tabs = screen.getAllByRole('tab');
        expect(tabs[0]).toBe(screen.getByRole('tab', { name: firstTitle }));
        expect(tabs[1]).toBe(second);
        expect(screen.queryByText('관점')).toBeNull();
        await fireEvent.press(second);
        expect(screen.queryByText('강조')).toBeNull();
        expect(screen.getByText('관점')).toHaveStyle({ fontStyle: 'italic' });
        await act(async () => {
          if (mode === 'delete') await remove();
          else
            for (const available of [false, true])
              [...events].forEach(listener =>
                listener({ kind: 'protectedData', available }),
              );
        });
        expect(screen.queryByText('관점')).toBeNull();
        expect(screen.queryByRole('tab')).toBeNull();
        expect(events.size).toBe(0);
      } finally {
        allowNative(false);
        await ui.unmount();
        expect(reads).not.toHaveBeenCalled();
        expect(transactions).not.toHaveBeenCalled();
      }
    } finally {
      await f.close();
      AppState.currentState = appState;
    }
  },
);
