import {
  assertObservedVoiceFixture,
  observedVoiceFixtureLines,
} from '../testSupport/observedVoiceCaptionFixture';
import { assertOrder } from '../testSupport/assertSyntheticTranscriptOrder';
import { useSyncExternalStore } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationQuickChoices } from '../ConversationQuickChoices';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSessions } from '../conversationSessions';
import { at } from '../testSupport/savedHistoryDisplayFixture';

jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ value: { name: '테스트 비서' } }),
}));

const durableId = 'synthetic-voice-history';
const callId = 'synthetic-completed-call';

function Transcript({ store }: { store: ConversationSessions }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = snapshot.sessions.find(row => row.id === snapshot.activeId)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      sessionId={session.id}
      pendingMessage={null}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      entryChoices={
        <ConversationQuickChoices>
          <Text>Synthetic choices</Text>
        </ConversationQuickChoices>
      }
    />
  );
}

const openConversation = (path: string) => {
  const connection = openSqliteTestDatabase(path);
  const storage = createConversationArtifactStorage(connection.database);
  const needsNoStrictRestore = jest.fn(async () => {
    throw new Error('Saved display must not hydrate voice or source material');
  });
  const store = createConversationSessions({
    retention: createConversationSessionRetention({
      openStorage: async () => storage,
      now: () => at(0),
      createId: () => {
        throw new Error('Existing voice history must keep its owner');
      },
    }),
    restoreSession: needsNoStrictRestore,
    restoreSessionPage: needsNoStrictRestore,
    readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
      async () => storage,
    ),
  });
  const append = async (id: string, answer: string, createdAt: string) => {
    const identity = {
      id,
      sessionId: durableId,
      sessionVersion: 0,
      question: 'Synthetic question ' + id,
      createdAt,
    };
    await storage.startRequest(identity);
    await storage.append({
      ...identity,
      answer,
      status: 'complete',
      providerId: 'synthetic',
      modelId: 'synthetic',
      sources: [],
      citations: [],
    });
  };
  return {
    connection,
    storage,
    store,
    append,
    needsNoStrictRestore,
    close() {
      store.dispose();
      connection.close();
    },
  };
};

test('same-owner completed voice duration belongs above the choices before and after a real storage reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-voice-history-'));
  const path = join(directory, 'conversation.sqlite');
  const first = openConversation(path);
  let closed = false;
  try {
    await runMigrations(first.connection.database);
    await first.storage.createSession(
      durableId,
      await first.storage.currentGeneration(),
    );
    await first.append('earlier', 'Synthetic earlier chat answer', at(0));
    const ui = await render(<Transcript store={first.store} />);
    try {
      await act(async () => {
        const id = await first.store.attachExisting(durableId, 0, at(0));
        const complete = first.store.captureVoiceEnd(id, callId)!;
        await complete({ callId, durationSeconds: 134 });
        await complete({ callId, durationSeconds: 134 });
      });
      expect(ui.getAllByTestId('conversation-voice-end-marker')).toHaveLength(
        1,
      );
      expect(ui.getByLabelText('음성 대화 종료, 2분 14초')).toBeTruthy();
      expect(first.needsNoStrictRestore).not.toHaveBeenCalled();
      const [receipt] = await first.storage.readTaskCards(durableId, 0);
      expect(receipt?.task).toEqual({
        kind: 'voice_end',
        durationSeconds: 134,
      });
      expect(
        first.store
          .getSnapshot()
          .sessions.find(row => row.id === first.store.getSnapshot().activeId)
          ?.messages,
      ).toEqual([]);
      assertOrder(
        JSON.stringify(ui.toJSON()),
        'Synthetic earlier chat answer',
        'conversation-voice-end-marker',
        'conversation-choices-divider',
      );
      await first.append(
        'later',
        'Synthetic later chat answer',
        new Date(Date.parse(receipt!.createdAt) + 1000).toISOString(),
      );
    } finally {
      await ui.unmount();
      first.close();
      closed = true;
    }

    const reopened = openConversation(path);
    const cold = await render(<Transcript store={reopened.store} />);
    try {
      await act(async () => {
        await reopened.store.attachExisting(durableId, 0, at(0));
      });
      assertOrder(
        JSON.stringify(cold.toJSON()),
        'Synthetic earlier chat answer',
        'conversation-voice-end-marker',
        'Synthetic later chat answer',
        'conversation-choices-divider',
      );
      expect(cold.getAllByTestId('conversation-voice-end-marker')).toHaveLength(
        1,
      );
      expect(cold.getByLabelText('음성 대화 종료, 2분 14초')).toBeTruthy();
      expect(reopened.needsNoStrictRestore).not.toHaveBeenCalled();
    } finally {
      await cold.unmount();
      reopened.close();
    }
  } finally {
    if (!closed) first.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('the actual restored duration marker reads only its exact local captions after an explicit tap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-voice-captions-'));
  const path = join(directory, 'conversation.sqlite');
  const first = openConversation(path);
  const live = 'live-18000000-1';
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    await runMigrations(first.connection.database);
    await first.storage.createSession(
      durableId,
      await first.storage.currentGeneration(),
    );
    const id = await first.store.attachExisting(durableId, 0, at(0));
    await first.store.captureVoiceEnd(id, live)?.(
      { callId: live, durationSeconds: 27 },
      {
        callId: live,
        status: 'observed_incomplete',
        lines: observedVoiceFixtureLines,
      },
      () => true,
    );
    await first.store.captureVoiceEnd(
      id,
      callId,
    )?.({ callId, durationSeconds: 13 });
  } finally {
    first.close();
  }

  const reopened = openConversation(path);
  const cold = await render(<Transcript store={reopened.store} />);
  try {
    await act(async () => {
      await reopened.store.attachExisting(durableId, 0, at(0));
    });
    expect(cold.getAllByTestId('conversation-voice-end-marker')).toHaveLength(
      2,
    );
    expect(cold.queryByText(/안녕하세요/)).toBeNull();
    expect(
      cold.getAllByRole('button', { name: '저장된 자막 보기' }),
    ).toHaveLength(1);
    await fireEvent.press(
      cold.getByRole('button', { name: '저장된 자막 보기' }),
    );
    await waitFor(() => expect(cold.getByText(/안녕하세요/)).toBeTruthy());
    assertObservedVoiceFixture(cold);
    expect(
      cold.getByText('통화 중 확인된 일부 자막입니다. 전체 전사는 아닙니다.'),
    ).toBeTruthy();
    await fireEvent.press(cold.getByRole('button', { name: '자막 닫기' }));
    expect(cold.queryByText(/안녕하세요/)).toBeNull();
    expect(reopened.needsNoStrictRestore).not.toHaveBeenCalled();
  } finally {
    AppState.currentState = previousAppState;
    await cold.unmount();
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
