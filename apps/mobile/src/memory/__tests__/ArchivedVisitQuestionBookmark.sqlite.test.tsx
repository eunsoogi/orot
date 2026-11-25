import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  GeneratedReportBookmark,
  GeneratedReportBookmarkContext,
} from '../../ragConversation/GeneratedReportBookmark';
import { useConversationSessions } from '../../ragConversation/ConversationSessionsContext';
import { savedHistoryTranscript } from '../../ragConversation/conversationSavedHistoryDisplay';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';

jest.mock('../openSavedGeneratedReportReferences');
jest.mock('../../ragConversation/ConversationSessionsContext');
jest.mock('../../ragConversation/conversationExecutionNative');

const originalText = '저장된 합성 생성 질문';
const replacementText = '원본이 아닌 교체 질문';
const reason = '저장된 합성 근거';
const artifactId = 'selected-archived-visit';
const previewButton = 'conversation-preview-archived-visit-questions';
const saveButton = 'conversation-save-archived-visit-questions';

test.each([
  'save',
  'before-open-lock',
  'visible-lock',
  'route',
  'replace',
] as const)(
  'cold Visit bookmark requires a fresh, explicitly viewed immutable preview: %s',
  async mode => {
    const f = await setup();
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    try {
      await f.repository.put('appointment', appointment);
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
        questionText: originalText,
        rationale: reason,
        priority: 'important' as const,
        citations: [],
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
      const abort = new AbortController();
      const page = await conversationSavedHistoryDisplayOption(
        async () => f.storage,
      )('selected', 0, abort.signal);
      expect(JSON.stringify(page.rows)).not.toContain(originalText);
      const message = savedHistoryTranscript(
        page.rows.map((row, i) => ({
          row,
          questionId: i * 2 + 1,
          answerId: i * 2 + 2,
        })),
        [],
      ).find(
        row =>
          row.role === 'assistant' && row.voiceTimelineOrder?.id === artifactId,
      )!;
      expect(message.archivedVisitBookmark).toBeDefined();
      expect(message.visitQuestions).toBeUndefined();
      type Native = NonNullable<ReturnType<typeof conversationExecutionNative>>;
      type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];
      const nativeListeners = new Set<(event: Event) => void>();
      const visibility = new Set<(visible: boolean) => void>();
      const confirm = jest.fn().mockResolvedValue(mode !== 'before-open-lock');
      jest.mocked(conversationExecutionNative).mockReturnValue({
        bridgeAvailable: true,
        currentPhase: () => 'active',
        protectedDataAvailable: confirm,
        subscribe(cb: (event: Event) => void) {
          nativeListeners.add(cb);
          return () => {
            nativeListeners.delete(cb);
          };
        },
      } as unknown as Native);
      jest.mocked(useConversationSessions).mockReturnValue({
        getSnapshot: () => ({
          activeId: 1,
          sessions: [{ id: 1, draft: '', draftEditRevision: 0 }],
        }),
        subscribe: () => () => {},
        savedReportLease: () => ({ id: 'selected', version: 0 }),
      } as unknown as ReturnType<typeof useConversationSessions>);
      const open = jest.mocked(openSavedGeneratedReportReferences);
      open.mockClear().mockResolvedValue(f.storage);
      const route = Object.assign(() => true, {
        subscribeRoot(cb: (visible: boolean) => void) {
          visibility.add(cb);
          return () => {
            visibility.delete(cb);
          };
        },
      });
      const pinCount = async () =>
        (await f.storage.listSavedVisitQuestionReferences()).length;
      const view = await render(
        <GeneratedReportBookmarkContext.Provider
          value={{ sessionId: 1, isCurrent: route }}
        >
          <GeneratedReportBookmark message={message} />
        </GeneratedReportBookmarkContext.Provider>,
      );
      try {
        expect(open).not.toHaveBeenCalled();
        expect(screen.queryByText(originalText)).toBeNull();
        expect(screen.queryByTestId(saveButton)).toBeNull();
        await act(async () => {
          await fireEvent.press(screen.getByTestId(previewButton));
        });
        expect(await pinCount()).toBe(0);
        if (mode === 'before-open-lock') {
          expect(open).not.toHaveBeenCalled();
          expect(screen.queryByTestId(saveButton)).toBeNull();
          return;
        }
        expect(await screen.findByText(originalText)).toBeVisible();
        expect(screen.getByText(reason)).toBeVisible();
        if (mode === 'visible-lock' || mode === 'route') {
          const stalePress = screen.UNSAFE_getByType(AppButton).props.onPress;
          await act(() => {
            if (mode === 'route')
              visibility.forEach(cb => {
                cb(false);
                cb(true);
              });
            else
              nativeListeners.forEach(cb =>
                cb({ kind: 'protectedData', available: false } as Event),
              );
          });
          expect(screen.queryByText(originalText)).toBeNull();
          await act(async () => {
            await stalePress();
          });
          expect(await pinCount()).toBe(0);
          return;
        }
        if (mode === 'replace')
          await f.db.execute(
            'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
            [
              JSON.stringify({
                ...value,
                visitQuestions: {
                  ...value.visitQuestions!,
                  candidates: [{ ...generated, questionText: replacementText }],
                },
              }),
              artifactId,
            ],
          );
        await act(async () => {
          await fireEvent.press(screen.getByTestId(saveButton));
        });
        if (mode === 'save') {
          expect(
            await screen.findByText('보고서 링크를 기억에 보관했어요.'),
          ).toBeVisible();
          expect(await pinCount()).toBe(1);
          expect(
            await f.storage.readSavedVisitQuestionReference(
              artifactId,
              () => true,
            ),
          ).toEqual([
            {
              id: generated.identity.id,
              questionText: originalText,
              rationale: reason,
            },
          ]);
        } else {
          expect(
            await screen.findByText('원본 보고서를 확인할 수 없어요.'),
          ).toBeVisible();
          expect(await pinCount()).toBe(0);
        }
      } finally {
        await view.unmount();
      }
    } finally {
      AppState.currentState = previous;
      f.close();
    }
  },
);
