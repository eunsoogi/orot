import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { agentMemoryDatabaseFacade } from '../../storage/agentMemoryDatabaseFacade';
import { ArchivedPairedDetailsSurface } from '../ArchivedPairedDetailsSurface';
import { storePairedDetails } from '../archivedPairedDetailsLayout';
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

const title1 = '근거 예시 보기';
const title2 = '비교 방법 보기';
const detail1 = '첫 번째 예시 문장';
const detail2 = '두 번째 예시 문장';
const answer = ['요약', title1, detail1, title2, detail2].join('\n');
const id = 'archive-row';
const sessionId = 'archive-session';
const createdAt = '2026-11-26T02:00:00.000Z';

function archivedShape() {
  const text = (id: string, text: string) => ({ id, component: 'Text', text });
  const result = ragConversationTask.validateResult(
    {
      answer,
      answerKind: 'conversation',
      a2uiFrames: [
        JSON.stringify({
          version: '1.0',
          createSurface: {
            surfaceId: 'orot:response:draft',
            catalogId: conversationA2UICatalog,
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['intro', 'first', 'second'],
              },
              text('intro', '요약'),
              {
                id: 'first',
                component: 'Modal',
                trigger: 'title1',
                content: 'content1',
              },
              {
                id: 'second',
                component: 'Modal',
                trigger: 'title2',
                content: 'content2',
              },
              text('title1', title1),
              text('content1', detail1),
              text('title2', title2),
              text('content2', detail2),
            ],
          },
        }),
      ],
    },
    {
      request: '예시를 보여 줘.',
      evidence: { items: [], coverage: [], conflicts: [] },
    } as TaskResponderInput,
  );
  if (result.status !== 'valid' || !result.value.a2uiPresentation)
    throw new Error('Expected a locally admitted paired surface.');
  const archived = storePairedDetails(result.value.a2uiPresentation, answer);
  if (!archived) throw new Error('Expected version 8 shape.');
  return archived;
}

test.each([
  'open',
  'removed',
  'native lock',
  'stale facade',
  'visible delete',
  'replacement',
] as const)(
  'restores one exact archive-owned detail through the real storage reader: %s',
  async mode => {
    const f = await healthContextFixture();
    const stateListeners = new Set<() => void>();
    const nativeListeners = new Set<
      (event: ConversationExecutionEvent) => void
    >();
    const nativeProbe = jest.fn(async () => true);
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      begin: async () => false,
      end() {},
      isActive: async () => false,
      protectedDataAvailable: nativeProbe,
      subscribe(listener) {
        nativeListeners.add(listener);
        return () => {
          nativeListeners.delete(listener);
        };
      },
    });
    const subscribe = (listener: () => void) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    };
    const ownsRoute = Object.assign(() => true, {
      route: { isCurrent: () => true, subscribe },
    });
    try {
      const guarded = guardedNativeDatabase(f.database);
      const owner = agentMemoryDatabaseFacade(guarded);
      let active = owner;
      const reads = jest.spyOn(owner, 'execute');
      const storage = createConversationArtifactStorage(
        owner,
        database => database === active,
      );
      await storage.createSession(sessionId, await storage.currentGeneration());
      const original = {
        id,
        sessionId,
        createdAt,
        question: '예시를 보여 줘.',
        sessionVersion: 0,
      };
      await storage.startRequest(original);
      await storage.append({
        ...original,
        status: 'complete',
        answer,
        sources: [],
        citations: [],
        providerId: 'synthetic',
        modelId: 'synthetic',
        archivedA2UILayout: archivedShape(),
      });
      const read = conversationSavedHistoryDisplayOption(async () => storage);
      const selected = await read(sessionId, 0, new AbortController().signal);
      let stored = selected.rows[0];
      if (stored?.kind !== 'answer' || !stored.archivedA2UIPresentation)
        throw new Error('Protected v8 display is unavailable.');
      const root = stored.archivedA2UIPresentation;
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
        ownsActiveSession: () => true,
      } as unknown as ConversationSessions;
      const Harness = ({ archived = root }: { archived?: typeof root }) => {
        const owner = useConversationA2UILocalDraftOwner(store, 1, [
          ownsRoute,
          ownsRoute,
        ]);
        return (
          <ConversationA2UILocalDraftOwner.Provider value={owner}>
            <ArchivedPairedDetailsSurface root={archived} />
          </ConversationA2UILocalDraftOwner.Provider>
        );
      };
      const ui = await render(<Harness />);
      try {
        expect(nativeProbe).not.toHaveBeenCalled();
        expect(screen.queryByText(detail1)).toBeNull();
        if (mode === 'removed')
          await f.database.execute(
            'INSERT INTO conversation_deleted_artifacts (id) VALUES (?)',
            [id],
          );
        if (mode === 'stale facade')
          active = agentMemoryDatabaseFacade(guardedNativeDatabase(f.database));
        reads.mockClear();
        await fireEvent.press(screen.getByRole('button', { name: title2 }));
        if (mode === 'stale facade') {
          expect(reads).not.toHaveBeenCalled();
          expect(nativeProbe).not.toHaveBeenCalled();
        }
        if (mode === 'removed' || mode === 'stale facade') {
          expect(screen.queryByRole('button', { name: title2 })).toBeNull();
          expect(screen.getByText(detail1)).toBeTruthy();
          expect(screen.getByText(detail2)).toBeTruthy();
        } else {
          expect(screen.getByText(detail2)).toBeTruthy();
          expect(screen.queryByText(detail1)).toBeNull();
          if (mode === 'replacement') {
            stored = (await read(sessionId, 0, new AbortController().signal))
              .rows[0];
            if (stored?.kind !== 'answer' || !stored.archivedA2UIPresentation)
              throw new Error('Expected refreshed archive.');
            await ui.rerender(
              <Harness archived={stored.archivedA2UIPresentation} />,
            );
            expect(screen.queryByText(detail2)).toBeNull();
            await fireEvent.press(screen.getByRole('button', { name: title1 }));
            expect(screen.getByText(detail1)).toBeTruthy();
          }
          if (mode === 'visible delete') {
            await act(async () => {
              await guarded.execute(
                'DELETE FROM conversation_artifacts WHERE id = ?',
                [id],
              );
            });
            expect(screen.queryByText(detail2)).toBeNull();
            expect(nativeListeners.size).toBe(0);
          }
          if (mode === 'native lock') {
            await act(() => {
              for (const available of [false, true])
                [...nativeListeners].forEach(listener =>
                  listener({ kind: 'protectedData', available }),
                );
            });
            expect(screen.queryByText(detail2)).toBeNull();
          }
        }
      } finally {
        await ui.unmount();
        expect(nativeListeners.size).toBe(0);
      }
    } finally {
      await f.close();
    }
  },
);
