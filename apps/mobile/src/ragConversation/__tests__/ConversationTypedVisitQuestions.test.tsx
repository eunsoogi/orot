import { fireEvent, render, screen } from '@testing-library/react-native';
import { startConversationReportTurn } from '../startConversationReportTurn';
import { conversationEntryForSession } from '../useConversationEntryIntent';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { setup } from '../testSupport/continuousSessionFixture';
import { conversationChoiceActions } from '../selectConversationChoice';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import { defaultVisitQuestionRouteOperations } from '../../aiFeatures/integration/visitQuestionsRouteOperations';
import { ConversationVisitQuestionCard } from '../../aiFeatures/integration/ConversationVisitQuestionCard';
import { createNextVisitQuestionsTheme } from '../../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import type { ConversationScreenProps } from '../ConversationScreenProps';

import { scriptedTemplateSender } from '../testSupport/conversationTemplateFixture';

jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));

const focused = '다음 진료에서 물어볼 질문을 만들어 줘. 검사 결과 위주로.';
const splitRequest =
  '다음 진료에서 검사 결과를 확인할 예정이에요. 질문 준비해줘';
const natural = '지금 병원에 가는데 검사 결과를 물어볼 건데 질문 뽑아줘';
const ordinary = '다음 진료에서 혈압 검사가 필요한가요?';

test.each([
  'typed',
  'ordinary',
  'selected',
  'shortcut',
  'after-daily',
  'two-sentence',
  'natural',
] as const)(
  'mounted Conversation owns one protected send and renders the canonical visit card only for visit creation: %s',
  async mode => {
    const f = await setup();
    type Prepare = NonNullable<
      ConversationScreenProps['prepareVisitQuestions']
    >;
    type Send = ConversationScreenProps['onSend'];
    const checkpoint = jest.fn();
    const prepare = jest.fn<ReturnType<Prepare>, Parameters<Prepare>>(
      async (question, _history, signal, observer) => {
        const rows = await f.database.execute(
          "SELECT id, status FROM conversation_requests WHERE status = 'active'",
        );
        checkpoint(rows.rows, observer?.retentionRequestId);
        await observer?.onRetentionCandidate?.(
          {
            question,
            answer: '합성 진료 질문을 준비했어요.',
            providerId: 'synthetic',
            modelId: 'synthetic',
            sources: [],
            citations: [],
          },
          signal!,
        );
        return {
          status: 'answer',
          answer: '합성 진료 질문을 준비했어요.',
          citations: [],
          visitQuestions: {
            appointment,
            review: {
              ownerKey: 'synthetic',
              items: [],
              caveats: [],
              expectedSavedQuestions: [],
            },
            validateSource: async () => true,
          },
        };
      },
    );
    const send = jest.fn<ReturnType<Send>, Parameters<Send>>(
      async (question, _history, signal, observer, context) => {
        const answer =
          context?.intent === 'daily-report'
            ? '합성 일일 보고서가 준비됐어요.'
            : '합성 일반 답변';
        if (context?.intent === 'daily-report')
          await observer?.onRetentionCandidate?.(
            {
              question,
              answer,
              providerId: 'synthetic',
              modelId: 'synthetic',
              sources: [],
              citations: [],
            },
            signal!,
          );
        return { status: 'answer', answer, citations: [] };
      },
    );
    let sessionStore: ReturnType<typeof useConversationSessions> | undefined;
    function Screen() {
      const store = useConversationSessions();
      sessionStore = store;
      const choices = conversationChoiceActions(store, () => true);
      return (
        <ConversationScreen
          entryContext={
            mode === 'selected'
              ? {
                  intent: 'visit-questions',
                  entryKey: 'selected',
                  appointmentId: appointment.id,
                }
              : undefined
          }
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={scriptedTemplateSender(send, text =>
            text === ordinary ? 'ordinary' : 'visit-questions',
          )}
          onOpenDailyReport={() =>
            startConversationReportTurn(store, () => true, send)
          }
          prepareVisitQuestions={prepare}
          retainedActions={{ visitQuestions: choices.onOpenVisitQuestions }}
          renderVisitQuestions={(
            message,
            sessionId,
            sessions,
            onRegenerate,
          ) => (
            <ConversationVisitQuestionCard
              message={message}
              sessionId={sessionId}
              store={sessions}
              operations={defaultVisitQuestionRouteOperations}
              services={{
                resolveSource: jest.fn(),
                registerVisitQuestionSource: jest.fn(),
              }}
              onOpenSource={jest.fn()}
              theme={createNextVisitQuestionsTheme(false)}
              onRegenerate={onRegenerate}
            />
          )}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider
        options={{ retention: f.options.retention }}
      >
        <Screen />
      </ConversationSessionsProvider>,
    );
    try {
      if (mode === 'after-daily') {
        await fireEvent.press(screen.getByTestId('daily-report-request'));
        await screen.findByText('합성 일일 보고서가 준비됐어요.');
        const id = sessionStore!.getSnapshot().activeId;
        expect(conversationEntryForSession(sessionStore!, id)).toMatchObject({
          intent: 'conversation',
          reportRequest: { kind: 'daily_report' },
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]?.[4]).toMatchObject({
          intent: 'daily-report',
        });
      }
      const prompts: Partial<Record<typeof mode, string>> = {
        'two-sentence': splitRequest,
        natural,
        ordinary,
        shortcut: conversationIntentRequests['visit-questions'],
        selected: conversationIntentRequests['visit-questions'],
      };
      const prompt = prompts[mode] ?? focused;
      if (mode === 'shortcut') {
        await fireEvent.press(
          screen.getByTestId('conversation-open-visit-questions'),
        );
      } else if (mode === 'selected') {
        await fireEvent.press(screen.getByTestId('conversation-visit-prepare'));
      } else {
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          prompt,
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      }
      if (mode === 'ordinary') {
        await screen.findByText('합성 일반 답변');
        expect(send).toHaveBeenCalledTimes(1);
        expect(prepare).not.toHaveBeenCalled();
        expect(screen.queryByTestId('inline-visit-regenerate')).toBeNull();
      } else {
        await screen.findByTestId('inline-visit-regenerate');
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(prepare).toHaveBeenCalledWith(
          prompt,
          expect.any(Array),
          expect.any(AbortSignal),
          expect.any(Object),
          expect.objectContaining({
            intent: 'visit-questions',
            ...(mode === 'selected' ? { appointmentId: appointment.id } : {}),
          }),
        );
        expect(checkpoint).toHaveBeenCalledWith(
          [{ id: expect.any(String), status: 'active' }],
          expect.any(String),
        );
        expect(checkpoint.mock.calls[0]?.[0][0].id).toBe(
          checkpoint.mock.calls[0]?.[1],
        );
        expect(send).toHaveBeenCalledTimes(mode === 'after-daily' ? 1 : 0);
        expect(
          (
            await f.database.execute(
              'SELECT message_id FROM conversation_completions',
            )
          ).rows,
        ).toHaveLength(mode === 'after-daily' ? 2 : 1);
      }
      expect(screen.getByText(prompt)).toBeTruthy();
      if (mode === 'typed' || mode === 'natural') {
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          ordinary,
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        await screen.findByText('합성 일반 답변');
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('inline-visit-regenerate')).toBeTruthy();
      }
    } finally {
      await view.unmount();
      f.store.dispose();
      f.close();
    }
  },
);
