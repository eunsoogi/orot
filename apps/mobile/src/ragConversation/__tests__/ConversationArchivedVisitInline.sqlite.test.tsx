import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createNextVisitQuestionsTheme } from '../../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { ArchivedConversationVisitQuestions } from '../ArchivedConversationVisitQuestions';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { t } from '../../i18n';

jest.mock('../../memory/openSavedGeneratedReportReferences');
jest.mock('../conversationExecutionNative');
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { ConversationMessage } from '../ConversationMessage';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';

test.each(['valid', 'locked', 'replaced'] as const)(
  'the exact original Visit appears inline only while protected: %s',
  async mode => {
    const f = await setup();
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    try {
      await f.repository.put('appointment', appointment);
      const original = (await f.repository.get('appointment', appointment.id))!;
      const revision = fingerprint(original);
      const source = {
        ...f.personal.reference,
        sourceId: appointment.id,
        evidenceId: appointment.id,
        sourceRevision: revision,
        evidenceRevision: revision,
      };
      const archived = await f.save('archived-visit', {
        sources: [
          {
            reference: source,
            records: [{ kind: 'appointment', id: appointment.id, revision }],
          },
        ],
        visitQuestions: {
          appointmentId: appointment.id,
          source,
          candidates: [
            {
              identity: { id: 'synthetic-question' },
              questionText: 'Synthetic selected question',
              rationale: 'Synthetic retained reason',
              priority: 'important',
              citations: [],
            },
          ],
        },
      });
      const page = await conversationSavedHistoryDisplayOption(
        async () => f.storage,
      )('selected', 0, new AbortController().signal);
      const message = savedHistoryTranscript(
        page.rows.map((row, i) => ({
          row,
          questionId: i * 2 + 1,
          answerId: i * 2 + 2,
        })),
        [],
      ).find(row => row.role === 'assistant')!;
      expect(message.archivedVisitBookmark).toBeDefined();
      expect(JSON.stringify(page.rows)).not.toContain(
        'Synthetic selected question',
      );
      if (mode === 'replaced')
        await f.db.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [
            JSON.stringify({ ...archived, answer: 'Synthetic replacement' }),
            archived.id,
          ],
        );
      const listeners = new Set<(event: ConversationExecutionEvent) => void>();
      jest.mocked(conversationExecutionNative).mockReturnValue({
        bridgeAvailable: true,
        currentPhase: () => 'active',
        protectedDataAvailable: async () => mode !== 'locked',
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        begin: async () => true,
        end: () => {},
        isActive: async () => true,
      });
      const open = jest.mocked(openSavedGeneratedReportReferences);
      open.mockClear().mockResolvedValue(f.storage);
      const recover = jest.fn(async () => {
        throw new Error('No regen or full restore');
      });
      const store = createConversationSessions({
        retention: createConversationSessionRetention({
          openStorage: async () => f.storage,
          createId: () => 'other',
          now: () => archived.createdAt,
        }),
        readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
          async () => f.storage,
        ),
        restoreSession: recover,
        restoreSessionPage: recover,
      });
      await store.attachExisting('selected', 0, archived.createdAt);
      const sessionId = store.getSnapshot().activeId;
      const visible = () => true;
      const mounted = await render(
        <ConversationMessage
          message={message}
          onOpenSource={jest.fn()}
          onLinkError={jest.fn()}
          renderVisitQuestions={value => (
            <ArchivedConversationVisitQuestions
              message={value}
              store={store}
              sessionId={sessionId}
              visible={visible}
              theme={createNextVisitQuestionsTheme(false)}
            />
          )}
        />,
      );
      if (mode === 'valid') {
        expect(
          await screen.findByRole('header', {
            name: t('visitQuestions.inline.title'),
          }),
        ).toBeVisible();
        expect(screen.getByTestId('next-visit-question-0')).toBeTruthy();
        expect(screen.getByText('Synthetic selected question')).toBeVisible();
        expect(screen.getByText('Synthetic retained reason')).toBeVisible();
        await act(() => {
          for (const notify of [...listeners])
            notify({ kind: 'protectedData', available: false });
        });
        expect(screen.queryByText('Synthetic selected question')).toBeNull();
      } else {
        expect(screen.queryByText('Synthetic selected question')).toBeNull();
        if (mode === 'replaced')
          expect(screen.getByRole('alert')).toHaveTextContent(
            t('ragConversation.conversation.savedVisitQuestionsUnavailable'),
          );
        else expect(open).not.toHaveBeenCalled();
      }
      expect(screen.queryByTestId('inline-visit-save')).toBeNull();
      expect(
        screen.queryByTestId('conversation-preview-archived-visit-questions'),
      ).toBeNull();
      expect(await f.storage.listSavedVisitQuestionReferences()).toHaveLength(
        0,
      );
      expect(recover).not.toHaveBeenCalled();
      await mounted.unmount();
      expect(listeners.size).toBe(0);
    } finally {
      AppState.currentState = phase;
      f.close();
    }
  },
);
