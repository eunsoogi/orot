import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { useSyncExternalStore } from 'react';
import { act, render, within } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { createConversationVisitTurn } from '../../aiFeatures/integration/conversationVisitTurn';
import { defaultVisitQuestionRouteOperations } from '../../aiFeatures/integration/visitQuestionsRouteOperations';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from '../conversationHistoryPayload';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';

jest.mock('../../aiFeatures/integration/visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(async () => ({ id: 'synthetic-appointment' })),
    generate: jest.fn(),
  },
}));

const at = '2026-11-22T01:00:00.000Z';
const question = '다음 진료에서 물어볼 질문을 준비해 주세요.';
const opening = '질문을 함께 준비해 볼게요.';
const clarification = t('visitQuestions.conversation.clarifyGoal');
const warning = t('conversationInterruption.provider-failed');

function Transcript({ store }: { store: ConversationSessions }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = state.sessions.find(item => state.activeId === item.id)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      sessionId={session.id}
      pendingMessage={session.pendingMessage}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
}

/** The actual approved opening uses a non-streaming fixture; the visit operation returns a typed local decision. */
test('retains both visible clarification bubbles after SQLite reopen, without creating answer evidence or new model history', async () => {
  const path = mkdtempSync(join(tmpdir(), 'orot-visit-clarification-'));
  const file = join(path, 'conversation.sqlite');
  let db = openSqliteTestDatabase(file);
  let store: ConversationSessions | undefined;
  let mounted: Awaited<ReturnType<typeof render>> | undefined;
  const expectClarification = () => {
    const transcript = within(
      mounted!.getByTestId('conversation-message-container'),
    );
    expect(transcript.getByText(question)).toBeTruthy();
    const assistants = transcript.getAllByTestId(
      /^conversation-assistant-(?:opening-)?message$/,
    );
    expect(assistants).toHaveLength(2);
    const [openingRow, answerRow] = assistants;
    expect(within(openingRow!).getByText(opening)).toBeTruthy();
    expect(within(answerRow!).getByText(clarification)).toBeTruthy();
    expect(transcript.queryByText(warning)).toBeNull();
    expect(
      transcript.queryByText(t('aiActivity.draft.incompleteHeading')),
    ).toBeNull();
  };
  const strict = jest.fn(async () => {
    throw new Error('Display invoked strict history');
  });
  try {
    await runMigrations(db.database);
    const createStore = (
      storage: ReturnType<typeof createConversationArtifactStorage>,
    ) => {
      let id = 0;
      return createConversationSessions({
        retention: createConversationSessionRetention({
          openStorage: async () => storage,
          createId: () => `visit-${++id}`,
          now: () => at,
        }),
        restoreSession: strict,
        restoreSessionPage: strict,
        readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
          async () => storage,
        ),
      });
    };
    const storage = createConversationArtifactStorage(db.database);
    store = createStore(storage);
    const option = createAppleSelectionOption('available');
    const generate = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { text: opening, toolCalls: [], finishReason: 'complete' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { text: 'ALLOW', toolCalls: [], finishReason: 'complete' },
      });
    const provider = { ...option.provider, generate, stream: undefined };
    jest
      .mocked(defaultVisitQuestionRouteOperations.generate)
      .mockImplementation(async input => {
        await input.beforeResearch?.();
        return {
          status: 'needs_clarification',
          message: 'UNREVIEWED_MODEL_TEXT',
        };
      });
    const run = createConversationVisitTurn({
      loadLocalData: jest.fn(),
      registry: new LocalEvidenceReferenceRegistry(),
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: 'synthetic-appointment',
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      registerSource: jest.fn() as never,
    });
    mounted = await render(<Transcript store={store} />);
    await act(async () => {
      await store!.sendQuickPrompt(
        1,
        question,
        (prompt, _history, signal, observer) =>
          run({
            question: prompt,
            signal: signal!,
            observer,
            resolveSelectedAi: async () => ({
              status: 'ready',
              selection: { providerId: provider.id, modelId: option.modelId },
              provider,
              option: { ...option, provider },
              modelId: option.modelId,
              recipient: 'synthetic-on-device',
              remoteProcessing: false,
            }),
            confirmConsent: async () => false,
          }),
      );
    });
    expectClarification();
    const live = store.getSnapshot().sessions[0]!.messages;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(defaultVisitQuestionRouteOperations.generate).toHaveBeenCalledTimes(
      1,
    );
    const [owner] = (await storage.listSessions()).items;
    expect(owner).toBeDefined();
    await mounted.unmount();
    mounted = undefined;
    store.dispose();
    store = undefined;
    db.close();

    db = openSqliteTestDatabase(file);
    const reopened = createConversationArtifactStorage(db.database);
    await reopened.interruptRecoveredRequests();
    store = createStore(reopened);
    mounted = await render(<Transcript store={store} />);
    await act(async () => {
      await store!.attachExisting(owner!.id, owner!.version, at);
    });
    expectClarification();
    expect(mounted.queryByText('UNREVIEWED_MODEL_TEXT')).toBeNull();
    expect(conversationHistoryPayload(live, 'Unrelated next prompt')).toEqual(
      [],
    );
    expect(retainedHistoryTurns(live, 'Unrelated next prompt')).toEqual([]);
    expect(strict).not.toHaveBeenCalled();
    expect(await reopened.listCompletionIdentities()).toEqual([]);
    expect(
      await reopened.readProtectedPromptHistory(
        owner!.id,
        owner!.version,
        [],
        new AbortController().signal,
      ),
    ).toEqual([]);
    expect(
      (await db.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(2);
    await act(async () => {
      await reopened.deleteSession(owner!.id);
    });
    expect(
      (await db.database.execute('SELECT id FROM conversation_requests')).rows,
    ).toEqual([]);
  } finally {
    await mounted?.unmount();
    store?.dispose();
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});
