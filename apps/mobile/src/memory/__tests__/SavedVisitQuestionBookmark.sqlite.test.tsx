import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { createInlineVisitReview } from '../../nextVisitQuestions/inlineVisitReview';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  GeneratedReportBookmark,
  GeneratedReportBookmarkContext,
} from '../../ragConversation/GeneratedReportBookmark';
import { useConversationSessions } from '../../ragConversation/ConversationSessionsContext';
import { savedHistoryTranscript } from '../../ragConversation/conversationSavedHistoryDisplay';
import type { DisplayMessage } from '../../ragConversation/conversationDisplayMessage';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';
import type { SavedMemory } from '../unifiedSavedMemories';

jest.mock('../openSavedGeneratedReportReferences');
jest.mock('../../ragConversation/ConversationSessionsContext');
jest.mock('../../ragConversation/conversationExecutionNative');

const questionText = '생성한 합성 진료 질문';
const rationale = '이 질문의 합성 근거';
const current = () => true;
const artifactId = 'visit-artifact';

async function fixture() {
  const f = await setup();
  await f.repository.put('appointment', appointment);
  // The stored appointment reference matches the original repository revision rather than a UI draft.
  const original = (await f.repository.get('appointment', appointment.id))!;
  const revision = fingerprint(original);
  const reference = {
    ...f.personal.reference,
    sourceId: appointment.id,
    evidenceId: appointment.id,
    sourceRevision: revision,
    evidenceRevision: revision,
  };
  const generated = {
    identity: { id: 'generated' },
    questionText,
    rationale,
    priority: 'important' as const,
    citations: [],
  };
  const saved = {
    ...generated,
    identity: { id: 'editable', expectedRevision: 'later' },
    questionText: '편집된 목록의 다른 질문',
  };
  const value = await f.save(artifactId, {
    sources: [
      {
        reference,
        records: [{ kind: 'appointment', id: appointment.id, revision }],
      },
    ],
    visitQuestions: {
      appointmentId: appointment.id,
      source: reference,
      candidates: [generated],
    },
  });
  const message: DisplayMessage = {
    id: 1,
    role: 'assistant',
    content: value.answer,
    retainedTurnId: artifactId,
    visitQuestions: {
      appointment: original,
      review: createInlineVisitReview(
        'live',
        [saved],
        [generated],
        [],
        () => generated.identity.id,
      ),
      validateSource: async () => true,
    },
  };
  const model = { providerId: 'synthetic', modelId: 'test' };
  const store = {
    getSnapshot: () => ({
      activeId: 1,
      sessions: [{ id: 1, draft: '', draftEditRevision: 0, model }],
    }),
    subscribe: () => () => {},
    savedReportLease: () => ({ id: 'selected', version: 0 }),
  };
  jest
    .mocked(useConversationSessions)
    .mockReturnValue(
      store as unknown as ReturnType<typeof useConversationSessions>,
    );
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue(f.storage);
  return { ...f, original, value, message };
}

function makeNative() {
  type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
  type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];
  const listeners = new Set<(event: Event) => void>();
  const confirm = jest.fn().mockResolvedValue(true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: confirm,
    subscribe(next: (event: Event) => void) {
      listeners.add(next);
      return () => {
        listeners.delete(next);
      };
    },
  } as unknown as Native);
  return {
    confirm,
    lock: () =>
      listeners.forEach(next =>
        next({ kind: 'protectedData', available: false } as Event),
      ),
  };
}

test('only a displayed generated visit question can pin and reopen the typed original', async () => {
  const f = await fixture();
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  const native = makeNative();
  const bookmark = (message: DisplayMessage) => (
    <GeneratedReportBookmarkContext.Provider value={{ sessionId: 1 }}>
      <GeneratedReportBookmark message={message} />
    </GeneratedReportBookmarkContext.Provider>
  );
  // Existing metadata-only archive deliberately does not carry visit candidates or permission.
  const cold = savedHistoryTranscript(
    [
      {
        row: {
          kind: 'answer',
          id: artifactId,
          createdAt: f.value.createdAt,
          question: f.value.question,
          answer: f.value.answer,
        },
        questionId: 1,
        answerId: 2,
      },
    ],
    [],
  )[1]!;
  const view = await render(bookmark(cold));
  try {
    expect(
      screen.queryByTestId('conversation-bookmark-visit-questions'),
    ).toBeNull();
    expect(await f.storage.listSavedVisitQuestionReferences()).toEqual([]);
    await view.rerender(bookmark(f.message));
    await fireEvent.press(
      screen.getByTestId('conversation-bookmark-visit-questions'),
    );
    await waitFor(() =>
      expect(screen.getByText('보고서 링크를 기억에 보관했어요.')).toBeTruthy(),
    );
    const references = await f.storage.listSavedGeneratedReportReferences();
    expect(references).toEqual([
      {
        artifactId,
        reportKind: 'visit_questions',
        savedAt: expect.any(String),
      },
    ]);
    const pointer = (
      await f.db.execute('SELECT * FROM saved_visit_question_refs')
    ).rows[0];
    expect(Object.keys(pointer!).sort()).toEqual([
      'artifact_id',
      'revision',
      'saved_at',
    ]);
    const memoryId = 'generated-visit-questions:' + artifactId;
    const load = async (): Promise<SavedMemory[]> =>
      (await f.storage.listSavedGeneratedReportReferences()).map(row => ({
        sourceKind: 'saved_generated_report',
        id: memoryId,
        artifactId: row.artifactId,
        reportKind: row.reportKind,
        text: 'AI가 만든 진료 질문',
        createdAt: Date.parse(row.savedAt),
      }));
    await f.save('another-turn', {
      answer: 'An unrelated later transcript entry.',
    });
    await view.rerender(<SavedMemoryDetail memoryId={memoryId} load={load} />);
    expect(await screen.findByText(questionText)).toBeVisible();
    expect(screen.getByText(rationale)).toBeVisible();
    expect(screen.getByText('AI가 만든 진료 질문')).toBeVisible();
    expect(screen.queryByText('편집된 목록의 다른 질문')).toBeNull();
    expect(native.confirm).toHaveBeenCalledTimes(2);
    await act(() => native.lock());
    expect(screen.queryByText(questionText)).toBeNull();

    // Revoking the cited appointment hides both metadata and the exact original.
    await f.db.execute(
      'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
      [appointment.id],
    );
    expect(await f.storage.listSavedGeneratedReportReferences()).toEqual([]);
    expect(
      await f.storage.readSavedVisitQuestionReference(artifactId, current),
    ).toBeNull();
  } finally {
    await view.unmount();
    AppState.currentState = previous;
    f.close();
  }
});
