import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationSessionOptions } from '../../aiFeatures/integration/conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import {
  apple,
  localData,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import { t } from '../../i18n';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { ConversationScreenProps } from '../ConversationScreenProps';

jest.mock('../conversationExecutionNative');
const at = '2026-11-16T00:00:00.000Z';
const first = 'Synthetic already reviewed first reply';
const final = 'Synthetic committed final reply';
const oldQuestion = 'Synthetic prior authored question';
const previous = { providerId: 'synthetic-old-plan', modelId: 'previous' };
const current = { providerId: apple.provider.id, modelId: apple.modelId };

const route = Object.assign(() => true, {
  route: { isCurrent: () => true, subscribe: () => () => {} },
});

test.each([
  'hide',
  'delete',
  'clear',
  'guarded delete',
  'revoke and recover',
] as const)(
  'only displays the prior owner through a cold model rollover, then retires it on %s',
  async action => {
    const dir = mkdtempSync(join(tmpdir(), 'orot-prior-mounted-'));
    const path = join(dir, 'synthetic.sqlite');
    let connection = openSqliteTestDatabase(path);
    let view: Awaited<ReturnType<typeof render>> | undefined;
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const listeners = new Set<(event: ConversationExecutionEvent) => void>();
    let unlocked = true;
    const protect = (available: boolean) => {
      unlocked = available;
      listeners.forEach(listener =>
        listener({ kind: 'protectedData', available }),
      );
    };
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      protectedDataAvailable: async () => unlocked,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      begin: async () => true,
      isActive: async () => true,
      end: () => {},
    });
    try {
      const signal = new AbortController().signal;
      await runMigrations(connection.database);
      const oldStorage = createConversationArtifactStorage(connection.database);
      const original = await oldStorage.continuousSession(
        previous,
        'prior',
        at,
        signal,
      );
      const request = {
        id: 'prior-turn',
        sessionId: original.id,
        sessionVersion: original.version,
        question: oldQuestion,
        createdAt: at,
      };
      await oldStorage.startRequest(request);
      await oldStorage.writeReviewedOpening({
        ...request,
        version: original.version,
        opening: { callId: 'approved', text: first },
        current: () => true,
        signal,
      });
      await oldStorage.append({
        ...request,
        ...previous,
        status: 'complete',
        answer: final,
        sources: [],
      });
      const chosen = await oldStorage.continuousSession(
        current,
        'new-owner',
        at,
        signal,
      );
      connection.close();

      connection = openSqliteTestDatabase(path);
      const database = guardedNativeDatabase(connection.database);
      const storage = createConversationArtifactStorage(
        database,
        owner => owner === database,
      );
      const model = jest.fn(async () => ({
        status: 'ready' as const,
        selection: current,
        provider: apple.provider,
        modelId: apple.modelId,
        option: apple,
        recipient: 'Synthetic device',
        remoteProcessing: false,
      }));
      const options = createConversationSessionOptions({
        loadLocalData: async () => ({
          ...localData([]).data,
          openConversationArtifactStorage: async () => storage,
        }),
        selectedAi: model,
        registry: new LocalEvidenceReferenceRegistry(),
      });
      const send = jest.fn(
        async (...args: Parameters<ConversationScreenProps['onSend']>) => {
          expect(args[0]).toBe('Synthetic newly authored request');
          expect(args[3]?.retentionSession?.id).toBe(chosen.id);
          expect(
            JSON.stringify([args[1], args[3]?.retainedHistory]),
          ).not.toMatch(
            /previous|prior-turn|already reviewed|committed final|prior authored/,
          );
          return {
            status: 'answer' as const,
            answer: 'Synthetic new reply',
            citations: [],
          };
        },
      );
      const openSource = jest.fn();
      view = await render(
        <ConversationSessionsProvider options={options}>
          <ConversationScreen
            isEntryCurrent={route}
            onBack={jest.fn()}
            onOpenSource={openSource}
            onSend={send}
          />
        </ConversationSessionsProvider>,
      );
      expect(await screen.findByText(first)).toBeTruthy();
      expect(screen.getAllByText(first)).toHaveLength(1);
      expect(screen.getAllByText(final)).toHaveLength(1);
      expect(
        screen.getByText(t('ragConversation.history.previousConversation')),
      ).toBeTruthy();
      const mounted = JSON.stringify(view.toJSON());
      expect(mounted.indexOf(first)).toBeLessThan(mounted.indexOf(final));
      for (const oldText of [oldQuestion, first, final])
        expect(mounted).not.toContain(`"copyText":"${oldText}"`);
      expect(
        screen.queryByTestId('conversation-reviewed-opening-a2ui'),
      ).toBeNull();
      expect(send).not.toHaveBeenCalled();
      expect(
        await storage.readProtectedPromptHistory(
          chosen.id,
          chosen.version,
          [],
          signal,
        ),
      ).toEqual([]);

      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        'Synthetic newly authored request',
      );
      const actionButton = screen.getByTestId('rag-conversation-send');
      if (actionButton.props.onComposerPress)
        await fireEvent(actionButton, 'composerPress');
      else await fireEvent.press(actionButton);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Synthetic new reply')).toBeTruthy();
      expect(openSource).not.toHaveBeenCalled();

      if (action === 'guarded delete') {
        const previousFirst = screen.getByText(first);
        await act(async () => {
          await database.execute(
            'INSERT INTO conversation_artifact_sessions (id, generation) VALUES (?, ?)',
            ['unrelated-write', await storage.currentGeneration()],
          );
        });
        expect(screen.getByText(first)).toBe(previousFirst);
        expect(screen.getByText(final)).toBeVisible();
      }
      await act(async () => {
        if (action === 'guarded delete')
          await database.execute(
            'DELETE FROM conversation_artifact_sessions WHERE id = ?',
            [original.id],
          );
        if (action === 'revoke and recover') protect(false);
        if (action === 'hide')
          await storage.hideSession(original.id, original.version);
        if (action === 'delete') await storage.deleteSession(original.id);
        if (action === 'clear') {
          await createRecordRepository(database).deleteAllLocalData();
          notifyLocalDataCleared();
        }
      });
      await waitFor(() => {
        expect(screen.queryByText(first)).toBeNull();
        expect(screen.queryByText(final)).toBeNull();
      });
      if (action === 'revoke and recover') {
        await act(() => protect(true));
        expect(await screen.findByText(first)).toBeVisible();
        expect(screen.getByText(final)).toBeVisible();
      }
    } finally {
      await view?.unmount();
      expect(listeners.size).toBe(0);
      AppState.currentState = appState;
      connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
